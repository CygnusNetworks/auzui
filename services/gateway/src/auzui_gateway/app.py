import base64
import binascii
import logging
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import __version__
from .config import Settings, get_settings
from .deps import bearer_token
from .docker_compose import ComposeRunner
from .docker_hosts import ClientFactory as DockerClientFactory
from .docker_hosts import DockerService
from .docker_routes import create_docker_router
from .docker_updates import UpdateChecker
from .filter_sets import FilterSetStore
from .graylog import GraylogService, LogFilter, apply_filters, build_host_query, parens_balanced
from .influx import VALID_FNS, InfluxClient
from .spnego import SpnegoAuthFailed, SpnegoService, SpnegoUnavailable, principal_to_login
from .zabbix import ZabbixClient

logger = logging.getLogger(__name__)

# bearer_token now lives in deps.py (docker_routes.py needs it too, and
# importing it from app.py would be a circular import). Re-exported here,
# unchanged, so existing tests that do
# `from auzui_gateway.app import bearer_token` keep working.
__all__ = ["bearer_token", "create_app"]


class TsQueryRequest(BaseModel):
    itemids: list[str] = Field(min_length=1, max_length=100)
    start: int
    end: int
    points: int = Field(default=800, ge=10, le=4000)
    fn: str = "last"

    @field_validator("itemids")
    @classmethod
    def _itemids_numeric(cls, v: list[str]) -> list[str]:
        # Zabbix item ids are always numeric. Enforcing this here makes the
        # Flux query builder (influx.build_flux interpolates itemids into the
        # query string) injection-proof by construction, independent of the
        # permission gate in ZabbixClient.check_items_visible.
        if not all(i.isdigit() for i in v):
            raise ValueError("itemids must be numeric")
        return v


class LogFilterModel(BaseModel):
    """One include/exclude filter clicked from a log row."""

    field: Literal["source", "facility", "application_name"]
    value: str


class LogsSearchRequest(BaseModel):
    query: str = "*"
    stream_ids: list[str] | None = None
    servers: list[str] | None = None
    from_: float = Field(alias="from")
    to: float
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)
    include: list[LogFilterModel] = Field(default_factory=list)
    exclude: list[LogFilterModel] = Field(default_factory=list)
    # Collapse content-identical lines that arrived on different Graylog servers
    # (only takes effect when >1 server is queried). Default on.
    dedupe: bool = True

    model_config = {"populate_by_name": True}


class HostLogsRequest(BaseModel):
    from_: float = Field(alias="from")
    to: float
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)
    extra_query: str | None = None
    stream_ids: list[str] | None = None
    servers: list[str] | None = None
    include: list[LogFilterModel] = Field(default_factory=list)
    exclude: list[LogFilterModel] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class FilterSetPayload(BaseModel):
    """The filter selection stored inside a saved set — mirrors the logs
    toolbar's URL params (include/exclude chips, stream/server selection,
    max level)."""

    include: list[LogFilterModel] = Field(default_factory=list)
    exclude: list[LogFilterModel] = Field(default_factory=list)
    streams: list[str] | None = None
    servers: list[str] | None = None
    level: int | None = None


class FilterSetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    shared: bool = False
    filters: FilterSetPayload = Field(default_factory=FilterSetPayload)


