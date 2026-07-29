"""Graylog read-only client (PLAN.md section H).

Auth: Graylog API tokens authenticate as HTTP Basic with the token as the
username and the literal password "token". A Bearer fallback exists for
setups that front Graylog with something expecting Authorization: Bearer.

Search uses the legacy universal search API (absolute timerange) — the most
widely compatible path across Graylog versions; the Views/Search-Scripting
API can be added later without changing the gateway surface.
"""

import logging
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import HTTPException

from .config import Settings

logger = logging.getLogger(__name__)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def build_host_query(host: dict[str, Any], source_field: str) -> tuple[str, list[str]]:
    """OR-query over the host's likely syslog source aliases, in mapping
    priority order: technical name, visible name, interface DNS, interface IP."""
    aliases: list[str] = []

    def add(value: str | None) -> None:
        if value and value not in aliases:
            aliases.append(value)

    add(host.get("host"))
    name = host.get("name")
    if name != host.get("host"):
        add(name)
    for iface in host.get("interfaces") or []:
        add(iface.get("dns"))
    for iface in host.get("interfaces") or []:
        add(iface.get("ip"))

    if not aliases:
        raise HTTPException(404, "no source aliases derivable for this host")
    query = " OR ".join(f'{source_field}:"{a}"' for a in aliases)
    return query, aliases


class GraylogClient:
    def __init__(self, settings: Settings) -> None:
        self._s = settings

    def _client(self) -> httpx.AsyncClient:
        s = self._s
        headers = {"Accept": "application/json", "X-Requested-By": "auzui-gateway"}
        auth: tuple[str, str] | None = None
        if s.graylog_bearer_auth:
            headers["Authorization"] = f"Bearer {s.graylog_token}"
        else:
            auth = (s.graylog_token, "token")
        return httpx.AsyncClient(
            base_url=s.graylog_url.rstrip("/"),
            timeout=s.graylog_timeout,
            verify=s.graylog_verify_tls,
            headers=headers,
            auth=auth,
        )

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        try:
            async with self._client() as client:
                res = await client.get(path, params=params)
        except httpx.TimeoutException as e:
            raise HTTPException(504, "Graylog timeout") from e
        except httpx.HTTPError as e:
            raise HTTPException(502, f"Graylog unreachable: {e.__class__.__name__}") from e
        if res.status_code == 401:
            raise HTTPException(502, "Graylog rejected the gateway token")
        if res.status_code != 200:
            raise HTTPException(502, f"Graylog returned HTTP {res.status_code}")
        return res.json()

    async def streams(self) -> list[dict[str, Any]]:
        body = await self._get("/api/streams")
        allowed = set(self._s.default_stream_ids)
        streams = []
        for s in body.get("streams", []):
            if allowed and s.get("id") not in allowed:
                continue
            streams.append(
                {
                    "id": s.get("id"),
                    "title": s.get("title", ""),
                    "description": s.get("description", ""),
                    "disabled": bool(s.get("disabled", False)),
                    "is_default": bool(s.get("is_default", False)),
                }
            )
        return streams

    async def search(
        self,
        query: str,
        time_from: float,
        time_to: float,
        limit: int,
        offset: int = 0,
        stream_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "query": query or "*",
            "from": _iso(time_from),
            "to": _iso(time_to),
            "limit": limit,
            "offset": offset,
            "sort": "timestamp:desc",
        }
        effective_streams = stream_ids or self._s.default_stream_ids
        if effective_streams:
            params["filter"] = "streams:" + ",".join(effective_streams)
        body = await self._get("/api/search/universal/absolute", params)

        messages = []
        for wrapper in body.get("messages", []):
            m = wrapper.get("message", {})
            ts_raw = m.get("timestamp")
            try:
                ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00")).timestamp()
            except ValueError:
                ts = 0.0
            known = {"timestamp", "source", "message", "level", "facility", "streams"}
            messages.append(
                {
                    "timestamp": ts,
                    "source": m.get("source", ""),
                    "message": m.get("message", ""),
                    "level": m.get("level"),
                    "facility": m.get("facility"),
                    "stream_ids": m.get("streams", []),
                    "fields": {
                        k: v for k, v in m.items() if k not in known and not k.startswith("gl2_")
                    },
                }
            )
        return {"messages": messages, "total": int(body.get("total_results", len(messages)))}
