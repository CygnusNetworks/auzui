import json

import httpx
import pytest
import respx
from httpx import Response

from auzui_gateway.app import create_app

from .conftest import ZABBIX_URL, make_settings, zabbix_result

ALICE = {"Authorization": "Bearer alice-token"}
BOB = {"Authorization": "Bearer bob-token"}


def _username_side_effect(request):
    """Map each session token to a Zabbix username via
    user.checkAuthentication's sessionid path — no Authorization header (
    Zabbix rejects the method with one) and no user.get fallback."""
    assert "Authorization" not in request.headers
    body = json.loads(request.content)
    assert body["method"] == "user.checkAuthentication"
    assert body["params"] == {"sessionid": body["params"]["sessionid"], "extend": False}
    token = body["params"]["sessionid"]
    user = "alice" if "alice" in token else "bob"
    return Response(200, json=zabbix_result({"userid": "1", "username": user}))


@pytest.fixture
async def fs_client(tmp_path):
    settings = make_settings(filter_sets_path=str(tmp_path / "sets.json"))
    app = create_app(settings)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as c:
        yield c


@respx.mock
async def test_crud_roundtrip_and_owner_scoping(fs_client):
    respx.post(ZABBIX_URL).mock(side_effect=_username_side_effect)

    # Alice creates a private set and a shared set.
    created = await fs_client.post(
        "/api/logs/filter-sets",
        json={
            "name": "My errors",
            "shared": False,
            "filters": {"include": [{"field": "facility", "value": "local0"}], "level": 3},
        },
        headers=ALICE,
    )
    assert created.status_code == 200
    set_id = created.json()["id"]
    assert created.json()["owner"] == "alice"
    assert created.json()["filters"]["level"] == 3

    shared = await fs_client.post(
        "/api/logs/filter-sets",
        json={"name": "Team view", "shared": True, "filters": {}},
        headers=ALICE,
    )
    shared_id = shared.json()["id"]

    # Alice sees both of her sets.
    alice_list = (await fs_client.get("/api/logs/filter-sets", headers=ALICE)).json()["filter_sets"]
    assert {s["id"] for s in alice_list} == {set_id, shared_id}

    # Bob sees only the shared set, not Alice's private one.
    bob_list = (await fs_client.get("/api/logs/filter-sets", headers=BOB)).json()["filter_sets"]
    assert [s["id"] for s in bob_list] == [shared_id]

    # Update by owner works.
    upd = await fs_client.put(
        f"/api/logs/filter-sets/{set_id}",
        json={"name": "Renamed", "shared": True, "filters": {}},
        headers=ALICE,
    )
    assert upd.status_code == 200
    assert upd.json()["name"] == "Renamed"

    # Delete by owner works.
    dele = await fs_client.delete(f"/api/logs/filter-sets/{shared_id}", headers=ALICE)
    assert dele.status_code == 200


@respx.mock
async def test_foreign_update_and_delete_forbidden(fs_client):
    respx.post(ZABBIX_URL).mock(side_effect=_username_side_effect)
    created = await fs_client.post(
        "/api/logs/filter-sets",
        json={"name": "Alice shared", "shared": True, "filters": {}},
        headers=ALICE,
    )
    set_id = created.json()["id"]

    upd = await fs_client.put(
        f"/api/logs/filter-sets/{set_id}",
        json={"name": "hijack", "shared": True, "filters": {}},
        headers=BOB,
    )
    assert upd.status_code == 403

    dele = await fs_client.delete(f"/api/logs/filter-sets/{set_id}", headers=BOB)
    assert dele.status_code == 403


@respx.mock
async def test_update_missing_is_404(fs_client):
    respx.post(ZABBIX_URL).mock(side_effect=_username_side_effect)
    res = await fs_client.put(
        "/api/logs/filter-sets/does-not-exist",
        json={"name": "x", "shared": False, "filters": {}},
        headers=ALICE,
    )
    assert res.status_code == 404


