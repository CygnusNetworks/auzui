import json

import respx
from httpx import Response

from auzui_gateway.graylog import LogFilter, apply_filters, build_filter_clause, escape_lucene_value

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
                "_id": "msg-1",
                "timestamp": "2026-07-29T12:00:00.000Z",
                "source": "acc-sw-b04",
                "message": "Port 1/1/24: link down",
                "level": 4,
                "facility": "local0",
                "facility_num": 16,
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
    # ids are prefixed with the server id so they stay unique across servers
    assert msg["id"] == "default:msg-1"
    assert msg["server_id"] == "default"
    assert msg["facility_num"] == 16
    # gl2_* internals are stripped from fields, custom fields survive
    assert "gl2_remote_ip" not in msg["fields"]
    assert msg["fields"]["vlan"] == "40"

    params = dict(route.calls[0].request.url.params)
    assert params["query"] == "level:<=4"
    assert params["limit"] == "5"
    assert params["from"].startswith("1970-01-01T00:16:40")


@respx.mock
async def test_search_passes_offset_for_pagination(client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    route = respx.get(f"{GRAYLOG_URL}/api/search/universal/absolute").mock(
        return_value=Response(200, json=SEARCH_BODY)
    )
    res = await client.post(
        "/api/logs/search",
        json={"query": "*", "from": 1000, "to": 2000, "limit": 50, "offset": 100},
        headers=AUTH,
    )
    assert res.status_code == 200
    params = dict(route.calls[0].request.url.params)
    assert params["offset"] == "100"


@respx.mock
async def test_search_translates_include_exclude_filters_into_query(client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    route = respx.get(f"{GRAYLOG_URL}/api/search/universal/absolute").mock(
        return_value=Response(200, json=SEARCH_BODY)
    )
    res = await client.post(
        "/api/logs/search",
        json={
            "query": "*",
            "from": 0,
            "to": 1,
            "limit": 5,
            "include": [{"field": "facility", "value": "local0"}],
            "exclude": [{"field": "application_name", "value": 'sshd" evil'}],
        },
        headers=AUTH,
    )
    assert res.status_code == 200
    query = dict(route.calls[0].request.url.params)["query"]
    assert query == 'facility:"local0" AND NOT application_name:"sshd\\" evil"'


@respx.mock
async def test_host_logs_passes_offset_and_filters(client):
    def zabbix_side_effect(request):
        payload = json.loads(request.content)
        assert payload["method"] == "host.get"
        return Response(
            200,
            json=zabbix_result(
                [{"hostid": "42", "host": "acc-sw-b04", "name": "acc-sw-b04", "interfaces": []}]
            ),
        )

    respx.post(ZABBIX_URL).mock(side_effect=zabbix_side_effect)
    route = respx.get(f"{GRAYLOG_URL}/api/search/universal/absolute").mock(
        return_value=Response(200, json=SEARCH_BODY)
    )
    res = await client.post(
        "/api/logs/host/42",
        json={
            "from": 0,
            "to": 100,
            "offset": 25,
            "exclude": [{"field": "source", "value": "noisy-host"}],
        },
        headers=AUTH,
    )
    assert res.status_code == 200
    params = dict(route.calls[0].request.url.params)
    assert params["offset"] == "25"
    assert 'NOT source:"noisy-host"' in params["query"]
    assert 'source:"acc-sw-b04"' in params["query"]


class TestFilterQueryConstruction:
    """Unit tests for the Lucene include/exclude query builder, independent
    of the FastAPI app (escaping is the security-sensitive part)."""

    def test_escape_lucene_value_neutralizes_quotes_and_backslashes(self):
        assert escape_lucene_value('sshd" OR source:*') == 'sshd\\" OR source:*'
        assert escape_lucene_value("back\\slash") == "back\\\\slash"

    def test_build_filter_clause_groups_same_field_with_or(self):
        clause = build_filter_clause(
            [LogFilter("facility", "local0"), LogFilter("facility", "auth")],
            "source",
            negate=False,
        )
        assert clause == '(facility:"local0" OR facility:"auth")'

    def test_build_filter_clause_ands_different_fields(self):
        clause = build_filter_clause(
            [LogFilter("facility", "local0"), LogFilter("application_name", "sshd")],
            "source",
            negate=False,
        )
        assert clause == 'facility:"local0" AND application_name:"sshd"'

    def test_build_filter_clause_negates_each_group(self):
        clause = build_filter_clause(
            [LogFilter("source", "web01"), LogFilter("source", "web02")],
            "source",
            negate=True,
        )
        assert clause == 'NOT (source:"web01" OR source:"web02")'

    def test_apply_filters_wraps_or_base_query_before_anding(self):
        query = apply_filters(
            'source:"a" OR source:"b"',
            [LogFilter("facility", "local0")],
            [],
            "source",
        )
        assert query == '(source:"a" OR source:"b") AND facility:"local0"'

    def test_apply_filters_drops_wildcard_base_query(self):
        query = apply_filters("*", [LogFilter("facility", "local0")], [], "source")
        assert query == 'facility:"local0"'

    def test_apply_filters_falls_back_to_wildcard_without_any_query_or_filters(self):
        assert apply_filters("", [], [], "source") == "*"


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
