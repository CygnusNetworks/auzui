"""Cross-server content deduplication (dedupe_messages + /api/logs/search).

A host that logs to several Graylog servers at once produces the same line
once per server, with a few milliseconds of arrival-time spread and different
internal ids. `dedupe_messages` collapses those into one representative row."""

import json

import httpx
import pytest
import respx
from httpx import Response

from auzui_gateway.app import create_app
from auzui_gateway.graylog import dedupe_messages

from .conftest import AUTH, ZABBIX_URL, make_settings, zabbix_result

GL_A = "https://graylog-a.test"
GL_B = "https://graylog-b.test"

SERVERS_JSON = json.dumps(
    [
        {"id": "gl-a", "label": "graylog-a", "url": GL_A, "token": "tok-a"},
        {"id": "gl-b", "label": "graylog-b", "url": GL_B, "token": "tok-b"},
    ]
)


def _msg(
    ts: float,
    *,
    server_id: str,
    server_label: str,
    message: str = "kernel: link up",
    source: str = "router1",
    level: int | None = 6,
    facility_num: int | None = 3,
    app: str | None = "kernel",
    msg_id: str | None = None,
) -> dict:
    return {
        "id": msg_id or f"{server_id}:{ts}",
        "timestamp": ts,
        "source": source,
        "message": message,
        "level": level,
        "facility_num": facility_num,
        "server_id": server_id,
        "server_label": server_label,
        "fields": {"application_name": app} if app is not None else {},
    }


def _desc(msgs: list[dict]) -> list[dict]:
    return sorted(msgs, key=lambda m: m["timestamp"], reverse=True)


def test_cross_server_duplicate_merges_2ms_difference():
    a = _msg(1000.000, server_id="gl-a", server_label="graylog-a", msg_id="a1")
    b = _msg(1000.002, server_id="gl-b", server_label="graylog-b", msg_id="b1")
    out = dedupe_messages(_desc([a, b]), window_seconds=2.0)
    assert len(out) == 1
    rep = out[0]
    # Earliest member kept as representative (its id/timestamp).
    assert rep["id"] == "a1"
    assert rep["timestamp"] == 1000.000
    assert rep["server_ids"] == ["gl-a", "gl-b"]
    assert rep["server_labels"] == ["graylog-a", "graylog-b"]
    # Representative-compat fields untouched.
    assert rep["server_id"] == "gl-a"


def test_same_server_duplicate_stays_separate():
    # Identical line delivered twice by the SAME server is a genuine repeat.
    a1 = _msg(1000.000, server_id="gl-a", server_label="graylog-a", msg_id="a1")
    a2 = _msg(1000.500, server_id="gl-a", server_label="graylog-a", msg_id="a2")
    out = dedupe_messages(_desc([a1, a2]), window_seconds=2.0)
    assert len(out) == 2
    assert {m["id"] for m in out} == {"a1", "a2"}
    assert all(m["server_ids"] == ["gl-a"] for m in out)


def test_repeat_outside_window_stays():
    # Same content on the two servers but 60 s apart (e.g. a periodic cron
    # line, or simply two different events) → NOT a fan-out duplicate.
    a = _msg(1000.0, server_id="gl-a", server_label="graylog-a", msg_id="a1")
    b = _msg(1060.0, server_id="gl-b", server_label="graylog-b", msg_id="b1")
    out = dedupe_messages(_desc([a, b]), window_seconds=2.0)
    assert len(out) == 2


def test_three_server_merge():
    a = _msg(1000.000, server_id="gl-a", server_label="graylog-a", msg_id="a1")
    b = _msg(1000.001, server_id="gl-b", server_label="graylog-b", msg_id="b1")
    c = _msg(1000.003, server_id="gl-c", server_label="graylog-c", msg_id="c1")
    out = dedupe_messages(_desc([a, b, c]), window_seconds=2.0)
    assert len(out) == 1
    assert out[0]["server_ids"] == ["gl-a", "gl-b", "gl-c"]
    assert out[0]["id"] == "a1"  # earliest


def test_window_boundary():
    # Anchored on the newest member: exactly at the window edge still merges,
    # just past it does not.
    a_in = _msg(1000.0, server_id="gl-a", server_label="graylog-a", msg_id="a1")
    b_edge = _msg(1002.0, server_id="gl-b", server_label="graylog-b", msg_id="b1")
    assert len(dedupe_messages(_desc([a_in, b_edge]), window_seconds=2.0)) == 1

    b_out = _msg(1002.001, server_id="gl-b", server_label="graylog-b", msg_id="b2")
    assert len(dedupe_messages(_desc([a_in, b_out]), window_seconds=2.0)) == 2


