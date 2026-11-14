"""ClickHouse time-series backend (clickhouse.py) and backend selection."""

import asyncio
import os
import time

import httpx
import pytest
import respx
from httpx import Response

from auzui_gateway.app import create_app
from auzui_gateway.clickhouse import ClickHouseClient, build_sql

from .conftest import AUTH, ZABBIX_URL, make_settings, zabbix_result

CH_URL = "https://clickhouse.test:8443"


@pytest.fixture
async def ch_client():
    app = create_app(
        make_settings(
            clickhouse_url=CH_URL, clickhouse_user="auzui", clickhouse_password="ch-secret"
        )
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as c:
        yield c


def test_database_name_must_be_plain_identifier():
    assert make_settings(clickhouse_database="zabbix_8").clickhouse_database == "zabbix_8"
    for bad in ("", "1db", "a-b", "zabbix; DROP TABLE x", "a.b", "`x`"):
        with pytest.raises(ValueError):
            make_settings(clickhouse_database=bad)


def test_max_concurrent_must_be_positive():
    assert make_settings(clickhouse_max_concurrent=1).clickhouse_max_concurrent == 1
    for bad in (0, -1):
        with pytest.raises(ValueError):
            make_settings(clickhouse_max_concurrent=bad)


# ---- backend selection -----------------------------------------------------


def test_auto_prefers_clickhouse_over_influx():
    s = make_settings(clickhouse_url=CH_URL)
    assert s.ts_backend_active == "clickhouse"


def test_auto_falls_back_to_influx():
    assert make_settings().ts_backend_active == "influx"


def test_forced_backend_must_be_configured():
    assert make_settings(clickhouse_url=CH_URL, ts_backend="influx").ts_backend_active == "influx"
    assert make_settings(ts_backend="clickhouse").ts_backend_active is None


async def test_status_reports_clickhouse(ch_client):
    res = await ch_client.get("/api/ts/status")
    assert res.json() == {"enabled": True, "backend": "clickhouse"}


# ---- query building --------------------------------------------------------


def test_sql_uses_typed_parameters_only():
    sql = build_sql("zabbix", "last")
    assert "{itemids:Array(UInt64)}" in sql
    assert "argMax(value, clock_ns)" in sql
    assert "zabbix.history\n" in sql and "zabbix.history_uint\n" in sql


@pytest.mark.parametrize(
    ("fn", "expr"), [("mean", "avg(value)"), ("min", "min(value)"), ("max", "max(value)")]
)
def test_sql_aggregate_per_fn(fn, expr):
    assert expr in build_sql("zabbix", fn)


# ---- HTTP path -------------------------------------------------------------


@respx.mock
async def test_ts_query_via_clickhouse(ch_client):
    respx.post(ZABBIX_URL).mock(
        return_value=Response(200, json=zabbix_result([{"itemid": "357562"}]))
    )
    ch_route = respx.post(f"{CH_URL}/").mock(
        return_value=Response(
            200,
            json={
                "meta": [],
                "data": [["357562", 3660, 42.5], ["357562", 3720, 43.1]],
                "rows": 2,
            },
        )
    )
    res = await ch_client.post(
        "/api/ts/query",
        json={"itemids": ["357562"], "start": 3600, "end": 7200, "points": 60},
        headers=AUTH,
    )
    assert res.status_code == 200
    assert res.json()["series"] == [
        {"itemid": "357562", "points": [[3660.0, 42.5], [3720.0, 43.1]]}
    ]

    req = ch_route.calls[0].request
    # Credentials stay server-side; the caller's Zabbix token is not forwarded.
    assert req.headers["X-ClickHouse-User"] == "auzui"
    assert req.headers["X-ClickHouse-Key"] == "ch-secret"
    assert "authorization" not in req.headers
    assert req.url.params["param_itemids"] == "[357562]"
    assert req.url.params["param_every"] == "60"


@respx.mock
async def test_clickhouse_error_maps_to_502(ch_client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"itemid": "1"}])))
    respx.post(f"{CH_URL}/").mock(return_value=Response(500, text="Code: 241. MEMORY_LIMIT"))
    res = await ch_client.post(
        "/api/ts/query", json={"itemids": ["1"], "start": 0, "end": 3600}, headers=AUTH
    )
    assert res.status_code == 502


# ---- live check against a real ClickHouse (dev/clickhouse/compose.yml) ------

LIVE_URL = os.environ.get("AUZUI_TEST_CLICKHOUSE_URL", "")


@pytest.mark.skipif(not LIVE_URL, reason="AUZUI_TEST_CLICKHOUSE_URL not set")
async def test_live_query_against_clickhouse():
    """Insert a known series into a scratch database and read it back through
    the real client — validates the SQL, not just the plumbing."""
    admin = ("admin", "admin")
    db = "auzui_test"
    t0 = (int(time.time()) // 3600) * 3600 - 3600
    async with httpx.AsyncClient(base_url=LIVE_URL, auth=admin) as http:
        for stmt in (
            f"DROP DATABASE IF EXISTS {db}",
            f"CREATE DATABASE {db}",
            f"CREATE TABLE {db}.history (itemid UInt64, clock_ns DateTime64(9), value Float64)"
            " ENGINE = MergeTree ORDER BY (itemid, clock_ns)",
            f"CREATE TABLE {db}.history_uint (itemid UInt64, clock_ns DateTime64(9),"
            " value UInt64) ENGINE = MergeTree ORDER BY (itemid, clock_ns)",
            # item 1: float, 2 samples per minute over one hour
            f"INSERT INTO {db}.history SELECT 1, toDateTime64({t0} + number * 30, 9),"
            " number FROM numbers(120)",
            # item 2: uint, one sample per minute
            f"INSERT INTO {db}.history_uint SELECT 2, toDateTime64({t0} + number * 60, 9),"
            " number * 10 FROM numbers(60)",
        ):
            (await http.post("/", content=stmt)).raise_for_status()

    s = make_settings(
        clickhouse_url=LIVE_URL,
        clickhouse_user="admin",
        clickhouse_password="admin",
        clickhouse_database=db,
    )
    ch = ClickHouseClient(s)
    series = await ch.query_series(["1", "2"], t0, t0 + 3600, 60, "last")
    assert len(series["1"]) == 60 and len(series["2"]) == 60
    # window end timestamps; last of the two samples in the first minute
    assert series["1"][0] == (float(t0 + 60), 1.0)
    assert series["2"][-1] == (float(t0 + 3600), 590.0)

    mean = await ch.query_series(["1"], t0, t0 + 3600, 60, "mean")
    await ch.aclose()
    assert mean["1"][0] == (float(t0 + 60), 0.5)


@respx.mock
async def test_concurrent_queries_are_capped():
    in_flight = 0
    peak = 0

    async def handler(request):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.02)
        in_flight -= 1
        return Response(200, json={"data": [["1", 1000, 1.5]]})

    respx.post(CH_URL + "/").mock(side_effect=handler)
    client = ClickHouseClient(make_settings(clickhouse_url=CH_URL, clickhouse_max_concurrent=2))
    try:
        results = await asyncio.gather(
            *(client.query_series(["1"], 0, 3600, 60, "mean") for _ in range(10))
        )
    finally:
        await client.aclose()
    assert peak == 2
    assert all(r == {"1": [(1000.0, 1.5)]} for r in results)
    assert len(results) == 10
