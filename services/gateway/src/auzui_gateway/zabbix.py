"""Zabbix JSON-RPC helper: permission checks with the *caller's* session
token. The gateway never holds Zabbix credentials of its own — whoever asks
must be allowed to see the item/host in Zabbix, otherwise Influx/Graylog
would open a permission hole (PLAN.md)."""

import logging
from typing import Any

import httpx
from fastapi import HTTPException

from .cache import TTLCache
from .config import Settings

logger = logging.getLogger(__name__)


class ZabbixClient:
    def __init__(self, settings: Settings) -> None:
        self._url = settings.zabbix_api_url
        self._timeout = settings.zabbix_timeout
        self._perm_cache: TTLCache[bool] = TTLCache(settings.permission_cache_ttl)
        self._username_cache: TTLCache[str] = TTLCache(settings.permission_cache_ttl)
        self._host_cache: TTLCache[dict[str, Any] | None] = TTLCache(
            settings.host_mapping_cache_ttl
        )
        self._role_cache: TTLCache[int] = TTLCache(settings.permission_cache_ttl)

    async def _call(self, token: str, method: str, params: Any) -> Any:
        payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        headers = {
            "Content-Type": "application/json-rpc",
            "Authorization": f"Bearer {token}",
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                res = await client.post(self._url, json=payload, headers=headers)
        except httpx.TimeoutException as e:
            raise HTTPException(504, "Zabbix API timeout") from e
        except httpx.HTTPError as e:
            raise HTTPException(502, f"Zabbix API unreachable: {e.__class__.__name__}") from e

        if res.status_code != 200:
            raise HTTPException(502, f"Zabbix API returned HTTP {res.status_code}")
        body = res.json()
        if "error" in body:
            err = body["error"]
            message = err.get("data") or err.get("message") or "Zabbix API error"
            # Log the upstream detail but do NOT echo it to the client — it can
            # leak internal query structure/paths. Callers only need the status.
            lowered = message.lower()
            if "not authori" in lowered or "session" in lowered:
                # Invalid/expired session token → the caller must re-login.
                logger.info("Zabbix rejected session (method=%s): %s", method, message)
                raise HTTPException(401, "Zabbix session invalid or expired")
            logger.warning("Zabbix API error (method=%s): %s", method, message)
            raise HTTPException(502, "Zabbix API error")
        return body.get("result")

    async def http_auth_session(self, settings_web_url: str, username: str) -> str:
        """Exchange a (Kerberos-verified) username for a Zabbix session via the
        frontend's HTTP-auth entry point. Zabbix trusts the webserver-provided
        user, so the Basic password is irrelevant — the caller MUST have
        authenticated the user beforehand (SPNEGO)."""
        import base64
        import binascii
        import json
        from urllib.parse import unquote

        basic = base64.b64encode(f"{username}:x".encode()).decode()
        try:
            async with httpx.AsyncClient(timeout=self._timeout, follow_redirects=False) as client:
                res = await client.get(
                    f"{settings_web_url}/index_http.php",
                    headers={"Authorization": f"Basic {basic}"},
                )
        except httpx.TimeoutException as e:
            raise HTTPException(504, "Zabbix web frontend timeout") from e
        except httpx.HTTPError as e:
            raise HTTPException(
                502, f"Zabbix web frontend unreachable: {e.__class__.__name__}"
            ) from e

        cookie = res.cookies.get("zbx_session")
        if not cookie:
            # HTTP auth disabled, unknown user, or frontend misconfigured.
            raise HTTPException(502, "Zabbix HTTP auth did not yield a session")
        try:
            session = json.loads(base64.b64decode(unquote(cookie)))
            sessionid = session["sessionid"]
        except (ValueError, KeyError, binascii.Error) as e:
            raise HTTPException(502, "unexpected zbx_session cookie format") from e

        # Round-trip: the sessionid must work as an API bearer for this user.
        await self._call(sessionid, "user.get", {"output": ["userid"], "limit": 1})
        return str(sessionid)

    async def validate_session(self, token: str) -> None:
        """401 unless the token belongs to a live Zabbix session. Cached."""
        if self._perm_cache.get(f"session:{token}") is True:
            return
        await self._call(token, "user.get", {"output": ["userid"], "limit": 1})
        self._perm_cache.set(f"session:{token}", True)

    async def get_username(self, token: str) -> str:
        """The login name behind the session token — used as the `owner` of
        saved filter sets. user.checkAuthentication is the only call that
        identifies the *current* user (an unfiltered user.get returns the
        whole user list — first row is typically "guest"); it only accepts
        session ids, so API tokens fall back to user.get, which for a plain
        user is scoped to themselves. 401 if the session is invalid."""
        cached = self._username_cache.get(token)
        if cached is not None:
            return cached
        row: dict = {}
        try:
            auth = await self._call(token, "user.checkAuthentication", {"sessionid": token})
            if isinstance(auth, dict):
                row = auth
        except HTTPException:
            pass  # API tokens are not session ids — fall back below
        if not row.get("username"):
            result = await self._call(
                token, "user.get", {"output": ["userid", "username"], "limit": 1}
            )
            if not result:
                raise HTTPException(401, "session token resolves to no user")
            row = result[0]
        username = str(row.get("username") or f"userid:{row.get('userid')}")
        self._username_cache.set(token, username)
        # A resolved username also proves the session is live.
        self._perm_cache.set(f"session:{token}", True)
        return username

    async def get_user_role_type(self, token: str) -> int:
        """Zabbix role "type" (0=user, 1=admin, 2=Admin, 3=Super Admin) behind
        the session token — the gate `docker_routes.py` uses for write
        actions (`type >= 2`). This is a permission CHECK, not an identity
        lookup: unlike `validate_session`/`get_username`, it must NEVER raise
        outward for a merely-undeterminable role — any failure (Zabbix
        unreachable, unexpected response shape, ...) degrades to 0 (no
        admin), the safe default, so a flaky Zabbix API can only ever make
        actions MORE restrictive, never accidentally grant them. Cached in
        `_role_cache` (`permission_cache_ttl`).

        Zabbix ≤6.0's `user.checkAuthentication` returns the role `type`
        directly; ≥6.4 returns a `roleid` instead, requiring a follow-up
        `role.get` (with the caller's own token, so it can only see whatever
        role.get already permits) to resolve the type. API tokens are not
        session ids, so `checkAuthentication` fails for them the same way it
        does in `get_username` — the fallback there (a self-scoped
        `user.get`) is reused here, extended with `roleid`/`type`."""
        cached = self._role_cache.get(token)
        if cached is not None:
            return cached
        role_type = await self._resolve_role_type(token)
        self._role_cache.set(token, role_type)
        return role_type

    async def _resolve_role_type(self, token: str) -> int:
        auth: dict | None = None
        try:
            result = await self._call(token, "user.checkAuthentication", {"sessionid": token})
            if isinstance(result, dict):
                auth = result
        except HTTPException:
            pass  # API tokens are not session ids — fall back to user.get below
        if auth is not None:
            if "type" in auth:
                return _as_int(auth.get("type"))
            if auth.get("roleid"):
                return await self._role_type_for_roleid(token, auth["roleid"])
            return 0

        try:
            result = await self._call(
                token, "user.get", {"output": ["userid", "roleid", "type"], "limit": 1}
            )
        except HTTPException:
            return 0
        if not result:
            return 0
        row = result[0]
        if row.get("type") is not None:
            return _as_int(row.get("type"))
        if row.get("roleid"):
            return await self._role_type_for_roleid(token, row["roleid"])
        return 0

    async def _role_type_for_roleid(self, token: str, roleid: Any) -> int:
        try:
            roles = await self._call(token, "role.get", {"output": ["type"], "roleids": [roleid]})
        except HTTPException:
            return 0
        if not roles:
            return 0
        return _as_int(roles[0].get("type"))

    async def check_items_visible(self, token: str, itemids: list[str]) -> None:
        """403 unless the session token may see *all* requested items."""
        missing = [i for i in itemids if self._perm_cache.get(f"{token}:{i}") is not True]
        if not missing:
            return
        result = await self._call(
            token,
            "item.get",
            {"output": ["itemid"], "itemids": missing, "webitems": True},
        )
        visible = {row["itemid"] for row in result}
        for itemid in missing:
            if itemid in visible:
                self._perm_cache.set(f"{token}:{itemid}", True)
        denied = [i for i in missing if i not in visible]
        if denied:
            raise HTTPException(403, f"not permitted for itemids: {', '.join(sorted(denied))}")

    async def get_host_identity(self, token: str, hostid: str) -> dict[str, Any]:
        """Host identity for log-source mapping; 403/404 via host.get with the
        caller's token, so Zabbix permissions gate the logs too."""
        cache_key = f"{token}:{hostid}"
        cached = self._host_cache.get(cache_key)
        if cached is not None:
            return cached
        result = await self._call(
            token,
            "host.get",
            {
                "output": ["hostid", "host", "name"],
                "hostids": [hostid],
                "selectInterfaces": ["ip", "dns"],
            },
        )
        if not result:
            raise HTTPException(403, f"host {hostid} not visible for this session")
        host = result[0]
        self._host_cache.set(cache_key, host)
        return host


def _as_int(value: Any) -> int:
    """Best-effort int coercion for a Zabbix `type` field — never raises;
    an unparsable value means the role could not be determined (0)."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0
