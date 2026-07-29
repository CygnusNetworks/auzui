import base64
import json
import sys
import types
from urllib.parse import quote

import httpx
import pytest
import respx
from httpx import Response

from auzui_gateway.app import create_app
from auzui_gateway.spnego import principal_to_login

from .conftest import ZABBIX_URL, make_settings, zabbix_result

WEB_URL = "https://zbx.test"


class _FakeCtx:
    def __init__(self, principal: str | None, complete: bool = True) -> None:
        self._principal = principal
        self.complete = complete
        self.initiator_name = principal

    def step(self, token: bytes) -> None:
        if self._principal is None:
            raise RuntimeError("bad ticket")


def install_fake_gssapi(monkeypatch, principal: str | None, complete: bool = True) -> None:
    fake = types.ModuleType("gssapi")
    fake.Credentials = lambda usage: object()  # type: ignore[attr-defined]
    fake.SecurityContext = lambda creds, usage: _FakeCtx(  # type: ignore[attr-defined]
        principal, complete
    )
    monkeypatch.setitem(sys.modules, "gssapi", fake)


def zbx_session_cookie(sessionid: str) -> str:
    return quote(base64.b64encode(json.dumps({"sessionid": sessionid}).encode()).decode())


@pytest.fixture
async def sso_client():
    app = create_app(make_settings(spnego_enabled=True, zabbix_web_url=WEB_URL))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as c:
        yield c


def test_principal_to_login():
    assert principal_to_login("valerius@CYGNUSNETWORKS.DE") == "valerius"
    assert principal_to_login("svc/host.example.de@REALM") == "svc"
    assert principal_to_login("plain") == "plain"


async def test_spnego_disabled_is_404(client):
    res = await client.get("/api/auth/spnego")
    assert res.status_code == 404


async def test_auth_methods(client, sso_client):
    assert (await client.get("/api/auth/methods")).json() == {"password": True, "spnego": False}
    assert (await sso_client.get("/api/auth/methods")).json() == {
        "password": True,
        "spnego": True,
    }


async def test_spnego_challenge_without_token(sso_client):
    res = await sso_client.get("/api/auth/spnego")
    assert res.status_code == 401
    assert res.headers["WWW-Authenticate"] == "Negotiate"


@respx.mock
async def test_spnego_happy_path(sso_client, monkeypatch):
    install_fake_gssapi(monkeypatch, "valerius@CYGNUSNETWORKS.DE")
    index_route = respx.get(f"{WEB_URL}/index_http.php").mock(
        return_value=Response(
            302,
            headers={
                "Location": "zabbix.php?action=dashboard.view",
                "Set-Cookie": f"zbx_session={zbx_session_cookie('sess-123')}; HttpOnly",
            },
        )
    )
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "7"}])))

    res = await sso_client.get(
        "/api/auth/spnego",
        headers={"Authorization": "Negotiate " + base64.b64encode(b"tok").decode()},
    )
    assert res.status_code == 200
    assert res.json() == {"token": "sess-123", "username": "valerius"}

    basic = index_route.calls[0].request.headers["Authorization"]
    assert basic == "Basic " + base64.b64encode(b"valerius:x").decode()


@respx.mock
async def test_spnego_bad_ticket_no_second_challenge(sso_client, monkeypatch):
    install_fake_gssapi(monkeypatch, None)  # step() raises
    res = await sso_client.get(
        "/api/auth/spnego",
        headers={"Authorization": "Negotiate " + base64.b64encode(b"bad").decode()},
    )
    assert res.status_code == 401
    # Popup-loop protection: failure response must NOT re-challenge.
    assert "WWW-Authenticate" not in res.headers
    assert "sso_error" in json.dumps(res.json())


@respx.mock
async def test_spnego_no_session_cookie_is_502(sso_client, monkeypatch):
    install_fake_gssapi(monkeypatch, "valerius@CYGNUSNETWORKS.DE")
    respx.get(f"{WEB_URL}/index_http.php").mock(return_value=Response(200, text="login form"))
    res = await sso_client.get(
        "/api/auth/spnego",
        headers={"Authorization": "Negotiate " + base64.b64encode(b"tok").decode()},
    )
    assert res.status_code == 502


@respx.mock
async def test_spnego_session_roundtrip_failure(sso_client, monkeypatch):
    install_fake_gssapi(monkeypatch, "ghost@CYGNUSNETWORKS.DE")
    respx.get(f"{WEB_URL}/index_http.php").mock(
        return_value=Response(
            302,
            headers={"Set-Cookie": f"zbx_session={zbx_session_cookie('dead')}; HttpOnly"},
        )
    )
    respx.post(ZABBIX_URL).mock(
        return_value=Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "error": {"code": -32602, "message": "Session terminated, re-login, please."},
            },
        )
    )
    res = await sso_client.get(
        "/api/auth/spnego",
        headers={"Authorization": "Negotiate " + base64.b64encode(b"tok").decode()},
    )
    assert res.status_code == 401