@respx.mock
async def test_corrupt_store_lists_empty(tmp_path):
    store = tmp_path / "sets.json"
    store.write_text("{ this is not valid json ]", encoding="utf-8")
    settings = make_settings(filter_sets_path=str(store))
    app = create_app(settings)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as c:
        respx.post(ZABBIX_URL).mock(side_effect=_username_side_effect)
        res = await c.get("/api/logs/filter-sets", headers=ALICE)
        assert res.status_code == 200
        assert res.json()["filter_sets"] == []


async def test_read_only_storage_degrades_without_crash(tmp_path):
    """A read-only store still lists (empty), and writes fail with 503 rather
    than crashing the gateway."""
    from fastapi import HTTPException

    from auzui_gateway.filter_sets import FilterSetStore

    store = FilterSetStore(str(tmp_path / "sets.json"))
    store._writable = False  # simulate a read-only /data mount
    assert await store.list_for("alice") == []
    with pytest.raises(HTTPException) as exc:
        await store.create("alice", "x", False, {})
    assert exc.value.status_code == 503


@respx.mock
async def test_username_via_check_authentication(fs_client):
    """Session ids resolve via user.checkAuthentication (dict result), sent
    without an Authorization header and with no user.get fallback — an
    unfiltered user.get would misreport the first listed user (e.g. guest,
    or for an Admin/Super-admin role, some other real user's row)."""

    def by_method(request):
        assert "Authorization" not in request.headers
        body = json.loads(request.content)
        if body["method"] == "user.checkAuthentication":
            assert body["params"] == {"sessionid": "session-id", "extend": False}
            return Response(200, json=zabbix_result({"userid": "6", "username": "valerius"}))
        raise AssertionError(f"unexpected method {body['method']} (no user.get fallback)")

    respx.post(ZABBIX_URL).mock(side_effect=by_method)
    created = await fs_client.post(
        "/api/logs/filter-sets",
        headers={"Authorization": "Bearer session-id"},
        json={"name": "s", "shared": False, "filters": {"include": [], "exclude": []}},
    )
    assert created.status_code == 200 or created.status_code == 201
    assert created.json()["owner"] == "valerius"


@respx.mock
async def test_username_via_api_token_when_sessionid_fails(fs_client):
    """A caller using a Zabbix API token (not a UI sessionid): the sessionid
    attempt is rejected by Zabbix, so `token` is tried next — still with no
    user.get fallback."""

    def by_method(request):
        assert "Authorization" not in request.headers
        body = json.loads(request.content)
        assert body["method"] == "user.checkAuthentication"
        if "sessionid" in body["params"]:
            return Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "error": {"message": "Session terminated, re-login, please."},
                },
            )
        assert body["params"] == {"token": "api-token-value"}
        return Response(200, json=zabbix_result({"userid": "9", "username": "svc-account"}))

    respx.post(ZABBIX_URL).mock(side_effect=by_method)
    created = await fs_client.post(
        "/api/logs/filter-sets",
        headers={"Authorization": "Bearer api-token-value"},
        json={"name": "s", "shared": False, "filters": {"include": [], "exclude": []}},
    )
    assert created.status_code == 200 or created.status_code == 201
    assert created.json()["owner"] == "svc-account"


@respx.mock
async def test_username_invalid_token_is_401(fs_client):
    """Neither a sessionid nor a token resolves -> 401, never a fallback to
    the first user.get row."""

    def by_method(request):
        body = json.loads(request.content)
        assert body["method"] == "user.checkAuthentication"
        return Response(
            200,
            json={"jsonrpc": "2.0", "id": 1, "error": {"message": "Session terminated."}},
        )

    respx.post(ZABBIX_URL).mock(side_effect=by_method)
    res = await fs_client.get(
        "/api/logs/filter-sets", headers={"Authorization": "Bearer bogus-token"}
    )
    assert res.status_code == 401
