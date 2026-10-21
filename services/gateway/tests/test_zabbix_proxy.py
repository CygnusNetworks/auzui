import json

import httpx
import pytest
import respx

from auzui_gateway.app import create_app
from auzui_gateway.zabbix_proxy import DEFAULT_ALLOWED_METHODS, LoginThrottle

from .conftest import ZABBIX_URL, make_settings

RPC = {"Content-Type": "application/json-rpc"}


def rpc(method, params=None, rpc_id=1):
    return {"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params or {}}


def make_client(**overrides):
    app = create_app(make_settings(**overrides))
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://gw.test")


@pytest.fixture
async def px():
    async with make_client() as c:
        yield c


def ok(result, rpc_id=1):
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": rpc_id, "result": result})


def zerr(data, message="Application error.", code=-32500, rpc_id=1):
    return httpx.Response(
        200,
        json={
            "jsonrpc": "2.0",
            "id": rpc_id,
            "error": {"code": code, "message": message, "data": data},
        },
    )


@respx.mock
async def test_allowed_passthrough_forwards_only_auth(px):
    route = respx.post(ZABBIX_URL).mock(return_value=ok([{"hostid": "1"}]))
    res = await px.post(
        "/api_jsonrpc.php",
        json={**rpc("host.get", {"output": ["hostid"]}, 7), "evil": "x"},
        headers={
            **RPC,
            "Authorization": "Bearer tok",
            "Cookie": "zbx_session=secret",
            "X-Forwarded-For": "1.2.3.4",
            "X-Other": "y",
        },
    )
    assert res.status_code == 200
    assert res.json() == {"jsonrpc": "2.0", "id": 1, "result": [{"hostid": "1"}]}
    sent = route.calls.last.request
    assert sent.headers["authorization"] == "Bearer tok"
    assert sent.headers["content-type"] == "application/json-rpc"
    for h in ("cookie", "x-forwarded-for", "x-other"):
        assert h not in sent.headers
    body = json.loads(sent.content)
    assert body == rpc("host.get", {"output": ["hostid"]}, 7)


@respx.mock
async def test_no_auth_header_when_absent(px):
    route = respx.post(ZABBIX_URL).mock(return_value=ok("7.0.0"))
    res = await px.post("/api_jsonrpc.php", json=rpc("apiinfo.version", []), headers=RPC)
    assert res.json()["result"] == "7.0.0"
    assert "authorization" not in route.calls.last.request.headers


@respx.mock
async def test_content_type_with_charset_and_json_accepted(px):
    respx.post(ZABBIX_URL).mock(return_value=ok("7.0.0"))
    res = await px.post(
        "/api_jsonrpc.php",
        content=json.dumps(rpc("apiinfo.version", [])),
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    assert res.status_code == 200 and res.json()["result"] == "7.0.0"


def test_default_allowlist_covers_spa_methods():
    assert {"itemprototype.get", "user.login", "maintenance.delete"} <= DEFAULT_ALLOWED_METHODS
    assert "user.get" not in DEFAULT_ALLOWED_METHODS


@respx.mock
@pytest.mark.parametrize("method", ["user.get", "script.execute", "Host.get", "host.get ", ""])
async def test_disallowed_method(px, method):
    route = respx.post(ZABBIX_URL).mock(return_value=ok([]))
    res = await px.post("/api_jsonrpc.php", json=rpc(method, rpc_id=42), headers=RPC)
    assert res.status_code == 200
    err = res.json()
    assert err["id"] == 42
    if method:
        assert err["error"]["code"] == -32601
        assert err["error"]["message"] == "Method not allowed"
    assert not route.called


@respx.mock
async def test_extra_methods_setting():
    respx.post(ZABBIX_URL).mock(return_value=ok([{"userid": "1"}]))
    async with make_client(zabbix_proxy_extra_methods=" user.get, template.get ") as c:
        res = await c.post("/api_jsonrpc.php", json=rpc("user.get"), headers=RPC)
        assert res.json()["result"] == [{"userid": "1"}]
        res = await c.post("/api_jsonrpc.php", json=rpc("host.get"), headers=RPC)
        assert "result" in res.json()
        res = await c.post("/api_jsonrpc.php", json=rpc("user.delete"), headers=RPC)
        assert res.json()["error"]["code"] == -32601


@respx.mock
async def test_batch_rejected(px):
    route = respx.post(ZABBIX_URL).mock(return_value=ok([]))
    res = await px.post("/api_jsonrpc.php", json=[rpc("host.get")], headers=RPC)
    assert res.json()["error"]["code"] == -32600
    assert not route.called


@respx.mock
@pytest.mark.parametrize(
    "body",
    [
        '"host.get"',
        "42",
        '{"id":1,"method":"host.get"}',
        '{"jsonrpc":"1.0","id":1,"method":"host.get"}',
        '{"jsonrpc":"2.0","id":1}',
        '{"jsonrpc":"2.0","id":1,"method":["host.get"]}',
    ],
)
async def test_invalid_requests(px, body):
    route = respx.post(ZABBIX_URL).mock(return_value=ok([]))
    res = await px.post("/api_jsonrpc.php", content=body, headers=RPC)
    assert res.status_code == 200
    assert res.json()["error"]["code"] == -32600
    assert not route.called


async def test_bad_json(px):
    res = await px.post("/api_jsonrpc.php", content="{nope", headers=RPC)
    assert res.json()["error"]["code"] == -32700
    assert res.json()["id"] is None


@respx.mock
async def test_body_too_large():
    route = respx.post(ZABBIX_URL).mock(return_value=ok([]))
    async with make_client(zabbix_proxy_max_body_bytes=200) as c:
        big = rpc("host.get", {"filter": {"name": "x" * 500}})
        res = await c.post("/api_jsonrpc.php", json=big, headers=RPC)
        assert res.status_code == 413

        # chunked upload (no Content-Length) is capped while streaming
        async def gen():
            for _ in range(10):
                yield b"x" * 100

        res = await c.post("/api_jsonrpc.php", content=gen(), headers=RPC)
        assert res.status_code == 413
    assert not route.called


@respx.mock
async def test_wrong_content_type(px):
    route = respx.post(ZABBIX_URL).mock(return_value=ok([]))
    for ct in ("text/plain", "application/x-www-form-urlencoded"):
        res = await px.post(
            "/api_jsonrpc.php", content=json.dumps(rpc("host.get")), headers={"Content-Type": ct}
        )
        assert res.status_code == 415
    assert not route.called


@respx.mock
async def test_error_data_sanitized(px):
    respx.post(ZABBIX_URL).mock(
        return_value=zerr("SQL error in /usr/share/zabbix/include/db.inc.php:123")
    )
    res = await px.post("/api_jsonrpc.php", json=rpc("host.get"), headers=RPC)
    err = res.json()["error"]
    assert err["code"] == -32500 and err["message"] == "Application error."
    assert "SQL" not in json.dumps(err) and "/usr" not in json.dumps(err)
    assert err["data"]


@respx.mock
@pytest.mark.parametrize("data", ["Session terminated, re-login, please.", "Not authorized."])
async def test_session_expired_data_kept(px, data):
    respx.post(ZABBIX_URL).mock(return_value=zerr(data))
    res = await px.post("/api_jsonrpc.php", json=rpc("host.get"), headers=RPC)
    assert res.json()["error"]["data"] == data


@respx.mock
async def test_login_error_data_kept(px):
    msg = "Incorrect user name or password or account is temporarily blocked."
    respx.post(ZABBIX_URL).mock(return_value=zerr(msg))
    res = await px.post(
        "/api_jsonrpc.php", json=rpc("user.login", {"username": "a", "password": "b"}), headers=RPC
    )
    assert res.json()["error"]["data"] == msg


@respx.mock
async def test_upstream_timeout(px):
    respx.post(ZABBIX_URL).mock(side_effect=httpx.ReadTimeout("slow"))
    res = await px.post("/api_jsonrpc.php", json=rpc("host.get", rpc_id=3), headers=RPC)
    assert res.status_code == 504
    assert res.json()["id"] == 3 and res.json()["error"]["code"] == -32000


@respx.mock
async def test_upstream_unreachable_and_garbage(px):
    respx.post(ZABBIX_URL).mock(side_effect=httpx.ConnectError("boom"))
    res = await px.post("/api_jsonrpc.php", json=rpc("host.get"), headers=RPC)
    assert res.status_code == 502
    assert "boom" not in res.text
    respx.post(ZABBIX_URL).mock(return_value=httpx.Response(200, text="<html>"))
    res = await px.post("/api_jsonrpc.php", json=rpc("host.get"), headers=RPC)
    assert res.status_code == 502
    respx.post(ZABBIX_URL).mock(return_value=httpx.Response(500, text="oops"))
    res = await px.post("/api_jsonrpc.php", json=rpc("host.get"), headers=RPC)
    assert res.status_code == 502


@respx.mock
async def test_upstream_redirect_not_followed(px):
    respx.post(ZABBIX_URL).mock(
        return_value=httpx.Response(302, headers={"Location": "https://evil.test/"})
    )
    res = await px.post("/api_jsonrpc.php", json=rpc("host.get"), headers=RPC)
    assert res.status_code == 502


def login(user, password="pw", rpc_id=1):
    return rpc("user.login", {"username": user, "password": password}, rpc_id)


@respx.mock
async def test_login_lockout_per_username_and_reset_on_success(caplog):
    fail = respx.post(ZABBIX_URL).mock(return_value=zerr("Incorrect user name or password."))
    async with make_client(zabbix_login_max_failures=3) as c:
        with caplog.at_level("WARNING"):
            for _ in range(3):
                res = await c.post("/api_jsonrpc.php", json=login("Alice"), headers=RPC)
                assert res.status_code == 200 and "error" in res.json()
        assert "auzui login failure ip=127.0.0.1 user=alice" in caplog.text
        calls = fail.call_count
        res = await c.post("/api_jsonrpc.php", json=login("alice", rpc_id=9), headers=RPC)
        assert res.status_code == 200 and res.headers["retry-after"] == "300"
        assert res.json()["id"] == 9 and "Too many" in res.json()["error"]["data"]
        assert fail.call_count == calls  # Zabbix not contacted

    # success resets the username counter (use a high IP limit via many users)
    respx.post(ZABBIX_URL).mock(side_effect=[zerr("bad"), zerr("bad"), ok("sess"), zerr("bad")])
    async with make_client(zabbix_login_max_failures=3) as c:
        for _ in range(2):
            await c.post("/api_jsonrpc.php", json=login("bob"), headers=RPC)
        res = await c.post("/api_jsonrpc.php", json=login("bob"), headers=RPC)
        assert res.json()["result"] == "sess"
        res = await c.post("/api_jsonrpc.php", json=login("bob"), headers=RPC)
        assert res.status_code == 200  # counter restarted, one failure only


@respx.mock
async def test_login_lockout_per_ip_across_usernames():
    route = respx.post(ZABBIX_URL).mock(return_value=zerr("bad"))
    async with make_client(zabbix_login_max_failures=3) as c:
        for i in range(3):
            await c.post("/api_jsonrpc.php", json=login(f"user{i}"), headers=RPC)
        res = await c.post("/api_jsonrpc.php", json=login("fresh"), headers=RPC)
        assert "Too many" in res.json()["error"]["data"]
        assert route.call_count == 3
        # non-login methods are unaffected by the lockout
        respx.post(ZABBIX_URL).mock(return_value=ok([]))
        res = await c.post("/api_jsonrpc.php", json=rpc("host.get"), headers=RPC)
        assert res.status_code == 200


@respx.mock
async def test_login_lockout_per_username_other_ip(monkeypatch):
    """Username key locks regardless of the source IP."""
    respx.post(ZABBIX_URL).mock(return_value=zerr("bad"))
    app = create_app(make_settings(zabbix_login_max_failures=2))
    for ip, locked in (("10.0.0.1", False), ("10.0.0.2", False), ("10.0.0.3", True)):
        transport = httpx.ASGITransport(app=app, client=(ip, 1234))
        async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as c:
            res = await c.post("/api_jsonrpc.php", json=login("carol"), headers=RPC)
            assert ("Too many" in res.json()["error"]["data"]) is locked


def test_login_throttle_expiry_and_bounds(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr("auzui_gateway.zabbix_proxy.time.monotonic", lambda: now[0])
    t = LoginThrottle(2, 60, max_entries=10)
    t.failure("ip:a")
    t.failure("ip:a")
    assert t.is_locked("ip:a")
    now[0] += 61
    assert not t.is_locked("ip:a")
    for i in range(25):
        now[0] += 1
        t.failure(f"user:{i}")
    assert len(t._state) <= 10


@respx.mock
async def test_proxy_disabled_route_absent():
    route = respx.post(ZABBIX_URL).mock(return_value=ok([]))
    async with make_client(zabbix_proxy_enabled=False) as c:
        res = await c.post("/api_jsonrpc.php", json=rpc("host.get"), headers=RPC)
        assert res.status_code in (404, 405)
    assert not route.called


async def test_spa_catch_all_does_not_swallow_post(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>spa</html>")
    async with make_client(
        serve_frontend=True, frontend_dir=str(tmp_path), zabbix_proxy_enabled=False
    ) as c:
        assert (await c.get("/api_jsonrpc.php")).text == "<html>spa</html>"
        res = await c.post("/api_jsonrpc.php", json=rpc("host.get"), headers=RPC)
        assert res.status_code == 405


@respx.mock
async def test_proxy_wins_over_spa_catch_all(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>spa</html>")
    respx.post(ZABBIX_URL).mock(return_value=ok("7.0.0"))
    async with make_client(serve_frontend=True, frontend_dir=str(tmp_path)) as c:
        res = await c.post("/api_jsonrpc.php", json=rpc("apiinfo.version", []), headers=RPC)
        assert res.json()["result"] == "7.0.0"


@respx.mock
async def test_shared_client_does_not_replay_cookies(px):
    route = respx.post(ZABBIX_URL).mock(
        return_value=httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": 1, "result": []},
            headers={"Set-Cookie": "zbx_session=leak; Path=/"},
        )
    )
    await px.post("/api_jsonrpc.php", json=rpc("host.get"), headers=RPC)
    await px.post("/api_jsonrpc.php", json=rpc("host.get"), headers=RPC)
    assert "cookie" not in route.calls.last.request.headers
