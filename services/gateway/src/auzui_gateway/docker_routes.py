"""`/api/docker/*` — the gateway's first `APIRouter` module (plan.md D2).

`create_docker_router(...)` wires the already-built `DockerService` /
`UpdateChecker` / `ComposeRunner` (docker_hosts.py / docker_updates.py /
docker_compose.py) to HTTP, mirroring the shape of the inline routes in
app.py: a `require_docker()` 404-gate for the whole feature, `bearer_token`
+ `zabbix.validate_session` on every data route, and — for write actions
only — an additional Zabbix Admin/Super Admin gate plus a per-host readonly
check before anything is allowed to mutate a container or a compose stack.

AUTHORIZATION MODEL (mirrors the Graylog caveat in app.py's
`/api/logs/search`, ~L250-256): Docker host *visibility* is coarse-grained.
Any live Zabbix session may list every configured Docker host, its
containers, inspect data, logs, stats and update status — Docker hosts do
not map to Zabbix host permissions the way `/api/ts` (per-item) or
`/api/logs/host` (per-host) do, because docker-py/the socket proxy has no
concept of a Zabbix host/item at all. Only WRITE actions narrow further:
`require_docker_admin()` requires Zabbix role type >= 2 (Admin/Super Admin,
per `ZabbixClient.get_user_role_type`), and a `readonly=true` host rejects
every action regardless of the caller's role. Operators MUST treat "has a
valid Zabbix session" as "may see every configured Docker host" (see
docs/deployment.md) — do not put a host here that some Zabbix users should
not even know exists."""

import asyncio
import logging
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field, field_validator

from .config import Settings
from .deps import bearer_token
from .docker_compose import ComposeRunner
from .docker_hosts import DockerService, _error_message
from .docker_hosts import _parse_rfc3339nano_to_ns as _parse_cursor_to_ns
from .docker_updates import UpdateChecker
from .zabbix import ZabbixClient

logger = logging.getLogger(__name__)

# Zabbix role "type": 0=user, 1=admin(?), 2=Admin, 3=Super Admin. Docker
# write actions require at least Admin — see ZabbixClient.get_user_role_type.
ADMIN_ROLE_TYPE = 2

# Container/image ids and compose project names only ever need to identify
# something docker-py/paramiko already knows about; restricting the
# character set up front means nothing unexpected (shell metacharacters,
# path separators, ...) ever reaches a docker-py call or gets interpolated
# anywhere downstream. Same charset docker itself allows for container
# names/ids and compose project names.
_ID_PATTERN = r"^[a-zA-Z0-9_.-]+$"
_ID_RE = re.compile(_ID_PATTERN)

_SEARCH_TYPES = {"containers", "images", "volumes", "networks"}

# Bounds for the bulk-stats request body (D5): a listing page can only ever
# show so many containers at once, so these caps are generous headroom, not
# a real-world limit — they exist purely to stop a malformed/hostile request
# from asking the gateway to fan out to an unbounded number of hosts/ids.
MAX_STATS_HOSTS = 50
MAX_STATS_IDS_PER_HOST = 500


class ContainerActionRequest(BaseModel):
    action: Literal["start", "stop", "restart", "pull_recreate"]


class StackActionRequest(BaseModel):
    action: Literal["pull", "up", "restart"]


class StatsRequest(BaseModel):
    """POST /stats body: `{host_id: [container_id, ...]}`."""

    targets: dict[str, list[str]] = Field(default_factory=dict)

    @field_validator("targets")
    @classmethod
    def _bounded_and_well_formed(cls, v: dict[str, list[str]]) -> dict[str, list[str]]:
        if len(v) > MAX_STATS_HOSTS:
            raise ValueError(f"too many hosts in targets (max {MAX_STATS_HOSTS})")
        for host_id, cids in v.items():
            if len(cids) > MAX_STATS_IDS_PER_HOST:
                raise ValueError(
                    f"too many container ids for host {host_id!r} (max {MAX_STATS_IDS_PER_HOST})"
                )
            for cid in cids:
                if not _ID_RE.fullmatch(cid):
                    raise ValueError(f"invalid container id: {cid!r}")
        return v


