"""ClickHouse (Zabbix 8.0 history provider) query path.

Zabbix 8.0 can store history in ClickHouse: tables `history` (float) and
`history_uint` (uint) with columns `itemid UInt64, clock_ns DateTime64(9),
value`, primary key `(itemid, clock_ns)`. This client reads those tables
directly with the same server-side downsampling the Influx path does with
Flux `aggregateWindow`, so it is a drop-in replacement for InfluxClient.

Semantics deliberately mirror the Flux query in influx.py:
- one point per (itemid, window), windows aligned to the epoch;
- the timestamp is the window END (aggregateWindow's default timeSrc
  "_stop"), so charts look identical whichever backend serves them;
- empty windows are omitted (createEmpty: false).

All user-controlled values go in as typed query parameters ({name:Type}),
never by string interpolation.
"""

import logging

import httpx
from fastapi import HTTPException

from .config import Settings
from .influx import choose_every

logger = logging.getLogger(__name__)

# Aggregate expressions per auzui fn. `last` = value with the newest
# timestamp inside the window (Flux `last` on time-sorted data).
_AGGREGATES = {
    "last": "argMax(value, clock_ns)",
    "mean": "avg(value)",
    "min": "min(value)",
    "max": "max(value)",
}

TABLES = ("history", "history_uint")


def build_sql(database: str, fn: str) -> str:
    """Downsampling query over both numeric history tables.

    The request does not carry value types, so both tables are queried; the
    `itemid IN` filter hits the primary key, so the table that does not hold
    an item costs only an index lookup.
    """
    agg = _AGGREGATES[fn]
    union = "\n    UNION ALL\n".join(
        f"    SELECT itemid, clock_ns, toFloat64(value) AS value FROM {database}.{t}\n"
        "    WHERE itemid IN {itemids:Array(UInt64)}\n"
        "      AND clock_ns >= toDateTime64({start:Int64}, 9)\n"
        "      AND clock_ns < toDateTime64({end:Int64}, 9)"
        for t in TABLES
    )
    return (
        "SELECT toString(itemid) AS itemid,\n"
        "       toUnixTimestamp(toStartOfInterval(clock_ns, INTERVAL {every:UInt32} SECOND))"
        " + {every:UInt32} AS t,\n"
        f"       {agg} AS v\n"
        f"FROM (\n{union}\n)\n"
        "GROUP BY itemid, t\n"
        "ORDER BY itemid, t\n"
        "FORMAT JSONCompact"
    )


class ClickHouseClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        # Pooled keep-alive connection: for small queries the TCP/HTTP setup
        # costs more than the query itself (ClickHouse answers in ~3 ms).
        self._http: httpx.AsyncClient | None = None

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=self._settings.clickhouse_timeout)
        return self._http

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def query_series(
        self, itemids: list[str], start: int, end: int, points: int, fn: str
    ) -> dict[str, list[tuple[float, float]]]:
        s = self._settings
        every = choose_every(start, end, points, s.clickhouse_min_window_seconds)
        params = {
            "param_itemids": "[" + ",".join(str(int(i)) for i in itemids) + "]",
            "param_start": str(start),
            "param_end": str(end),
            "param_every": str(every),
        }
        headers = {}
        if s.clickhouse_user:
            headers["X-ClickHouse-User"] = s.clickhouse_user
            headers["X-ClickHouse-Key"] = s.clickhouse_password
        try:
            res = await self._client().post(
                s.clickhouse_url.rstrip("/") + "/",
                params=params,
                headers=headers,
                content=build_sql(s.clickhouse_database, fn),
            )
        except httpx.TimeoutException as e:
            raise HTTPException(504, "ClickHouse timeout") from e
        except httpx.HTTPError as e:
            raise HTTPException(502, f"ClickHouse unreachable: {e.__class__.__name__}") from e

        if res.status_code != 200:
            logger.warning("clickhouse query failed: %s %s", res.status_code, res.text[:300])
            raise HTTPException(502, f"ClickHouse returned HTTP {res.status_code}")

        return _parse_json_compact(res.json(), itemids)


def _parse_json_compact(body: dict, itemids: list[str]) -> dict[str, list[tuple[float, float]]]:
    """Parse FORMAT JSONCompact rows [itemid, t, v] into {itemid: [(t, v)]}."""
    series: dict[str, list[tuple[float, float]]] = {i: [] for i in itemids}
    for row in body.get("data", []):
        itemid, t, v = str(row[0]), row[1], row[2]
        if itemid not in series or v is None:
            continue
        try:
            series[itemid].append((float(t), float(v)))
        except (TypeError, ValueError):
            continue
    return series
