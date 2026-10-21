"""Filtering JSON-RPC proxy for `POST /api_jsonrpc.php`.

The SPA talks to the Zabbix API same-origin at /api_jsonrpc.php. Forwarding
that path unfiltered from the operator's nginx publishes the whole API: every
method, batch requests, unthrottled `user.login` and raw error details. This
module terminates the path in the gateway instead, so Zabbix itself can be
internal-only, and narrows what gets through:

- a method allowlist (exactly what the SPA calls, plus operator extras),
- strict request shape (single object, size cap, JSON content type),
- only the JSON-RPC body and `Authorization` header reach Zabbix (no cookies,
  no X-Forwarded-*, no client headers),
- error `data` replaced by generic text unless the SPA needs it,
- brute-force throttling on `user.login`.

The SPA is unchanged: it keeps speaking plain Zabbix JSON-RPC and still
receives Zabbix's `result` verbatim.
"""

import json
import logging
import re
import time
from typing import Any

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .config import Settings

logger = logging.getLogger(__name__)

# Exactly the methods the SPA issues (packages/zabbix-client/src/api.ts; the
# generic client.call is only reached through that wrapper). Anything else —
# user.get, user.update, script.execute, configuration.import, ... — is
# refused, which is the point. Add more via ZABBIX_PROXY_EXTRA_METHODS.
DEFAULT_ALLOWED_METHODS: frozenset[str] = frozenset(
    {
        "apiinfo.version",
        "user.login",
        "user.logout",
        "discoveryrule.get",
        "event.get",
        "event.acknowledge",
        "history.get",
        "trend.get",
        "host.get",
        "hostgroup.get",
        "item.get",
        "itemprototype.get",
        "trigger.get",
        "problem.get",
        "httptest.get",
        "httptest.update",
        "maintenance.get",
        "maintenance.create",
        "maintenance.update",
        "maintenance.delete",
        "map.get",
        "proxy.get",
        "proxygroup.get",
    }
)

ACCEPTED_CONTENT_TYPES = frozenset({"application/json", "application/json-rpc"})

# JSON-RPC 2.0 error codes.
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
# Implementation-defined server error range: upstream/gateway-level failures.
SERVER_ERROR = -32000

# Request members forwarded to Zabbix. `auth` is the legacy (< 6.4) body-level
# token; everything else a client might add is dropped.
_FORWARDED_MEMBERS = ("jsonrpc", "id", "method", "params", "auth")

# The SPA's session-expired detection (frontend/src/lib/auth/session-errors.ts)
# matches these fragments in error.message + error.data, and Zabbix puts the
# hint ("Session terminated, re-login, please." / "Not authorized.") in
# `data`, so data carrying them must survive sanitizing or re-login breaks.
_SESSION_HINT = re.compile(r"re-login|session terminated|not authori[sz]", re.IGNORECASE)
_MAX_KEPT_DATA = 200
_GENERIC_DATA = "Request failed."


def sanitize_error(method: str, error: dict[str, Any]) -> dict[str, Any]:
    """Pass `code` and `message` through; replace `data` (it can carry query
    structure, table names, paths) with generic text — except where the SPA
    reads it: session-expired hints, and every `user.login` error, whose
    `data` ("Incorrect user name or password or account is temporarily
    blocked.") is what the login form shows. The original goes to the log."""
    data = error.get("data")
    code = error.get("code")
    message = error.get("message")
    if not isinstance(message, str):
        message = "Application error."
    if not isinstance(code, int) or isinstance(code, bool):
        code = SERVER_ERROR
    keep = isinstance(data, str) and (method == "user.login" or _SESSION_HINT.search(data))
    if keep:
        return {"code": code, "message": message, "data": data[:_MAX_KEPT_DATA]}
    logger.info(
        "Zabbix API error (method=%s) code=%s message=%r data=%r", method, code, message, data
    )
    return {"code": code, "message": message, "data": _GENERIC_DATA}


