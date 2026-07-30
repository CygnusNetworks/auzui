"""Multiple Graylog servers (PLAN task 2): parallel fan-out, timestamp merge,
partial-failure handling."""

import json

import httpx
import pytest
import respx
from httpx import Response

from auzui_gateway.app import create_app

from .conftest import AUTH, ZABBIX_URL, make_settings, zabbix_result

GL_A = "https://graylog-a.test"
GL_B = "https://graylog-b.test"

SERVERS_JSON = json.dumps(
    [
        {"id": "gl-a", "label": "graylog-a", "url": GL_A, "token": "tok-a"},
        {"id": "gl-b", "label": "graylog-b", "url": GL_B, "token": "tok-b"},
    ]
)


def _search_body(msg_id: str, source: str, ts: str) -> dict:
    return {
        "total_results": 1,
        "messages": [
            {"message": {"_id": msg_id, "timestamp": ts, "source": source, "message": "m"}}
        ],
    }


@pytest.fixture
async def multi_client():
    app = create_app(make_settings(graylog_servers=SERVERS_JSON))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as c:
        yield c


@respx.mock
async def test_servers_endpoint_lists_id_and_label_without_tokens(multi_client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    res = await multi_client.get("/api/logs/servers", headers=AUTH)
    assert res.status_code == 200
    assert res.json()["servers"] == [
        {"id": "gl-a", "label": "graylog-a"},
        {"id": "gl-b", "label": "graylog-b"},
    ]


@respx.mock
async def test_search_merges_two_servers_by_timestamp_desc(multi_client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    respx.get(f"{GL_A}/api/search/universal/absolute").mock(
        return_value=Response(200, json=_search_body("a1", "host-a", "2026-07-29T10:00:00.000Z"))
    )
    respx.get(f"{GL_B}/api/search/universal/absolute").mock(
        return_value=Response(200, json=_search_body("b1", "host-b", "2026-07-29T11:00:00.000Z"))
    )
    res = await multi_client.post(
        "/api/logs/search", json={"from": 0, "to": 1, "limit": 50}, headers=AUTH
    )
    assert res.status_code == 200
    body = res.json()
    # Newest first: host-b (11:00) before host-a (10:00). Each message carries
    # its origin server tag, and ids are server-prefixed for uniqueness.
    assert [m["source"] for m in body["messages"]] == ["host-b", "host-a"]
    assert [m["server_id"] for m in body["messages"]] == ["gl-b", "gl-a"]
    assert body["messages"][0]["id"] == "gl-b:b1"
    assert body["total"] == 2
    assert body["errors"] == []


@respx.mock
async def test_search_partial_failure_returns_other_servers_plus_errors(multi_client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    respx.get(f"{GL_A}/api/search/universal/absolute").mock(
        return_value=Response(200, json=_search_body("a1", "host-a", "2026-07-29T10:00:00.000Z"))
    )
    respx.get(f"{GL_B}/api/search/universal/absolute").mock(
        side_effect=httpx.ConnectError("refused")
    )
    res = await multi_client.post(
        "/api/logs/search", json={"from": 0, "to": 1, "limit": 50}, headers=AUTH
    )
    assert res.status_code == 200
    body = res.json()
    assert [m["source"] for m in body["messages"]] == ["host-a"]
    assert len(body["errors"]) == 1
    assert body["errors"][0]["server_id"] == "gl-b"


@respx.mock
async def test_search_all_servers_fail_is_502(multi_client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    respx.get(f"{GL_A}/api/search/universal/absolute").mock(
        side_effect=httpx.ConnectError("refused")
    )
    respx.get(f"{GL_B}/api/search/universal/absolute").mock(
        side_effect=httpx.ConnectError("refused")
    )
    res = await multi_client.post(
        "/api/logs/search", json={"from": 0, "to": 1, "limit": 50}, headers=AUTH
    )
    assert res.status_code == 502


@respx.mock
async def test_search_servers_param_restricts_to_selected(multi_client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    route_a = respx.get(f"{GL_A}/api/search/universal/absolute").mock(
        return_value=Response(200, json=_search_body("a1", "host-a", "2026-07-29T10:00:00.000Z"))
    )
    route_b = respx.get(f"{GL_B}/api/search/universal/absolute").mock(
        return_value=Response(200, json=_search_body("b1", "host-b", "2026-07-29T11:00:00.000Z"))
    )
    res = await multi_client.post(
        "/api/logs/search",
        json={"from": 0, "to": 1, "limit": 50, "servers": ["gl-a"]},
        headers=AUTH,
    )
    assert res.status_code == 200
    assert [m["source"] for m in res.json()["messages"]] == ["host-a"]
    assert route_a.called
    assert not route_b.called


@respx.mock
async def test_streams_union_tagged_with_server(multi_client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    respx.get(f"{GL_A}/api/streams").mock(
        return_value=Response(200, json={"streams": [{"id": "s1", "title": "A syslog"}]})
    )
    respx.get(f"{GL_B}/api/streams").mock(
        return_value=Response(200, json={"streams": [{"id": "s2", "title": "B syslog"}]})
    )
    res = await multi_client.get("/api/logs/streams", headers=AUTH)
    assert res.status_code == 200
    streams = res.json()["streams"]
    assert {(s["id"], s["server_id"]) for s in streams} == {("s1", "gl-a"), ("s2", "gl-b")}