def create_docker_router(
    settings: Settings,
    zabbix: ZabbixClient,
    docker_service: DockerService,
    update_checker: UpdateChecker,
    compose_runner: ComposeRunner,
) -> APIRouter:
    router = APIRouter(prefix="/api/docker")

    def require_docker() -> None:
        if not settings.docker_enabled:
            raise HTTPException(404, "Docker path not configured")

    async def require_docker_admin(token: str) -> None:
        role_type = await zabbix.get_user_role_type(token)
        if role_type < ADMIN_ROLE_TYPE:
            raise HTTPException(403, "Zabbix Admin or Super Admin role required for this action")

    def require_writable(host_id: str) -> None:
        host = docker_service.get_host(host_id)
        if host.readonly:
            raise HTTPException(403, f"docker host {host_id!r} is read-only")

    # ---- status (no auth — same convention as /api/ts/status, /api/logs/status) --

    @router.get("/status")
    async def docker_status() -> dict[str, bool]:
        return {"enabled": settings.docker_enabled}

    # ---- hosts / containers -----------------------------------------------

    @router.get("/hosts")
    async def docker_hosts(token: str = Depends(bearer_token)) -> dict[str, object]:
        require_docker()
        await zabbix.validate_session(token)
        return await docker_service.hosts_summary()

    @router.get("/containers")
    async def docker_containers(
        hosts: list[str] | None = Query(default=None),  # noqa: B008 -- Query() is FastAPI's allowed default; ruff false-positives on list[str] annotations
        all_: bool = Query(default=True, alias="all"),
        token: str = Depends(bearer_token),
    ) -> dict[str, object]:
        require_docker()
        await zabbix.validate_session(token)
        return await docker_service.containers(hosts, all_)

    @router.get("/containers/{host_id}/{cid}")
    async def docker_container_inspect(
        host_id: str,
        cid: str = Path(pattern=_ID_PATTERN),
        token: str = Depends(bearer_token),
    ) -> dict[str, object]:
        require_docker()
        await zabbix.validate_session(token)
        return await docker_service.inspect(host_id, cid)

    @router.get("/containers/{host_id}/{cid}/stats")
    async def docker_container_stats(
        host_id: str,
        cid: str = Path(pattern=_ID_PATTERN),
        token: str = Depends(bearer_token),
    ) -> dict[str, object]:
        require_docker()
        await zabbix.validate_session(token)
        return await docker_service.stats_one(host_id, cid)

    @router.post("/stats")
    async def docker_stats_bulk(
        req: StatsRequest, token: str = Depends(bearer_token)
    ) -> dict[str, object]:
        require_docker()
        await zabbix.validate_session(token)
        return await docker_service.stats_bulk(req.targets)

    @router.get("/containers/{host_id}/{cid}/logs")
    async def docker_container_logs(
        host_id: str,
        cid: str = Path(pattern=_ID_PATTERN),
        since: str | None = Query(default=None),
        until: str | None = Query(default=None),
        tail: int | None = Query(default=None, ge=1, le=100_000),
        stdout: bool = Query(default=True),
        stderr: bool = Query(default=True),
        token: str = Depends(bearer_token),
    ) -> dict[str, object]:
        require_docker()
        await zabbix.validate_session(token)
        return await docker_service.logs(
            host_id,
            cid,
            since=_parse_log_boundary(since),
            until=_parse_log_boundary(until),
            tail=tail,
            stdout=stdout,
            stderr=stderr,
        )

    # ---- search -------------------------------------------------------

    @router.get("/search")
    async def docker_search(
        q: str = Query(default=""),
        types: list[str] | None = Query(default=None),  # noqa: B008 -- Query() is FastAPI's allowed default; ruff false-positives on list[str] annotations
        hosts: list[str] | None = Query(default=None),  # noqa: B008 -- Query() is FastAPI's allowed default; ruff false-positives on list[str] annotations
        token: str = Depends(bearer_token),
    ) -> dict[str, object]:
        require_docker()
        await zabbix.validate_session(token)
        if types:
            unknown = [t for t in types if t not in _SEARCH_TYPES]
            if unknown:
                raise HTTPException(
                    422, f"unknown search type(s): {unknown} (valid: {sorted(_SEARCH_TYPES)})"
                )
        return await docker_service.search(q, types or [], hosts)

    # ---- update status --------------------------------------------------

    @router.get("/updates")
    async def docker_updates(
        hosts: list[str] | None = Query(default=None),  # noqa: B008 -- Query() is FastAPI's allowed default; ruff false-positives on list[str] annotations
        token: str = Depends(bearer_token),
    ) -> dict[str, object]:
        require_docker()
        await zabbix.validate_session(token)
        return await _updates_for(hosts)

    # ---- permissions ------------------------------------------------------

    @router.get("/permissions")
    async def docker_permissions(token: str = Depends(bearer_token)) -> dict[str, bool]:
        require_docker()
        await zabbix.validate_session(token)
        role_type = await zabbix.get_user_role_type(token)
        return {"can_act": role_type >= ADMIN_ROLE_TYPE}

    # ---- container actions (admin + writable host only) --------------------

    @router.post("/containers/{host_id}/{cid}/action")
    async def docker_container_action(
        host_id: str,
        req: ContainerActionRequest,
        cid: str = Path(pattern=_ID_PATTERN),
        token: str = Depends(bearer_token),
    ) -> dict[str, object]:
        require_docker()
        await zabbix.validate_session(token)
        await require_docker_admin(token)
        require_writable(host_id)
        # DockerService.act() already invalidates the host's container/summary
        # cache on success.
        return await docker_service.act(host_id, cid, req.action)

    # ---- stacks (compose) --------------------------------------------------

    @router.get("/stacks/{host_id}")
    async def docker_stacks(host_id: str, token: str = Depends(bearer_token)) -> dict[str, object]:
        require_docker()
        await zabbix.validate_session(token)
        result = await docker_service.stacks(host_id)
        if result.get("compose"):
            await _attach_compose_ps(host_id, result)
        return result

    @router.get("/stacks/{host_id}/{project}/config")
    async def docker_stack_config(
        host_id: str,
        project: str = Path(pattern=_ID_PATTERN),
        token: str = Depends(bearer_token),
    ) -> dict[str, str]:
        require_docker()
        await zabbix.validate_session(token)
        host = docker_service.get_host(host_id)
        if not host.compose:
            raise HTTPException(404, f"host {host_id!r} does not support compose operations")
        # ComposeRunner._project_labels resolves the project's compose-file
        # path(s) from container labels (never from request input, see
        # docker_compose.py); config_file() itself re-derives them to read
        # the first file's content, so the primary config file's path
        # matches what gets read below.
        _working_dir, config_files = await compose_runner._project_labels(host, project)
        content = await compose_runner.config_file(host_id, project)
        return {"path": config_files[0], "content": content}

    @router.post("/stacks/{host_id}/{project}/action")
    async def docker_stack_action(
        host_id: str,
        req: StackActionRequest,
        project: str = Path(pattern=_ID_PATTERN),
        token: str = Depends(bearer_token),
    ) -> dict[str, object]:
        require_docker()
        await zabbix.validate_session(token)
        await require_docker_admin(token)
        require_writable(host_id)
        # ComposeRunner.act() 404s by itself if host_id is unknown or the
        # host isn't compose=true (ssh://) — see docker_compose.py.
        result = await compose_runner.act(host_id, project, req.action)
        docker_service.invalidate(host_id)
        return result

    # ---- stacks wiring: for compose=true hosts, fans `docker compose ps
    # --format json` out across the host's projects and hangs the parsed
    # rows onto each stack as `ps`. Never hard-fails the /stacks response —
    # a project whose `ps` call errors keeps its containers, gets `ps: []`,
    # and contributes one entry to `errors` (same partial-result convention
    # as every other fan-out in DockerService).

    async def _attach_compose_ps(host_id: str, result: dict[str, object]) -> None:
        stacks = result["stacks"]
        if not stacks:
            return
        outcomes = await asyncio.gather(
            *(compose_runner.ps(host_id, s["project"]) for s in stacks),
            return_exceptions=True,
        )
        for stack, outcome in zip(stacks, outcomes, strict=True):
            if isinstance(outcome, BaseException):
                logger.warning(
                    "compose ps failed for %s/%s: %r", host_id, stack["project"], outcome
                )
                stack["ps"] = []
                result["errors"].append({"host_id": host_id, "message": _error_message(outcome)})
            else:
                stack["ps"] = outcome

    # ---- update-status wiring: pairs containers with their local image's
    # RepoDigest and hands (image_ref, local_digest) pairs to UpdateChecker.
    # DockerService itself has no public "list images with digests" call, so
    # this reuses its already-public search() (types=["images"]) rather than
    # reaching into its internals — the SEARCH_CAP it applies is an accepted
    # limitation for very large image inventories.

    async def _updates_for(hosts: list[str] | None) -> dict[str, object]:
        containers_result = await docker_service.containers(hosts, True)
        containers = containers_result["containers"]
        host_ids = sorted({c["host_id"] for c in containers}) or hosts
        images_result = await docker_service.search("", ["images"], host_ids)
        images_by_host: dict[str, list[dict]] = {}
        for row in images_result["results"].get("images", []):
            images_by_host.setdefault(row["host_id"], []).append(row)

        pairs: list[tuple[str, str]] = []
        keys: list[tuple[str, str, str]] = []
        for c in containers:
            image_ref = f"{c['image']}:{c['tag']}" if c["tag"] else c["image"]
            local_digest = _local_digest(images_by_host.get(c["host_id"], []), c)
            pairs.append((image_ref, local_digest))
            keys.append((c["host_id"], c["id"], image_ref))

        checked = await update_checker.check(pairs)
        updates: dict[str, dict[str, dict]] = {}
        for host_id, cid, image_ref in keys:
            updates.setdefault(host_id, {})[cid] = checked.get(
                image_ref,
                {"tag": "", "local_digest": "", "remote_digest": "", "status": "unknown"},
            )
        errors = containers_result["errors"] + images_result["errors"]
        return {"updates": updates, "errors": errors}

    return router


def _parse_log_boundary(value: str | None) -> float | None:
    """`since`/`until` double as a plain unix timestamp (a range-picker
    sends one) or the opaque RFC3339Nano cursor `docker_service.logs()`
    itself returned from a previous call (a live-poll sends that back
    verbatim, per D6 in the plan). Numeric form is tried first — cheap, and
    what a range-picker always sends — falling back to the RFC3339Nano
    parsing that produced the cursor in the first place."""
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        pass
    try:
        return _parse_cursor_to_ns(value) / 1_000_000_000
    except ValueError as e:
        raise HTTPException(422, f"invalid since/until value: {value!r}") from e


def _local_digest(images: list[dict], container: dict) -> str:
    """The RepoDigest of the image row matching `container`'s ImageID, or
    "" if the container's image was never pulled from a registry (locally
    built) — UpdateChecker.check() treats an empty local_digest as
    status="unknown" without making a network call."""
    image_id = container.get("image_id", "")
    repo = container.get("image", "")
    for img in images:
        if img.get("Id") != image_id:
            continue
        digests = img.get("RepoDigests") or []
        for d in digests:
            if d.startswith(f"{repo}@"):
                return d
        return digests[0] if digests else ""
    return ""
