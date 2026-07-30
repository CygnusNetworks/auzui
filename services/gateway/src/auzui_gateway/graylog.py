"""Graylog read-only client (PLAN.md section H).

Auth: Graylog API tokens authenticate as HTTP Basic with the token as the
username and the literal password "token". A Bearer fallback exists for
setups that front Graylog with something expecting Authorization: Bearer.

Search uses the legacy universal search API (absolute timerange) — the most
widely compatible path across Graylog versions; the Views/Search-Scripting
API can be added later without changing the gateway surface.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import HTTPException

from .config import GraylogServer, Settings

logger = logging.getLogger(__name__)

# Facility number → name resolution happens in the frontend
# (src/lib/log-facility.ts) since it's pure display logic; the gateway just
# passes facility_num through untouched.


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def escape_lucene_value(value: str) -> str:
    """Escape a value for safe embedding in a Lucene quoted phrase
    (`field:"<value>"`). Only backslash and the closing quote can break out
    of the phrase; escaping those two is sufficient and keeps the value
    otherwise human-readable in the query bar."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


@dataclass(frozen=True)
class LogFilter:
    """One include/exclude filter clicked from a log row (source/facility/application_name)."""

    field: str
    value: str


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
    query = " OR ".join(f'{source_field}:"{escape_lucene_value(a)}"' for a in aliases)
    return query, aliases


# Maps the UI's fixed filter fields to the actual Graylog field name.
# "source" is configurable (graylog_source_field) so it stays consistent with
# how host-scoped searches already match hosts.
def _filter_field_map(source_field: str) -> dict[str, str]:
    return {"source": source_field, "facility": "facility", "application_name": "application_name"}


def build_filter_clause(filters: list[LogFilter], source_field: str, *, negate: bool) -> str:
    """Groups same-field filters with OR, different fields with AND. Negated
    (exclude) clauses become `NOT (...)` so "exclude A, exclude B" reads as
    "neither A nor B", not "not both A and B"."""
    if not filters:
        return ""
    field_map = _filter_field_map(source_field)
    grouped: dict[str, list[str]] = {}
    for f in filters:
        actual_field = field_map.get(f.field, f.field)
        grouped.setdefault(actual_field, []).append(f.value)
    clauses: list[str] = []
    for field, values in grouped.items():
        terms = [f'{field}:"{escape_lucene_value(v)}"' for v in values]
        group = terms[0] if len(terms) == 1 else f"({' OR '.join(terms)})"
        clauses.append(f"NOT {group}" if negate else group)
    return " AND ".join(clauses)


def apply_filters(
    base_query: str, include: list[LogFilter], exclude: list[LogFilter], source_field: str
) -> str:
    """Combines the caller's free-text/Lucene query with the include/exclude
    filter chips into one safely-escaped Lucene query string."""
    parts: list[str] = []
    base = (base_query or "").strip()
    if base and base != "*":
        parts.append(f"({base})" if " OR " in base else base)
    include_clause = build_filter_clause(include, source_field, negate=False)
    if include_clause:
        parts.append(include_clause)
    exclude_clause = build_filter_clause(exclude, source_field, negate=True)
    if exclude_clause:
        parts.append(exclude_clause)
    return " AND ".join(parts) if parts else "*"