def create_app(
    settings: Settings | None = None,
    *,
    docker_client_factory: DockerClientFactory | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="auzui-gateway", version=__version__, docs_url=None, redoc_url=None)

    zabbix = ZabbixClient(settings)
    influx = InfluxClient(settings)
    graylog = GraylogService(settings)
    filter_store = FilterSetStore(settings.filter_sets_path)

    # Docker (plan.md D1-D8): instantiated unconditionally like Influx/Graylog
    # above — DockerService.enabled / settings.docker_enabled just report
    # false without DOCKER_HOSTS, and docker-py/paramiko are only imported
    # lazily inside docker_hosts.py once a host is actually reached, so this
    # stays a no-op (and importable) install without the 'docker' extra.
    # docker_client_factory exists solely so tests can inject a fake
    # DockerHostClient without docker-py installed (see test_docker.py); it
    # is None (-> DockerService's real docker-py factory) in production.
    docker_service = DockerService(settings, client_factory=docker_client_factory)
    update_checker = UpdateChecker(settings)
    compose_runner = ComposeRunner(docker_service, settings)
    app.include_router(
        create_docker_router(settings, zabbix, docker_service, update_checker, compose_runner)
    )

    if settings.cors_origins:
        from fastapi.middleware.cors import CORSMiddleware

        origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
        if "*" in origins:
            # A wildcard origin turns the gateway into an open cross-origin
            # endpoint for any site the victim visits. Refuse it and disable
            # CORS entirely rather than honour a dangerous misconfiguration.
            logger.warning(
                "CORS_ORIGINS contains '*'; refusing the wildcard and leaving CORS disabled. "
                "Set an explicit, comma-separated origin list instead."
            )
        else:
            app.add_middleware(
                CORSMiddleware,
                allow_origins=origins,
                allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                allow_headers=["Authorization", "Content-Type"],
            )

    # ---- auth (Kerberos SSO) --------------------------------------------

    spnego_service = SpnegoService(settings)

    @app.get("/api/auth/methods")
    async def auth_methods() -> dict[str, bool]:
        return {"password": True, "spnego": settings.spnego_enabled}

    @app.get("/api/auth/spnego")
    async def auth_spnego(
        authorization: str | None = Header(default=None),
    ) -> Response:
        if not settings.spnego_enabled:
            raise HTTPException(404, "SPNEGO not configured")
        if not authorization or not authorization.startswith("Negotiate "):
            # First leg: challenge the browser to send its Kerberos ticket.
            return Response(
                status_code=401,
                headers={"WWW-Authenticate": "Negotiate"},
                content='{"detail": {"sso_error": "negotiate token required"}}',
                media_type="application/json",
            )
        try:
            token = base64.b64decode(authorization[len("Negotiate ") :].strip())
        except (ValueError, binascii.Error) as e:
            raise HTTPException(401, {"sso_error": "malformed negotiate token"}) from e
        try:
            principal = await spnego_service.accept(token)
        except SpnegoAuthFailed as e:
            # Deliberately NO second Negotiate challenge here — a 401 with the
            # header again would loop the browser (tiqora pattern).
            raise HTTPException(401, {"sso_error": str(e)}) from e
        except SpnegoUnavailable as e:
            raise HTTPException(501, {"sso_error": str(e)}) from e

        username = principal_to_login(principal)
        sessionid = await zabbix.http_auth_session(settings.effective_zabbix_web_url, username)
        logger.info("SPNEGO login: %s (%s)", username, principal)
        return JSONResponse({"token": sessionid, "username": username})

    @app.get("/api/config")
    async def ui_config(token: str = Depends(bearer_token)) -> dict[str, str]:
        await zabbix.validate_session(token)
        return {
            "zabbix_ui_url": settings.effective_zabbix_ui_url,
            "version": settings.auzui_version or __version__,
            "commit": settings.auzui_git_sha[:10],
        }

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {
            "status": "ok",
            # Build-Version (AUZUI_VERSION aus CI) vor der Paketversion —
            # sonst meldet /health ewig die zuletzt hartkodierte Zahl.
            "version": settings.auzui_version or __version__,
            "influx": settings.influx_enabled,
            "graylog": settings.graylog_enabled,
            "docker": settings.docker_enabled,
        }

    # ---- time series -----------------------------------------------------

    @app.get("/api/ts/status")
    async def ts_status() -> dict[str, bool]:
        return {"enabled": settings.influx_enabled}

    @app.post("/api/ts/query")
    async def ts_query(
        req: TsQueryRequest, token: str = Depends(bearer_token)
    ) -> dict[str, object]:
        if not settings.influx_enabled:
            raise HTTPException(404, "InfluxDB path not configured")
        if req.fn not in VALID_FNS:
            raise HTTPException(422, f"fn must be one of {sorted(VALID_FNS)}")
        if req.end <= req.start:
            raise HTTPException(422, "end must be after start")
        await zabbix.check_items_visible(token, req.itemids)
        series = await influx.query_series(req.itemids, req.start, req.end, req.points, req.fn)
        return {
            "series": [
                {"itemid": itemid, "points": [[t, v] for t, v in pts]}
                for itemid, pts in series.items()
            ]
        }

    # ---- logs ------------------------------------------------------------

    @app.get("/api/logs/status")
    async def logs_status() -> dict[str, bool]:
        return {"enabled": settings.graylog_enabled}

    def require_graylog() -> None:
        if not settings.graylog_enabled:
            raise HTTPException(404, "Graylog path not configured")

    @app.get("/api/logs/servers")
    async def logs_servers(token: str = Depends(bearer_token)) -> dict[str, object]:
        require_graylog()
        await zabbix.validate_session(token)
        return {"servers": graylog.server_list(), "dedup_enabled": settings.log_dedup_enabled}

    @app.get("/api/logs/streams")
    async def logs_streams(
        servers: list[str] | None = None, token: str = Depends(bearer_token)
    ) -> dict[str, object]:
        require_graylog()
        # Any valid Zabbix session may list streams; verify the token is real
        # by resolving it against the API (cheap, cached via permission cache).
        await zabbix.validate_session(token)
        return {"streams": await graylog.streams(servers)}

    @app.post("/api/logs/search")
    async def logs_search(
        req: LogsSearchRequest, token: str = Depends(bearer_token)
    ) -> dict[str, object]:
        require_graylog()
        # AUTHORIZATION MODEL: log access is coarse-grained. Any live Zabbix
        # session may free-text search every configured Graylog stream — unlike
        # /api/ts (per-item) and /api/logs/host (per-host), Graylog streams do
        # not map to Zabbix host permissions. Operators MUST scope
        # GRAYLOG_DEFAULT_STREAMS to streams all auzui users are allowed to read
        # (see docs/deployment.md). Per-host log authorization would require a
        # stream↔permission mapping that does not exist here.
        await zabbix.validate_session(token)
        query = apply_filters(
            req.query,
            [LogFilter(f.field, f.value) for f in req.include],
            [LogFilter(f.field, f.value) for f in req.exclude],
            settings.graylog_source_field,
        )
        return await graylog.search(
            query, req.from_, req.to, req.limit, req.offset, req.stream_ids, req.servers, req.dedupe
        )

    @app.post("/api/logs/host/{hostid}")
    async def logs_host(
        hostid: str, req: HostLogsRequest, token: str = Depends(bearer_token)
    ) -> dict[str, object]:
        require_graylog()
        host = await zabbix.get_host_identity(token, hostid)
        query, aliases = build_host_query(host, settings.graylog_source_field)
        if req.extra_query:
            # The host-source clause is a scope boundary; an unbalanced-prefix
            # paren fragment could close the wrapper and OR the host filter away.
            if not parens_balanced(req.extra_query):
                raise HTTPException(422, "extra_query has unbalanced parentheses")
            query = f"({query}) AND ({req.extra_query})"
        query = apply_filters(
            query,
            [LogFilter(f.field, f.value) for f in req.include],
            [LogFilter(f.field, f.value) for f in req.exclude],
            settings.graylog_source_field,
        )
        result = await graylog.search(
            query, req.from_, req.to, req.limit, req.offset, req.stream_ids, req.servers
        )
        result["matched_sources"] = aliases
        return result

    # ---- saved filter sets (team-wide) ----------------------------------

    def _payload_dict(p: FilterSetPayload) -> dict[str, object]:
        return {
            "include": [{"field": f.field, "value": f.value} for f in p.include],
            "exclude": [{"field": f.field, "value": f.value} for f in p.exclude],
            "streams": p.streams,
            "servers": p.servers,
            "level": p.level,
        }

    @app.get("/api/logs/filter-sets")
    async def filter_sets_list(token: str = Depends(bearer_token)) -> dict[str, object]:
        require_graylog()
        username = await zabbix.get_username(token)
        return {"filter_sets": await filter_store.list_for(username)}

    @app.post("/api/logs/filter-sets")
    async def filter_sets_create(
        req: FilterSetCreate, token: str = Depends(bearer_token)
    ) -> dict[str, object]:
        require_graylog()
        username = await zabbix.get_username(token)
        return await filter_store.create(username, req.name, req.shared, _payload_dict(req.filters))

    @app.put("/api/logs/filter-sets/{set_id}")
    async def filter_sets_update(
        set_id: str, req: FilterSetCreate, token: str = Depends(bearer_token)
    ) -> dict[str, object]:
        require_graylog()
        username = await zabbix.get_username(token)
        return await filter_store.update(
            set_id, username, req.name, req.shared, _payload_dict(req.filters)
        )

    @app.delete("/api/logs/filter-sets/{set_id}")
    async def filter_sets_delete(
        set_id: str, token: str = Depends(bearer_token)
    ) -> dict[str, bool]:
        require_graylog()
        username = await zabbix.get_username(token)
        await filter_store.delete(set_id, username)
        return {"deleted": True}

    # ---- optional SPA serving -------------------------------------------

    frontend = Path(settings.frontend_dir)
    if settings.serve_frontend and frontend.is_dir():
        app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str, request: Request):  # noqa: ARG001
            candidate = (frontend / path).resolve()
            if path and candidate.is_file() and candidate.is_relative_to(frontend.resolve()):
                return FileResponse(candidate)
            return FileResponse(frontend / "index.html")

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:  # noqa: ARG001
        logger.exception("unhandled error: %s", exc)
        return JSONResponse(status_code=500, content={"detail": "internal error"})

    return app
