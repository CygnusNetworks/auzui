"""Compare time-series backends for the gateway's /api/ts/query path.

Runs the real InfluxClient / ClickHouseClient (same code the gateway uses)
and, optionally, the equivalent downsampling query against TimescaleDB with
the Zabbix PostgreSQL schema. Identical itemids, ranges and point budgets;
reports the median latency and checks that every backend returns the same
points as ClickHouse.

    uv run --package auzui-gateway --with 'psycopg[binary]' \\
        python dev/clickhouse/bench.py --items items.txt --pg-dsn postgresql://...

Influx connection from INFLUXDB_URL/TOKEN/ORG/BUCKET, ClickHouse from
--ch-url etc. (defaults: local dev container, read-only user auzui).
"""

import argparse
import asyncio
import os
import statistics
import time
from pathlib import Path

import httpx

from auzui_gateway.clickhouse import ClickHouseClient
from auzui_gateway.config import Settings
from auzui_gateway.influx import InfluxClient, choose_every

DAY = 86_400
RANGES = {
    "1h": 3600,
    "24h": DAY,
    "7d": 7 * DAY,
    "30d": 30 * DAY,
    "90d": 90 * DAY,
    "360d": 360 * DAY,
}

# What an auzui TimescaleDB backend would run: same windows (epoch-aligned,
# timestamp = window end) and `last` semantics (newest clock+ns per window).
PG_SQL = """
SELECT itemid::text, (clock / %(every)s) * %(every)s + %(every)s AS t,
       last(value, clock::bigint * 1000000000 + ns) AS v
FROM (
    SELECT itemid, clock, ns, value FROM history
    WHERE itemid = ANY(%(ids)s) AND clock >= %(start)s AND clock < %(end)s
    UNION ALL
    SELECT itemid, clock, ns, value::float8 FROM history_uint
    WHERE itemid = ANY(%(ids)s) AND clock >= %(start)s AND clock < %(end)s
) x
GROUP BY 1, 2 ORDER BY 1, 2
"""


class TimescaleSource:
    def __init__(self, conn, min_window: int) -> None:
        self._conn = conn
        self._min_window = min_window

    async def query_series(self, itemids, start, end, points, fn):
        every = choose_every(start, end, points, self._min_window)
        params = {"ids": [int(i) for i in itemids], "start": start, "end": end, "every": every}
        series: dict[str, list[tuple[float, float]]] = {i: [] for i in itemids}
        async with self._conn.cursor() as cur:
            await cur.execute(PG_SQL, params)
            for itemid, t, v in await cur.fetchall():
                series[itemid].append((float(t), float(v)))
        return series


async def timed(coro_fn, runs: int):
    times, result = [], None
    for _ in range(runs):
        t = time.perf_counter()
        result = await coro_fn()
        times.append((time.perf_counter() - t) * 1000)
    return statistics.median(times), result


def diff(ref: dict, other: dict) -> int:
    """Number of points that differ (missing/extra timestamp or value)."""
    bad = 0
    for itemid in ref:
        pa, pb = dict(ref[itemid]), dict(other.get(itemid, []))
        bad += len(set(pa) ^ set(pb))
        bad += sum(1 for t in set(pa) & set(pb) if abs(pa[t] - pb[t]) > 1e-6 * max(1, abs(pa[t])))
    return bad


async def influx_rtt(s: Settings) -> float:
    """Round trip of a trivial request = network/HTTP overhead, not query work."""
    async with httpx.AsyncClient() as c:
        times = []
        for _ in range(5):
            t = time.perf_counter()
            await c.get(f"{s.influx_url}/ping")
            times.append((time.perf_counter() - t) * 1000)
    return statistics.median(times)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", required=True)
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--points", type=int, default=800)
    ap.add_argument("--ch-url", default="http://127.0.0.1:8123")
    ap.add_argument("--ch-user", default="auzui")
    ap.add_argument("--ch-password", default="auzui")
    ap.add_argument("--pg-dsn", default="", help="TimescaleDB DSN; empty = skip TimescaleDB")
    ap.add_argument("--ranges", default="1h,24h,7d,30d", help=f"subset of {','.join(RANGES)}")
    ap.add_argument("--no-influx", action="store_true", help="skip InfluxDB")
    ap.add_argument("--end", type=int, default=0, help="range end (unix); default: today 00:00 UTC")
    a = ap.parse_args()

    env = os.environ
    s = Settings(
        _env_file=None,
        influx_url=env["INFLUXDB_URL"],
        influx_token=env["INFLUXDB_TOKEN"],
        influx_org=env["INFLUXDB_ORG"],
        influx_bucket=env.get("INFLUXDB_BUCKET", "zabbix"),
        influx_timeout=120,
        clickhouse_url=a.ch_url,
        clickhouse_user=a.ch_user,
        clickhouse_password=a.ch_password,
        clickhouse_timeout=120,
    )
    backends = {"clickhouse": ClickHouseClient(s)}
    if not a.no_influx:
        backends["influx"] = InfluxClient(s)
    conn = None
    if a.pg_dsn:
        import psycopg  # only needed for the TimescaleDB comparison

        conn = await psycopg.AsyncConnection.connect(a.pg_dsn, autocommit=True)
        backends["timescale"] = TimescaleSource(conn, s.clickhouse_min_window_seconds)

    lines = Path(a.items).read_text().splitlines()  # noqa: ASYNC240 - one-off CLI
    itemids = [ln.strip() for ln in lines if ln.strip().isdigit()]
    sets = {
        "1 item": itemids[:1],
        "10 items": itemids[:10],
        "50 items": itemids[:50],
        "100 items": itemids[:100],
    }

    if "influx" in backends:
        print(f"Influx round trip (/ping): {await influx_rtt(s):.0f} ms\n")
    names = list(backends)
    print(f"{'items':<10} {'range':<5} " + " ".join(f"{n + ' ms':>14}" for n in names) + "  diff")
    # Default end = today 00:00 UTC, where influx_import.py stops importing.
    end = a.end or (int(time.time()) // 86_400) * 86_400
    for label, ids in sets.items():
        for rname in a.ranges.split(","):
            span = RANGES[rname]
            start = end - span
            res, ms = {}, {}
            for name, b in backends.items():
                ms[name], res[name] = await timed(
                    lambda b=b, ids=ids, start=start: b.query_series(
                        ids, start, end, a.points, "last"
                    ),
                    a.runs,
                )
            ref = res["clickhouse"]
            npts = sum(len(v) for v in ref.values())
            diffs = ", ".join(f"{n} {diff(ref, res[n])}" for n in names[1:])
            print(
                f"{label:<10} {rname:<5} "
                + " ".join(f"{ms[n]:>14.0f}" for n in names)
                + f"  {npts} pts; {diffs}"
            )
    await backends["clickhouse"].aclose()
    if conn is not None:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