def test_different_content_not_merged():
    a = _msg(1000.0, server_id="gl-a", server_label="graylog-a", message="link up", msg_id="a1")
    b = _msg(1000.001, server_id="gl-b", server_label="graylog-b", message="link down", msg_id="b1")
    assert len(dedupe_messages(_desc([a, b]), window_seconds=2.0)) == 2


# ---- endpoint integration ------------------------------------------------


def _search_body(msg_id: str, ts: str) -> dict:
    return {
        "total_results": 1,
        "messages": [
            {
                "message": {
                    "_id": msg_id,
                    "timestamp": ts,
                    "source": "router1",
                    "message": "kernel: link up",
                    "level": 6,
                    "facility_num": 3,
                    "application_name": "kernel",
                }
            }
        ],
    }


@pytest.fixture
async def multi_client():
    app = create_app(make_settings(graylog_servers=SERVERS_JSON, log_dedup_enabled=True))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as c:
        yield c


@pytest.fixture
async def multi_client_flag_off():
    app = create_app(make_settings(graylog_servers=SERVERS_JSON, log_dedup_enabled=False))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as c:
        yield c


@respx.mock
async def test_servers_endpoint_reports_dedup_flag(multi_client, multi_client_flag_off):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    res_on = await multi_client.get("/api/logs/servers", headers=AUTH)
    assert res_on.json()["dedup_enabled"] is True
    res_off = await multi_client_flag_off.get("/api/logs/servers", headers=AUTH)
    assert res_off.json()["dedup_enabled"] is False


@respx.mock
async def test_search_flag_off_keeps_duplicates(multi_client_flag_off):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    respx.get(f"{GL_A}/api/search/universal/absolute").mock(
        return_value=Response(200, json=_search_body("a1", "2026-07-29T10:00:00.000Z"))
    )
    respx.get(f"{GL_B}/api/search/universal/absolute").mock(
        return_value=Response(200, json=_search_body("b1", "2026-07-29T10:00:00.002Z"))
    )
    res = await multi_client_flag_off.post(
        "/api/logs/search", json={"from": 0, "to": 1, "limit": 50}, headers=AUTH
    )
    assert len(res.json()["messages"]) == 2


@respx.mock
async def test_search_dedupes_cross_server_by_default(multi_client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    respx.get(f"{GL_A}/api/search/universal/absolute").mock(
        return_value=Response(200, json=_search_body("a1", "2026-07-29T10:00:00.000Z"))
    )
    respx.get(f"{GL_B}/api/search/universal/absolute").mock(
        return_value=Response(200, json=_search_body("b1", "2026-07-29T10:00:00.002Z"))
    )
    res = await multi_client.post(
        "/api/logs/search", json={"from": 0, "to": 1, "limit": 50}, headers=AUTH
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body["messages"]) == 1
    assert body["messages"][0]["server_ids"] == ["gl-a", "gl-b"]
    # total stays the raw sum (approximate once duplicates collapse).
    assert body["total"] == 2


@respx.mock
async def test_search_dedupe_false_keeps_duplicates(multi_client):
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    respx.get(f"{GL_A}/api/search/universal/absolute").mock(
        return_value=Response(200, json=_search_body("a1", "2026-07-29T10:00:00.000Z"))
    )
    respx.get(f"{GL_B}/api/search/universal/absolute").mock(
        return_value=Response(200, json=_search_body("b1", "2026-07-29T10:00:00.002Z"))
    )
    res = await multi_client.post(
        "/api/logs/search",
        json={"from": 0, "to": 1, "limit": 50, "dedupe": False},
        headers=AUTH,
    )
    assert res.status_code == 200
    assert len(res.json()["messages"]) == 2


@respx.mock
async def test_dedupe_overfetches_and_paginates_after_merge(multi_client):
    """With dedup active, each server is fetched from offset 0 with headroom
    (limit + offset + pad) and pagination happens on the deduped list —
    otherwise per-server windows misalign and edge rows surface un-merged."""
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))
    route_a = respx.get(f"{GL_A}/api/search/universal/absolute").mock(
        return_value=Response(200, json=_search_body("a1", "2026-07-29T10:00:00.000Z"))
    )
    respx.get(f"{GL_B}/api/search/universal/absolute").mock(
        return_value=Response(200, json=_search_body("b1", "2026-07-29T10:00:00.002Z"))
    )
    res = await multi_client.post(
        "/api/logs/search", json={"from": 0, "to": 1, "limit": 10, "offset": 20}, headers=AUTH
    )
    assert res.status_code == 200
    params = route_a.calls.last.request.url.params
    assert params["offset"] == "0"
    assert int(params["limit"]) == 10 + 20 + 50  # limit + offset + DEDUP_FETCH_PAD
    # offset 20 on a single deduped row -> empty page, not an unmerged repeat
    assert res.json()["messages"] == []
