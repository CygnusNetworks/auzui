import base64
import binascii
import logging
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .config import Settings, get_settings
from .graylog import GraylogClient, LogFilter, apply_filters, build_host_query
from .influx import VALID_FNS, InfluxClient
from .spnego import SpnegoAuthFailed, SpnegoService, SpnegoUnavailable, principal_to_login
from .zabbix import ZabbixClient

logger = logging.getLogger(__name__)


def bearer_token(authorization: str | None = Header(default=None)) -> str:
    """The caller's Zabbix session token — required on every data endpoint."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token (Zabbix session)")
    return authorization[7:].strip()


class TsQueryRequest(BaseModel):
    itemids: list[str] = Field(min_length=1, max_length=100)
    start: int
    end: int
    points: int = Field(default=800, ge=10, le=4000)
    fn: str = "last"


class LogFilterModel(BaseModel):
    """One include/exclude filter clicked from a log row."""

    field: Literal["source", "facility", "application_name"]
    value: str


class LogsSearchRequest(BaseModel):
    query: str = "*"
    stream_ids: list[str] | None = None
    from_: float = Field(alias="from")
    to: float
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)
    include: list[LogFilterModel] = Field(default_factory=list)
    exclude: list[LogFilterModel] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class HostLogsRequest(BaseModel):
    from_: float = Field(alias="from")
    to: float
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)
    extra_query: str | None = None
    stream_ids: list[str] | None = None
    include: list[LogFilterModel] = Field(default_factory=list)
    exclude: list[LogFilterModel] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="auzui-gateway", version=__version__, docs_url=None, redoc_url=None)

    zabbix = ZabbixClient(settings)
    influx = InfluxClient(settings)
    graylog = GraylogClient(settings)

    if settings.cors_origins:
        from fastapi.middleware.cors import CORSMiddleware

        app.add_middleware(
            CORSMiddleware,
            allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
            allow_methods=["*"],
            allow_headers=["*"],
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
            "version": __version__,
            "influx": settings.influx_enabled,
            "graylog": settings.graylog_enabled,
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

    @app.get("/api/logs/streams")
    async def logs_streams(token: str = Depends(bearer_token)) -> dict[str, object]:
        require_graylog()
        # Any valid Zabbix session may list streams; verify the token is real
        # by resolving it against the API (cheap, cached via permission cache).
        await zabbix.validate_session(token)
        return {"streams": await graylog.streams()}

    @app.post("/api/logs/search")
    async def logs_search(
        req: LogsSearchRequest, token: str = Depends(bearer_token)
    ) -> dict[str, object]:
        require_graylog()
        await zabbix.validate_session(token)
        query = apply_filters(
            req.query,
            [LogFilter(f.field, f.value) for f in req.include],
            [LogFilter(f.field, f.value) for f in req.exclude],
            settings.graylog_source_field,
        )
        return await graylog.search(query, req.from_, req.to, req.limit, req.offset, req.stream_ids)

    @app.post("/api/logs/host/{hostid}")
    async def logs_host(
        hostid: str, req: HostLogsRequest, token: str = Depends(bearer_token)
    ) -> dict[str, object]:
        require_graylog()
        host = await zabbix.get_host_identity(token, hostid)
        query, aliases = build_host_query(host, settings.graylog_source_field)
        if req.extra_query:
            query = f"({query}) AND ({req.extra_query})"
        query = apply_filters(
            query,
            [LogFilter(f.field, f.value) for f in req.include],
            [LogFilter(f.field, f.value) for f in req.exclude],
            settings.graylog_source_field,
        )
        result = await graylog.search(
            query, req.from_, req.to, req.limit, req.offset, req.stream_ids
        )
        result["matched_sources"] = aliases
        return result

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
