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
        self._host_cache: TTLCache[dict[str, Any] | None] = TTLCache(
            settings.host_mapping_cache_ttl
        )

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
            # Invalid/expired session token → the caller must re-login.
            if "not authori" in message.lower() or "session" in message.lower():
                raise HTTPException(401, message)
            raise HTTPException(502, f"Zabbix API error: {message}")
        return body.get("result")

    async def validate_session(self, token: str) -> None:
        """401 unless the token belongs to a live Zabbix session. Cached."""
        if self._perm_cache.get(f"session:{token}") is True:
            return
        await self._call(token, "user.get", {"output": ["userid"], "limit": 1})
        self._perm_cache.set(f"session:{token}", True)

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