def _rpc_error(
    rpc_id: Any, code: int, message: str, data: str | None = None, status: int = 200, **kw: Any
) -> JSONResponse:
    err: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return JSONResponse(
        status_code=status, content={"jsonrpc": "2.0", "error": err, "id": rpc_id}, **kw
    )


class LoginThrottle:
    """In-memory failed-login counter keyed per client IP and per username.

    A key locks once it has `max_failures` failures, each counted only while
    younger than `lockout` seconds since the previous failure on that key; it
    unlocks `lockout` seconds after its last failure. State is per process
    (the gateway runs as one container) and bounded: expired keys are pruned
    and, if still over `max_entries` (an attacker spraying random usernames),
    the oldest half is dropped. Per-username locking lets an attacker lock a
    known account out for the lockout period — the usual trade-off, accepted
    because Zabbix itself blocks accounts after repeated failures anyway."""

    def __init__(self, max_failures: int, lockout: float, max_entries: int = 10_000) -> None:
        self._max = max_failures
        self._lockout = lockout
        self._cap = max_entries
        # key -> (failure count, monotonic time of last failure)
        self._state: dict[str, tuple[int, float]] = {}

    def is_locked(self, *keys: str) -> bool:
        if self._max <= 0:
            return False  # throttling disabled
        now = time.monotonic()
        for key in keys:
            entry = self._state.get(key)
            if entry is None:
                continue
            count, last = entry
            if now - last >= self._lockout:
                del self._state[key]
            elif count >= self._max:
                return True
        return False

    def failure(self, *keys: str) -> None:
        now = time.monotonic()
        for key in keys:
            count, last = self._state.get(key, (0, now))
            if now - last >= self._lockout:
                count = 0
            self._state[key] = (count + 1, now)
        if len(self._state) > self._cap:
            self._prune(now)

    def success(self, key: str) -> None:
        self._state.pop(key, None)

    def _prune(self, now: float) -> None:
        for k in [k for k, (_, last) in self._state.items() if now - last >= self._lockout]:
            del self._state[k]
        if len(self._state) > self._cap:
            oldest = sorted(self._state, key=lambda k: self._state[k][1])
            for k in oldest[: len(oldest) // 2]:
                del self._state[k]


def _safe_log_token(value: str) -> str:
    """Username for the single-line fail2ban log entry: no whitespace or
    control characters (log forging), bounded length."""
    return re.sub(r"[^\w.@+-]", "_", value)[:64]


def _client_ip(request: Request) -> str:
    # request.client.host is the TCP peer. Behind a reverse proxy that is the
    # proxy itself, so uvicorn must run with `--proxy-headers
    # --forwarded-allow-ips=<proxy ip>` (Dockerfile: FORWARDED_ALLOW_IPS) to
    # replace it with X-Forwarded-For; we deliberately do not parse that header
    # ourselves, since it is client-controlled unless a trusted hop sets it.
    return request.client.host if request.client else "unknown"


async def _read_limited_body(request: Request, limit: int) -> bytes | None:
    """The request body, or None if it exceeds `limit`. Streams and counts
    rather than trusting Content-Length, which may be absent (chunked) or
    wrong."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        return None
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


def create_zabbix_proxy_router(settings: Settings, http: httpx.AsyncClient) -> APIRouter:
    router = APIRouter()
    allowed = DEFAULT_ALLOWED_METHODS | settings.zabbix_proxy_extra_method_set
    throttle = LoginThrottle(
        settings.zabbix_login_max_failures, settings.zabbix_login_lockout_seconds
    )
    upstream_url = settings.zabbix_api_url
    max_body = settings.zabbix_proxy_max_body_bytes

    @router.post("/api_jsonrpc.php", include_in_schema=False)
    async def api_jsonrpc(request: Request) -> JSONResponse:
        ip = _client_ip(request)

        ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
        if ctype not in ACCEPTED_CONTENT_TYPES:
            return _rpc_error(
                None, INVALID_REQUEST, "Invalid Request", "Unsupported content type.", status=415
            )

        raw = await _read_limited_body(request, max_body)
        if raw is None:
            return _rpc_error(
                None, INVALID_REQUEST, "Invalid Request", "Request body too large.", status=413
            )

        try:
            body = json.loads(raw)
        except (ValueError, RecursionError):
            return _rpc_error(None, PARSE_ERROR, "Parse error", "Request is not valid JSON.")

        if not isinstance(body, dict):
            # Arrays are JSON-RPC batches: one request could carry hundreds of
            # user.login attempts past the throttle, so they are refused.
            return _rpc_error(
                None, INVALID_REQUEST, "Invalid Request", "Single request object required."
            )
        rpc_id = body.get("id")
        if not isinstance(rpc_id, str | int | None) or isinstance(rpc_id, bool):
            rpc_id = None
        method = body.get("method")
        if body.get("jsonrpc") != "2.0" or not isinstance(method, str) or not method:
            return _rpc_error(
                rpc_id, INVALID_REQUEST, "Invalid Request", "Malformed JSON-RPC request."
            )

        if method not in allowed:
            logger.warning("Zabbix proxy: method not allowed method=%r ip=%s", method[:100], ip)
            return _rpc_error(
                rpc_id, METHOD_NOT_FOUND, "Method not allowed", "This method is not available."
            )

        params = body.get("params")
        username = ""
        if method == "user.login" and isinstance(params, dict):
            # `user` is the pre-5.4 spelling of `username`.
            for field in ("username", "user"):
                if isinstance(params.get(field), str):
                    username = params[field].strip().lower()[:128]
                    break
        ip_key = f"ip:{ip}"
        user_keys = [f"user:{username}"] if username else []
        if method == "user.login" and throttle.is_locked(ip_key, *user_keys):
            logger.warning("auzui login throttled ip=%s user=%s", ip, _safe_log_token(username))
            # HTTP 200 like a regular Zabbix login failure: the SPA client turns
            # any non-200 into a bare "HTTP <status>" transport error and would
            # never show this text. Retry-After stays as a hint for scripts.
            return _rpc_error(
                rpc_id,
                SERVER_ERROR,
                "Application error.",
                "Too many failed login attempts. Try again later.",
                headers={"Retry-After": str(int(settings.zabbix_login_lockout_seconds))},
            )

        # Rebuild instead of forwarding raw bytes: unknown members are dropped.
        payload = {k: body[k] for k in _FORWARDED_MEMBERS if k in body}
        headers = {"Content-Type": "application/json-rpc"}
        auth = request.headers.get("authorization")
        if auth:
            headers["Authorization"] = auth
        try:
            res = await http.post(upstream_url, json=payload, headers=headers)
        except httpx.TimeoutException:
            logger.warning("Zabbix proxy: upstream timeout method=%s", method)
            return _rpc_error(
                rpc_id, SERVER_ERROR, "Upstream error", "Zabbix API timeout.", status=504
            )
        except httpx.HTTPError as e:
            logger.warning(
                "Zabbix proxy: upstream unreachable method=%s: %s", method, e.__class__.__name__
            )
            return _rpc_error(
                rpc_id, SERVER_ERROR, "Upstream error", "Zabbix API unreachable.", status=502
            )

        try:
            upstream = res.json() if res.status_code == 200 else None
        except ValueError:
            upstream = None
        if not isinstance(upstream, dict) or not ("result" in upstream or "error" in upstream):
            logger.warning(
                "Zabbix proxy: unusable upstream answer method=%s status=%s",
                method,
                res.status_code,
            )
            return _rpc_error(
                rpc_id,
                SERVER_ERROR,
                "Upstream error",
                "Unexpected Zabbix API response.",
                status=502,
            )

        out: dict[str, Any] = {"jsonrpc": "2.0", "id": upstream.get("id", rpc_id)}
        error = upstream.get("error")
        if isinstance(error, dict):
            out["error"] = sanitize_error(method, error)
            if method == "user.login":
                throttle.failure(ip_key, *user_keys)
                logger.warning("auzui login failure ip=%s user=%s", ip, _safe_log_token(username))
        else:
            out["result"] = upstream.get("result")
            if method == "user.login" and username:
                throttle.success(f"user:{username}")
        return JSONResponse(out)

    return router
