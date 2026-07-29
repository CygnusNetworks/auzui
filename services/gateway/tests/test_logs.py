import json

import respx
from httpx import Response

from .conftest import AUTH, GRAYLOG_URL, ZABBIX_URL, zabbix_result

STREAMS_BODY = {
    "streams": [
        {
            "id": "s1",
            "title": "Syslog",
            "description": "All syslog",
            "disabled": False,
            "is_default": True,
        },
        {
            "id": "s2",
            "title": "Netflow",
            "description": "",
            "disabled": True,
            "is_default": False,
        },
    ]
}

SEARCH_BODY = {
    "total_results": 1,
    "messages": [
        {
            "message": {
                "timestamp": "2026-07-29T12:00:00.000Z",
                "source": "acc-sw-b04",
                "message": "Port 1/1/24: link down",
                "level": 4,
                "facility": "local0",
                "streams": ["s1"],
                "gl2_remote_ip": "192.0.2.14",
                "vlan": "40",
            }
        }
    ],
}


async def test_logs_status(client, client_disabled):
    assert (await client.get("/api/logs/status")).json() == {"enabled": True}
    assert (await client_disabled.get("/api/logs/status")).json() == {"enabled": False}


@respx.mock
async def test_streams_listed_with_valid_session(client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    graylog_route = respx.get(f"{GRAYLOG_URL}/api/streams").mock(
        return_value=Response(200, json=STREAMS_BODY)
    )
    res = await client.get("/api/logs/streams", headers=AUTH)
    assert res.status_code == 200
    streams = res.json()["streams"]
    assert [s["id"] for s in streams] == ["s1", "s2"]
    # Graylog API token as Basic token:token, never the caller's Zabbix token.
    auth_header = graylog_route.calls[0].request.headers["Authorization"]
    assert auth_header.startswith("Basic ")


@respx.mock
async def test_search_passes_query_and_range(client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    route = respx.get(f"{GRAYLOG_URL}/api/search/universal/absolute").mock(
        return_value=Response(200, json=SEARCH_BODY)
    )
    res = await client.post(
        "/api/logs/search",
        json={"query": "level:<=4", "from": 1000, "to": 2000, "limit": 5},
        headers=AUTH,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    msg = body["messages"][0]
    assert msg["source"] == "acc-sw-b04"
    # gl2_* internals are stripped from fields, custom fields survive
    assert "gl2_remote_ip" not in msg["fields"]
    assert msg["fields"]["vlan"] == "40"

    params = dict(route.calls[0].request.url.params)
    assert params["query"] == "level:<=4"
    assert params["limit"] == "5"
    assert params["from"].startswith("1970-01-01T00:16:40")


@respx.mock
async def test_host_logs_builds_or_query_and_checks_permission(client):
    def zabbix_side_effect(request):
        payload = json.loads(request.content)
        assert payload["method"] == "host.get"
        return Response(
            200,
            json=zabbix_result(
                [
                    {
                        "hostid": "42",
                        "host": "acc-sw-b04",
                        "name": "Access Switch B04",
                        "interfaces": [{"ip": "192.0.2.14", "dns": "acc-sw-b04.example.com"}],
                    }
                ]
            ),
        )

    respx.post(ZABBIX_URL).mock(side_effect=zabbix_side_effect)
    route = respx.get(f"{GRAYLOG_URL}/api/search/universal/absolute").mock(
        return_value=Response(200, json=SEARCH_BODY)
    )

    res = await client.post("/api/logs/host/42", json={"from": 0, "to": 100}, headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["matched_sources"] == [
        "acc-sw-b04",
        "Access Switch B04",
        "acc-sw-b04.example.com",
        "192.0.2.14",
    ]
    query = dict(route.calls[0].request.url.params)["query"]
    assert 'source:"acc-sw-b04"' in query
    assert 'source:"192.0.2.14"' in query
    assert " OR " in query


@respx.mock
async def test_host_logs_denied_when_host_not_visible(client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([])))
    res = await client.post("/api/logs/host/99", json={"from": 0, "to": 100}, headers=AUTH)
    assert res.status_code == 403


async def test_logs_disabled_is_404(client_disabled):
    res = await client_disabled.post("/api/logs/search", json={"from": 0, "to": 1}, headers=AUTH)
    assert res.status_code == 404


@respx.mock
async def test_graylog_down_is_502_not_traceback(client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    import httpx

    respx.get(f"{GRAYLOG_URL}/api/streams").mock(side_effect=httpx.ConnectError("refused"))
    res = await client.get("/api/logs/streams", headers=AUTH)
    assert res.status_code == 502