class GraylogClient:
    """Read-only client for ONE Graylog server. The multi-server orchestration
    (parallel fan-out, timestamp merge, partial-failure handling) lives in
    GraylogService below."""

    def __init__(self, settings: Settings, server: GraylogServer) -> None:
        self._s = settings
        self._server = server

    @property
    def server(self) -> GraylogServer:
        return self._server

    def _client(self) -> httpx.AsyncClient:
        s = self._s
        headers = {"Accept": "application/json", "X-Requested-By": "auzui-gateway"}
        auth: tuple[str, str] | None = None
        if s.graylog_bearer_auth:
            headers["Authorization"] = f"Bearer {self._server.token}"
        else:
            auth = (self._server.token, "token")
        return httpx.AsyncClient(
            base_url=self._server.url.rstrip("/"),
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
                    "server_id": self._server.id,
                    "server_label": self._server.label,
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
            # Stable id for React list keys (live mode re-fetches on a
            # sliding window; without a stable id every refresh remounts the
            # whole row list and the UI flickers). Graylog message ids are
            # `_id` (or `gl2_message_id` on some setups); fall back to a
            # deterministic composite key if neither is present.
            fallback_id = f"{ts_raw}:{m.get('source', '')}:{m.get('message', '')}"
            msg_id = m.get("_id") or m.get("gl2_message_id") or fallback_id
            known = {
                "timestamp",
                "source",
                "message",
                "level",
                "facility",
                "facility_num",
                "streams",
                "_id",
            }
            messages.append(
                {
                    "id": f"{self._server.id}:{msg_id}",
                    "timestamp": ts,
                    "source": m.get("source", ""),
                    "message": m.get("message", ""),
                    "level": m.get("level"),
                    "facility": m.get("facility"),
                    "facility_num": m.get("facility_num"),
                    "stream_ids": m.get("streams", []),
                    "server_id": self._server.id,
                    "server_label": self._server.label,
                    "fields": {
                        k: v for k, v in m.items() if k not in known and not k.startswith("gl2_")
                    },
                }
            )
        return {"messages": messages, "total": int(body.get("total_results", len(messages)))}


class GraylogService:
    """Fans a search/stream request out across the selected Graylog servers,
    running them in parallel and merging the results. A single server failing
    yields a partial result plus an `errors` entry rather than a 5xx for the
    whole request (PLAN task 2)."""

    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._clients: dict[str, GraylogClient] = {
            srv.id: GraylogClient(settings, srv) for srv in settings.graylog_server_list
        }

    @property
    def enabled(self) -> bool:
        return bool(self._clients)

    def server_list(self) -> list[dict[str, str]]:
        """[{id, label}] — never exposes tokens or URLs."""
        return [{"id": c.server.id, "label": c.server.label} for c in self._clients.values()]

    def _select(self, server_ids: list[str] | None) -> list[GraylogClient]:
        if not server_ids:
            return list(self._clients.values())
        selected = [self._clients[sid] for sid in server_ids if sid in self._clients]
        # Unknown ids are ignored; if the caller selected only unknown servers
        # fall back to all so the request still returns something meaningful.
        return selected or list(self._clients.values())

    async def streams(self, server_ids: list[str] | None = None) -> list[dict[str, Any]]:
        """Union of streams across the selected servers, each tagged with its
        server_id/server_label. One unreachable server does not fail the rest."""
        clients = self._select(server_ids)
        results = await asyncio.gather(*(c.streams() for c in clients), return_exceptions=True)
        streams: list[dict[str, Any]] = []
        for client, res in zip(clients, results, strict=True):
            if isinstance(res, BaseException):
                logger.warning("streams from server %s failed: %r", client.server.id, res)
                continue
            streams.extend(res)
        # Every selected server failed → surface it (single-server: the classic
        # "Graylog down" 502) rather than a misleading empty stream list.
        if streams == [] and all(isinstance(r, BaseException) for r in results) and results:
            first = next(r for r in results if isinstance(r, BaseException))
            if isinstance(first, HTTPException):
                raise first
            raise HTTPException(502, f"Graylog unreachable: {first.__class__.__name__}")
        return streams

    async def search(
        self,
        query: str,
        time_from: float,
        time_to: float,
        limit: int,
        offset: int = 0,
        stream_ids: list[str] | None = None,
        server_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Query every selected server with the same limit+offset, then merge
        all returned messages by timestamp (descending) and cap the merged list
        to `limit`. `total` is the sum of the per-server totals. Pagination is
        therefore approximate across servers (each page pulls limit rows per
        server and keeps the newest `limit` of the union) — documented, simple
        and correct enough for log triage; deep offsets stay monotonic."""
        clients = self._select(server_ids)
        results = await asyncio.gather(
            *(c.search(query, time_from, time_to, limit, offset, stream_ids) for c in clients),
            return_exceptions=True,
        )
        merged: list[dict[str, Any]] = []
        total = 0
        errors: list[dict[str, str]] = []
        for client, res in zip(clients, results, strict=True):
            if isinstance(res, BaseException):
                detail = res.detail if isinstance(res, HTTPException) else res.__class__.__name__
                logger.warning("search on server %s failed: %r", client.server.id, res)
                errors.append({"server_id": client.server.id, "error": str(detail)})
                continue
            merged.extend(res["messages"])
            total += res["total"]
        merged.sort(key=lambda m: m["timestamp"], reverse=True)
        # If every selected server errored, surface it as an upstream failure
        # rather than a misleading empty-but-ok result.
        if errors and not any(not isinstance(r, BaseException) for r in results):
            raise HTTPException(502, f"all Graylog servers failed: {errors}")
        return {"messages": merged[:limit], "total": total, "errors": errors}
