import respx
from httpx import Response

from .conftest import AUTH, INFLUX_URL, ZABBIX_URL, zabbix_result

INFLUX_CSV = (
    ",result,table,_start,_stop,_time,_value,_field,_measurement,itemid\r\n"
    ",_result,0,2026-07-29T00:00:00Z,2026-07-29T01:00:00Z,"
    "2026-07-29T00:00:30Z,42.5,value,history_uint,357562\r\n"
    ",_result,0,2026-07-29T00:00:00Z,2026-07-29T01:00:00Z,"
    "2026-07-29T00:01:30Z,43.1,value,history_uint,357562\r\n"
)


async def test_ts_status_enabled(client):
    res = await client.get("/api/ts/status")
    assert res.status_code == 200
    assert res.json() == {"enabled": True}


async def test_ts_status_disabled(client_disabled):
    res = await client_disabled.get("/api/ts/status")
    assert res.json() == {"enabled": False}


async def test_ts_query_requires_token(client):
    res = await client.post("/api/ts/query", json={"itemids": ["1"], "start": 0, "end": 3600})
    assert res.status_code == 401


@respx.mock
async def test_ts_query_happy_path(client):
    respx.post(ZABBIX_URL).mock(
        return_value=Response(200, json=zabbix_result([{"itemid": "357562"}]))
    )
    influx_route = respx.post(f"{INFLUX_URL}/api/v2/query").mock(
        return_value=Response(200, text=INFLUX_CSV)
    )

    res = await client.post(
        "/api/ts/query",
        json={"itemids": ["357562"], "start": 0, "end": 3600, "points": 60},
        headers=AUTH,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["series"][0]["itemid"] == "357562"
    assert len(body["series"][0]["points"]) == 2
    assert body["series"][0]["points"][0][1] == 42.5

    # Influx token stays server-side; caller's Zabbix token is NOT forwarded.
    influx_req = influx_route.calls[0].request
    assert influx_req.headers["Authorization"] == "Token influx-secret"
    assert b"aggregateWindow(every: 60s" in influx_req.content


@respx.mock
async def test_ts_query_permission_denied(client):
    # Zabbix only confirms one of the two requested items.
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"itemid": "1"}])))
    res = await client.post(
        "/api/ts/query",
        json={"itemids": ["1", "2"], "start": 0, "end": 60},
        headers=AUTH,
    )
    assert res.status_code == 403
    assert "2" in res.json()["detail"]


@respx.mock
async def test_ts_query_invalid_session(client):
    respx.post(ZABBIX_URL).mock(
        return_value=Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "error": {
                    "code": -32602,
                    "message": "Invalid params.",
                    "data": "Session terminated, re-login, please.",
                },
            },
        )
    )
    res = await client.post(
        "/api/ts/query", json={"itemids": ["1"], "start": 0, "end": 60}, headers=AUTH
    )
    assert res.status_code == 401


@respx.mock
async def test_ts_query_influx_error_is_502(client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"itemid": "1"}])))
    respx.post(f"{INFLUX_URL}/api/v2/query").mock(return_value=Response(500, text="boom"))
    res = await client.post(
        "/api/ts/query", json={"itemids": ["1"], "start": 0, "end": 60}, headers=AUTH
    )
    assert res.status_code == 502


async def test_ts_query_disabled_is_404(client_disabled):
    res = await client_disabled.post(
        "/api/ts/query", json={"itemids": ["1"], "start": 0, "end": 60}, headers=AUTH
    )
    assert res.status_code == 404


async def test_ts_query_validates_range(client):
    res = await client.post(
        "/api/ts/query", json={"itemids": ["1"], "start": 100, "end": 100}, headers=AUTH
    )
    assert res.status_code == 422
