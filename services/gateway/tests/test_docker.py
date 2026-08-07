"""`/api/docker/*` (docker_routes.py), via `create_app` with a fake
docker-py client factory injected (`create_app(settings,
docker_client_factory=...)`) so none of this needs docker-py installed or a
real Docker host reachable — the same trick docker_compose.py's tests use
for paramiko. Zabbix itself is mocked with respx, same as test_logs.py."""

import json
from datetime import UTC, datetime

import pytest
import respx
from httpx import Response

from auzui_gateway import docker_compose
from auzui_gateway.app import create_app
from auzui_gateway.config import Settings
from auzui_gateway.docker_compose import build_cat_command, build_compose_command

from .conftest import AUTH, ZABBIX_URL, make_settings, zabbix_result

# ---- fixtures: three hosts, one readonly, one that always fails, one ssh/compose --

PROD_A = "prod-a"  # readonly, HTTP
DB_1 = "db-1"  # writable, HTTP
BROKEN = "broken"  # writable, but every call raises (fan-out error coverage)
EDGE = "edge"  # ssh://, compose=True, writable

DOCKER_HOSTS = json.dumps(
    [
        {"id": PROD_A, "label": "prod-a", "url": "http://sockproxy-a:2375", "readonly": True},
        {"id": DB_1, "label": "db-1", "url": "http://sockproxy-b:2375"},
        {"id": BROKEN, "label": "broken", "url": "http://sockproxy-c:2375"},
        {
            "id": EDGE,
            "label": "edge",
            "url": "ssh://deploy@edge.example.com",
            "compose": True,
        },
    ]
)


def _container_row(cid: str, name: str, *, image="nginx", tag="1.25", image_id="sha256:abc"):
    """A /containers/json (list-shape) row — see list_containers() on why the
    inspect shape would be wrong here. `Mounts`/`NetworkSettings` are part of
    that shape and are what search() derives its `used_by` annotation from."""
    return {
        "Id": cid,
        "Names": [f"/{name}"],
        "Image": f"{image}:{tag}" if tag else image,
        "ImageID": image_id,
        "State": "running",
        "Status": "Up 2 hours",
        "Created": 1700000000,
        "Ports": [{"PrivatePort": 80, "PublicPort": 8080, "Type": "tcp", "IP": "0.0.0.0"}],
        "Labels": {},
        "Mounts": [
            {"Type": "volume", "Name": "pgdata", "Destination": "/var/lib/postgresql/data"},
            # A bind mount has no Name and no `docker volume ls` row — it must
            # not turn into a phantom volume entry.
            {"Type": "bind", "Source": "/etc/localtime", "Destination": "/etc/localtime"},
        ],
        "NetworkSettings": {"Networks": {"bridge": {"IPAddress": "172.17.0.2"}}},
    }


def _fmt_ns(ns: int) -> str:
    seconds, nanos = divmod(ns, 1_000_000_000)
    dt = datetime.fromtimestamp(seconds, tz=UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + f".{nanos:09d}Z"


DB1_CONTAINER = _container_row("c1", "web1")
PROD_A_CONTAINER = _container_row("c2", "web2", image="redis", tag="7", image_id="sha256:def")

# EDGE (ssh://, compose=True) hosts a single compose project ("myapp") whose
# container carries the working_dir/config_files labels ComposeRunner reads
# to build its `docker compose ...` / `cat ...` commands.
EDGE_PROJECT = "myapp"
EDGE_WORKING_DIR = "/srv/myapp"
EDGE_CONFIG_FILES = ["/srv/myapp/docker-compose.yml"]
EDGE_CONTAINER = {
    **_container_row("e1", "myapp-web-1"),
    "Labels": {
        "com.docker.compose.project": EDGE_PROJECT,
        "com.docker.compose.service": "web",
        "com.docker.compose.project.working_dir": EDGE_WORKING_DIR,
        "com.docker.compose.project.config_files": ",".join(EDGE_CONFIG_FILES),
    },
}

# Three log lines, whole seconds apart (see test_docker.py's cursor-roundtrip
# note in the class below for why sub-second spacing would be flaky here).
LOG_ENTRIES = [
    (1_700_000_000_000_000_000, "stdout", "line one"),
    (1_700_000_060_000_000_000, "stdout", "line two"),
    (1_700_000_120_000_000_000, "stderr", "line three"),
]


class FakeDockerHostClient:
    """Stand-in for docker_hosts.DockerHostClient: no docker-py, no network
    — just canned per-host data plus a record of every action invoked, so
    tests can assert on both the HTTP response and what actually got
    "called" against the (fake) engine."""

    containers_by_host: dict[str, list[dict]] = {}
    images_by_host: dict[str, list[dict]] = {}
    volumes_by_host: dict[str, list[dict]] = {}
    networks_by_host: dict[str, list[dict]] = {}
    stats_by_host: dict[str, dict[str, dict]] = {}
    logs_by_host: dict[str, dict[str, list[tuple[int, str, str]]]] = {}
    fail_hosts: set[str] = set()
    actions: list[tuple[str, str, str]] = []
    ssh_calls: list[str] = []
    ssh_responses: dict[str, tuple[int, str, str]] = {}

    def __init__(self, host, settings) -> None:
        self.host = host
        self.settings = settings

    def _maybe_fail(self) -> None:
        if self.host.id in FakeDockerHostClient.fail_hosts:
            raise RuntimeError(f"simulated failure on host {self.host.id}")

    def version(self) -> dict:
        self._maybe_fail()
        return {"Version": "24.0.0"}

    def info(self) -> dict:
        self._maybe_fail()
        return {"ContainersRunning": 1, "ContainersStopped": 0, "ContainersPaused": 0, "Images": 1}

    def list_containers(self, all: bool = True) -> list[dict]:  # noqa: A002
        self._maybe_fail()
        return FakeDockerHostClient.containers_by_host.get(self.host.id, [])

    def inspect_container(self, cid: str) -> dict:
        self._maybe_fail()
        for c in self.list_containers():
            if c["Id"] == cid:
                return c
        raise KeyError(cid)

    def stats(self, cid: str, one_shot: bool = True) -> dict:
        self._maybe_fail()
        return FakeDockerHostClient.stats_by_host.get(self.host.id, {}).get(cid, {})

    def logs(
        self,
        cid: str,
        *,
        since=None,
        until=None,
        tail=None,
        stdout: bool = True,
        stderr: bool = True,
    ) -> str:
        self._maybe_fail()
        since_ns = None if since is None else round(since * 1_000_000_000)
        until_ns = None if until is None else round(until * 1_000_000_000)
        entries = FakeDockerHostClient.logs_by_host.get(self.host.id, {}).get(cid, [])
        lines = []
        for ns, stream, message in entries:
            if since_ns is not None and ns <= since_ns:
                continue
            if until_ns is not None and ns > until_ns:
                continue
            if stream == "stdout" and not stdout:
                continue
            if stream == "stderr" and not stderr:
                continue
            tag = "1" if stream == "stdout" else "2"
            lines.append(f"{tag}\t{_fmt_ns(ns)} {message}")
        return "\n".join(lines)

    def list_images(self) -> list[dict]:
        self._maybe_fail()
        return FakeDockerHostClient.images_by_host.get(self.host.id, [])

    def list_volumes(self) -> list[dict]:
        self._maybe_fail()
        return FakeDockerHostClient.volumes_by_host.get(self.host.id, [])

    def list_networks(self) -> list[dict]:
        self._maybe_fail()
        return FakeDockerHostClient.networks_by_host.get(self.host.id, [])

    def container_action(self, cid: str, action: str) -> None:
        self._maybe_fail()
        FakeDockerHostClient.actions.append((self.host.id, cid, action))

    def pull_recreate(self, cid: str) -> dict:
        self._maybe_fail()
        FakeDockerHostClient.actions.append((self.host.id, cid, "pull_recreate"))
        return {"updated": True, "digest": "sha256:new", "container_id": cid}

    def exec_ssh(self, command: str) -> tuple[int, str, str]:
        # No self._maybe_fail() here: SSH-exec failures for `docker compose
        # ps`/`cat` are scripted per-command via ssh_responses (a non-zero
        # exit code), independently of the host-wide fail_hosts fan-out
        # failure used by the container/version/info fakes above.
        FakeDockerHostClient.ssh_calls.append(command)
        return FakeDockerHostClient.ssh_responses.get(command, (0, "", ""))


def fake_factory(host, settings):
    return FakeDockerHostClient(host, settings)


@pytest.fixture(autouse=True)
def _reset_fake_state():
    FakeDockerHostClient.containers_by_host = {
        DB_1: [DB1_CONTAINER],
        PROD_A: [PROD_A_CONTAINER],
        BROKEN: [],
        EDGE: [EDGE_CONTAINER],
    }
    FakeDockerHostClient.images_by_host = {
        # sha256:abc is DB1_CONTAINER's ImageID (in use); sha256:dangling is
        # not referenced by any container on this host, so search() must report
        # it with an empty used_by.
        DB_1: [
            {
                "Id": "sha256:abc",
                "RepoDigests": ["nginx@sha256:" + "1" * 64],
                "RepoTags": ["nginx:1.25"],
            },
            {"Id": "sha256:dangling", "RepoDigests": [], "RepoTags": []},
        ],
        PROD_A: [],
        BROKEN: [],
        EDGE: [],
    }
    FakeDockerHostClient.volumes_by_host = {
        DB_1: [{"Name": "pgdata", "Driver": "local"}, {"Name": "orphan", "Driver": "local"}],
        PROD_A: [],
        BROKEN: [],
        EDGE: [],
    }
    FakeDockerHostClient.networks_by_host = {
        DB_1: [{"Id": "n1", "Name": "bridge", "Driver": "bridge"}, {"Id": "n2", "Name": "none", "Driver": "null"}],
        PROD_A: [],
        BROKEN: [],
        EDGE: [],
    }
    FakeDockerHostClient.stats_by_host = {
        DB_1: {
            "c1": {
                "cpu_stats": {
                    "cpu_usage": {"total_usage": 200},
                    "system_cpu_usage": 2000,
                    "online_cpus": 2,
                },
                "precpu_stats": {
                    "cpu_usage": {"total_usage": 100},
                    "system_cpu_usage": 1000,
                },
                "memory_stats": {"usage": 1000, "limit": 2000},
                "networks": {"eth0": {"rx_bytes": 10, "tx_bytes": 20}},
                "blkio_stats": {
                    "io_service_bytes_recursive": [
                        {"op": "Read", "value": 5},
                        {"op": "Write", "value": 6},
                    ]
                },
            }
        }
    }
    FakeDockerHostClient.logs_by_host = {DB_1: {"c1": list(LOG_ENTRIES)}}
    FakeDockerHostClient.fail_hosts = set()
    FakeDockerHostClient.actions = []
    FakeDockerHostClient.ssh_calls = []
    FakeDockerHostClient.ssh_responses = {}
    yield


def docker_settings(**overrides) -> Settings:
    return make_settings(docker_hosts=DOCKER_HOSTS, **overrides)


@pytest.fixture
async def docker_client(monkeypatch):
    import httpx

    # ComposeRunner._exec builds its own DockerHostClient directly from
    # docker_compose.py (not via docker_service's injected client_factory,
    # see docker_compose.ComposeRunner docstring) — patch that name too, the
    # same way test_docker_compose.py does, so EDGE's `compose ps`/`cat`
    # exec_ssh calls land on the fake instead of requiring paramiko.
    monkeypatch.setattr(docker_compose, "DockerHostClient", FakeDockerHostClient)
    app = create_app(docker_settings(), docker_client_factory=fake_factory)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as c:
        yield c


@pytest.fixture
async def docker_client_disabled():
    import httpx

    app = create_app(make_settings(docker_hosts=""), docker_client_factory=fake_factory)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as c:
        yield c


def mock_zabbix_session_ok():
    respx.post(ZABBIX_URL).mock(return_value=Response(200, json=zabbix_result([{"userid": "1"}])))


# ---- status / disabled-gate ------------------------------------------------


async def test_status_reports_enabled(docker_client, docker_client_disabled):
    assert (await docker_client.get("/api/docker/status")).json() == {"enabled": True}
    assert (await docker_client_disabled.get("/api/docker/status")).json() == {"enabled": False}


async def test_data_routes_404_when_disabled(docker_client_disabled):
    res = await docker_client_disabled.get("/api/docker/hosts", headers=AUTH)
    assert res.status_code == 404
    res = await docker_client_disabled.get("/api/docker/containers", headers=AUTH)
    assert res.status_code == 404
    res = await docker_client_disabled.get(f"/api/docker/containers/{DB_1}/c1", headers=AUTH)
    assert res.status_code == 404
    res = await docker_client_disabled.get("/api/docker/permissions", headers=AUTH)
    assert res.status_code == 404
    res = await docker_client_disabled.post(
        f"/api/docker/containers/{DB_1}/c1/action", json={"action": "start"}, headers=AUTH
    )
    assert res.status_code == 404


# ---- fan-out + partial failure ---------------------------------------------


@respx.mock
async def test_containers_fanout_partial_failure(docker_client):
    mock_zabbix_session_ok()
    FakeDockerHostClient.fail_hosts = {BROKEN}
    res = await docker_client.get("/api/docker/containers", headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    host_ids = {c["host_id"] for c in body["containers"]}
    assert host_ids == {DB_1, PROD_A, EDGE}  # BROKEN failed, the rest (incl. EDGE) came back
    assert [e["host_id"] for e in body["errors"]] == [BROKEN]


@respx.mock
async def test_hosts_fanout_partial_failure(docker_client):
    mock_zabbix_session_ok()
    FakeDockerHostClient.fail_hosts = {BROKEN}
    res = await docker_client.get("/api/docker/hosts", headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    ok_ids = {h["id"] for h in body["hosts"]}
    assert ok_ids == {PROD_A, DB_1, EDGE}
    assert [e["host_id"] for e in body["errors"]] == [BROKEN]


# ---- inspect / search -------------------------------------------------------


@respx.mock
async def test_inspect_returns_container_attrs(docker_client):
    mock_zabbix_session_ok()
    res = await docker_client.get(f"/api/docker/containers/{DB_1}/c1", headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["Id"] == "c1"
    assert body["host_id"] == DB_1


@respx.mock
async def test_inspect_unknown_host_is_404(docker_client):
    mock_zabbix_session_ok()
    res = await docker_client.get("/api/docker/containers/no-such-host/c1", headers=AUTH)
    assert res.status_code == 404


@respx.mock
async def test_search_finds_container_by_name_substring(docker_client):
    mock_zabbix_session_ok()
    res = await docker_client.get(
        "/api/docker/search", params={"q": "web1", "types": ["containers"]}, headers=AUTH
    )
    assert res.status_code == 200
    body = res.json()
    names = [c["name"] for c in body["results"]["containers"]]
    assert names == ["web1"]


@respx.mock
async def test_search_annotates_images_with_the_containers_using_them(docker_client):
    mock_zabbix_session_ok()
    res = await docker_client.get(
        "/api/docker/search", params={"types": ["images"], "hosts": [DB_1]}, headers=AUTH
    )
    assert res.status_code == 200
    used_by = {i["Id"]: i["used_by"] for i in res.json()["results"]["images"]}
    assert used_by == {"sha256:abc": ["web1"], "sha256:dangling": []}


@respx.mock
async def test_search_annotates_volumes_and_ignores_bind_mounts(docker_client):
    mock_zabbix_session_ok()
    res = await docker_client.get(
        "/api/docker/search", params={"types": ["volumes"], "hosts": [DB_1]}, headers=AUTH
    )
    assert res.status_code == 200
    rows = res.json()["results"]["volumes"]
    assert {v["Name"]: v["used_by"] for v in rows} == {"pgdata": ["web1"], "orphan": []}


@respx.mock
async def test_search_annotates_networks_including_the_unused_builtins(docker_client):
    mock_zabbix_session_ok()
    res = await docker_client.get(
        "/api/docker/search", params={"types": ["networks"], "hosts": [DB_1]}, headers=AUTH
    )
    assert res.status_code == 200
    rows = res.json()["results"]["networks"]
    # Docker's built-in `none` network exists on every host and is normally
    # attached to nothing — it must list as unused, not be dropped.
    assert {n["Name"]: n["used_by"] for n in rows} == {"bridge": ["web1"], "none": []}


@respx.mock
async def test_search_still_returns_rows_when_the_usage_lookup_fails(docker_client, monkeypatch):
    """A failing container listing costs the annotation, not the payload."""
    mock_zabbix_session_ok()

    def boom(self, all: bool = True):  # noqa: A002
        raise RuntimeError("container listing unavailable")

    monkeypatch.setattr(FakeDockerHostClient, "list_containers", boom)
    res = await docker_client.get(
        "/api/docker/search", params={"types": ["volumes"], "hosts": [DB_1]}, headers=AUTH
    )
    assert res.status_code == 200
    body = res.json()
    assert {v["Name"]: v["used_by"] for v in body["results"]["volumes"]} == {
        "pgdata": [],
        "orphan": [],
    }
    # The volume listing itself succeeded, so this is not a partial result.
    assert body["errors"] == []


@respx.mock
async def test_search_rejects_unknown_type(docker_client):
    mock_zabbix_session_ok()
    res = await docker_client.get(
        "/api/docker/search", params={"q": "x", "types": ["bogus"]}, headers=AUTH
    )
    assert res.status_code == 422


# ---- log cursor round-trip --------------------------------------------------


@respx.mock
async def test_log_cursor_roundtrip_yields_no_duplicates(docker_client):
    mock_zabbix_session_ok()
    res1 = await docker_client.get(f"/api/docker/containers/{DB_1}/c1/logs", headers=AUTH)
    assert res1.status_code == 200
    body1 = res1.json()
    assert [ln["message"] for ln in body1["lines"]] == ["line one", "line two", "line three"]
    cursor = body1["cursor"]
    assert cursor

    res2 = await docker_client.get(
        f"/api/docker/containers/{DB_1}/c1/logs", params={"since": cursor}, headers=AUTH
    )
    assert res2.status_code == 200
    body2 = res2.json()
    assert body2["lines"] == []  # nothing new since the cursor -> no duplicates


@respx.mock
async def test_log_since_accepts_plain_unix_timestamp(docker_client):
    mock_zabbix_session_ok()
    res = await docker_client.get(
        f"/api/docker/containers/{DB_1}/c1/logs",
        params={"since": "1700000060"},
        headers=AUTH,
    )
    assert res.status_code == 200
    messages = [ln["message"] for ln in res.json()["lines"]]
    assert messages == ["line three"]


# ---- bulk stats --------------------------------------------------------


@respx.mock
async def test_bulk_stats(docker_client):
    mock_zabbix_session_ok()
    res = await docker_client.post(
        "/api/docker/stats", json={"targets": {DB_1: ["c1"]}}, headers=AUTH
    )
    assert res.status_code == 200
    body = res.json()
    assert body["stats"][DB_1]["c1"]["mem_used"] == 1000
    assert body["stats"][DB_1]["c1"]["mem_limit"] == 2000


async def test_bulk_stats_rejects_invalid_container_id():
    res_settings = docker_settings()
    app = create_app(res_settings, docker_client_factory=fake_factory)
    import httpx

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as c:
        with respx.mock:
            mock_zabbix_session_ok()
            res = await c.post(
                "/api/docker/stats",
                json={"targets": {DB_1: ["not valid!"]}},
                headers=AUTH,
            )
    assert res.status_code == 422


# ---- role resolution (all three ZabbixClient.get_user_role_type paths) ----


ROLE_URL_HOST = DB_1
CID = "c1"


def _action_body(action="start"):
    return {"action": action}


@respx.mock
async def test_role_via_checkauthentication_type_field(docker_client):
    def side_effect(request):
        payload = json.loads(request.content)
        if payload["method"] == "user.get":
            return Response(200, json=zabbix_result([{"userid": "1"}]))
        if payload["method"] == "user.checkAuthentication":
            return Response(200, json=zabbix_result({"userid": "1", "type": 3}))
        raise AssertionError(f"unexpected method {payload['method']}")

    respx.post(ZABBIX_URL).mock(side_effect=side_effect)
    res = await docker_client.post(
        f"/api/docker/containers/{ROLE_URL_HOST}/{CID}/action",
        json=_action_body(),
        headers=AUTH,
    )
    assert res.status_code == 200


@respx.mock
async def test_role_via_checkauthentication_roleid_and_role_get(docker_client):
    def side_effect(request):
        payload = json.loads(request.content)
        if payload["method"] == "user.get":
            return Response(200, json=zabbix_result([{"userid": "1"}]))
        if payload["method"] == "user.checkAuthentication":
            return Response(200, json=zabbix_result({"userid": "1", "roleid": "7"}))
        if payload["method"] == "role.get":
            assert payload["params"]["roleids"] == ["7"]
            return Response(200, json=zabbix_result([{"type": 3}]))
        raise AssertionError(f"unexpected method {payload['method']}")

    respx.post(ZABBIX_URL).mock(side_effect=side_effect)
    res = await docker_client.post(
        f"/api/docker/containers/{ROLE_URL_HOST}/{CID}/action",
        json=_action_body(),
        headers=AUTH,
    )
    assert res.status_code == 200


@respx.mock
async def test_role_via_api_token_fallback_user_get(docker_client):
    def side_effect(request):
        payload = json.loads(request.content)
        if payload["method"] == "user.checkAuthentication":
            # API tokens are not session ids -> Zabbix rejects this call.
            return Response(
                200, json={"jsonrpc": "2.0", "id": 1, "error": {"message": "not authorized"}}
            )
        if payload["method"] == "user.get":
            if payload["params"].get("output") == ["userid"]:
                return Response(200, json=zabbix_result([{"userid": "1"}]))
            return Response(200, json=zabbix_result([{"userid": "1", "roleid": "3", "type": 3}]))
        raise AssertionError(f"unexpected method {payload['method']}")

    respx.post(ZABBIX_URL).mock(side_effect=side_effect)
    res = await docker_client.post(
        f"/api/docker/containers/{ROLE_URL_HOST}/{CID}/action",
        json=_action_body(),
        headers=AUTH,
    )
    assert res.status_code == 200


# ---- action matrix: non-admin / readonly / writable ------------------------


@respx.mock
async def test_action_non_admin_is_403(docker_client):
    def side_effect(request):
        payload = json.loads(request.content)
        if payload["method"] == "user.get":
            return Response(200, json=zabbix_result([{"userid": "1"}]))
        if payload["method"] == "user.checkAuthentication":
            return Response(200, json=zabbix_result({"userid": "1", "type": 1}))
        raise AssertionError(payload["method"])

    respx.post(ZABBIX_URL).mock(side_effect=side_effect)
    res = await docker_client.post(
        f"/api/docker/containers/{DB_1}/c1/action", json=_action_body(), headers=AUTH
    )
    assert res.status_code == 403
    assert FakeDockerHostClient.actions == []


@respx.mock
async def test_action_admin_on_readonly_host_is_403(docker_client):
    def side_effect(request):
        payload = json.loads(request.content)
        if payload["method"] == "user.get":
            return Response(200, json=zabbix_result([{"userid": "1"}]))
        if payload["method"] == "user.checkAuthentication":
            return Response(200, json=zabbix_result({"userid": "1", "type": 3}))
        raise AssertionError(payload["method"])

    respx.post(ZABBIX_URL).mock(side_effect=side_effect)
    res = await docker_client.post(
        f"/api/docker/containers/{PROD_A}/c2/action", json=_action_body(), headers=AUTH
    )
    assert res.status_code == 403
    assert FakeDockerHostClient.actions == []


@respx.mock
async def test_action_admin_on_writable_host_succeeds(docker_client):
    def side_effect(request):
        payload = json.loads(request.content)
        if payload["method"] == "user.get":
            return Response(200, json=zabbix_result([{"userid": "1"}]))
        if payload["method"] == "user.checkAuthentication":
            return Response(200, json=zabbix_result({"userid": "1", "type": 2}))
        raise AssertionError(payload["method"])

    respx.post(ZABBIX_URL).mock(side_effect=side_effect)
    res = await docker_client.post(
        f"/api/docker/containers/{DB_1}/c1/action",
        json=_action_body("restart"),
        headers=AUTH,
    )
    assert res.status_code == 200
    assert FakeDockerHostClient.actions == [(DB_1, "c1", "restart")]


@respx.mock
async def test_action_invalid_literal_is_422(docker_client):
    mock_zabbix_session_ok()
    res = await docker_client.post(
        f"/api/docker/containers/{DB_1}/c1/action",
        json={"action": "delete_everything"},
        headers=AUTH,
    )
    assert res.status_code == 422


@respx.mock
async def test_action_unknown_host_is_404(docker_client):
    def side_effect(request):
        payload = json.loads(request.content)
        if payload["method"] == "user.get":
            return Response(200, json=zabbix_result([{"userid": "1"}]))
        if payload["method"] == "user.checkAuthentication":
            return Response(200, json=zabbix_result({"userid": "1", "type": 3}))
        raise AssertionError(payload["method"])

    respx.post(ZABBIX_URL).mock(side_effect=side_effect)
    res = await docker_client.post(
        "/api/docker/containers/no-such-host/c1/action", json=_action_body(), headers=AUTH
    )
    assert res.status_code == 404


# ---- permissions --------------------------------------------------------


@respx.mock
async def test_permissions_reflects_admin_role(docker_client):
    def side_effect(request):
        payload = json.loads(request.content)
        if payload["method"] == "user.get":
            return Response(200, json=zabbix_result([{"userid": "1"}]))
        if payload["method"] == "user.checkAuthentication":
            return Response(200, json=zabbix_result({"userid": "1", "type": 0}))
        raise AssertionError(payload["method"])

    respx.post(ZABBIX_URL).mock(side_effect=side_effect)
    res = await docker_client.get("/api/docker/permissions", headers=AUTH)
    assert res.status_code == 200
    assert res.json() == {"can_act": False}


# ---- stacks / compose ----------------------------------------------------


@respx.mock
async def test_stack_action_on_non_compose_host_is_404(docker_client):
    def side_effect(request):
        payload = json.loads(request.content)
        if payload["method"] == "user.get":
            return Response(200, json=zabbix_result([{"userid": "1"}]))
        if payload["method"] == "user.checkAuthentication":
            return Response(200, json=zabbix_result({"userid": "1", "type": 3}))
        raise AssertionError(payload["method"])

    respx.post(ZABBIX_URL).mock(side_effect=side_effect)
    res = await docker_client.post(
        f"/api/docker/stacks/{DB_1}/myapp/action", json={"action": "pull"}, headers=AUTH
    )
    assert res.status_code == 404


@respx.mock
async def test_stacks_listing_groups_by_project(docker_client):
    mock_zabbix_session_ok()
    FakeDockerHostClient.containers_by_host[DB_1] = [
        {**DB1_CONTAINER, "Labels": {"com.docker.compose.project": "myapp"}}
    ]
    res = await docker_client.get(f"/api/docker/stacks/{DB_1}", headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["compose"] is False
    assert [s["project"] for s in body["stacks"]] == ["myapp"]
    # Non-compose hosts never trigger an SSH fan-out and never get a `ps` key.
    assert "ps" not in body["stacks"][0]
    assert FakeDockerHostClient.ssh_calls == []


@respx.mock
async def test_stacks_listing_enriches_compose_host_with_ps(docker_client):
    mock_zabbix_session_ok()
    ps_cmd = build_compose_command(EDGE_WORKING_DIR, EDGE_CONFIG_FILES, "ps", "--format", "json")
    FakeDockerHostClient.ssh_responses[ps_cmd] = (
        0,
        json.dumps([{"Name": "myapp-web-1", "State": "running"}]),
        "",
    )
    res = await docker_client.get(f"/api/docker/stacks/{EDGE}", headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["compose"] is True
    stack = next(s for s in body["stacks"] if s["project"] == EDGE_PROJECT)
    assert stack["ps"] == [{"Name": "myapp-web-1", "State": "running"}]
    assert stack["containers"]  # container list is still present alongside ps
    assert body["errors"] == []


@respx.mock
async def test_stacks_listing_ps_failure_keeps_stack_and_records_error(docker_client):
    mock_zabbix_session_ok()
    ps_cmd = build_compose_command(EDGE_WORKING_DIR, EDGE_CONFIG_FILES, "ps", "--format", "json")
    FakeDockerHostClient.ssh_responses[ps_cmd] = (1, "", "connection reset")
    res = await docker_client.get(f"/api/docker/stacks/{EDGE}", headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    stack = next(s for s in body["stacks"] if s["project"] == EDGE_PROJECT)
    # The stack (and its containers) survive a failed `ps` call; only its
    # `ps` field degrades to empty, and the failure is reported in errors.
    assert stack["ps"] == []
    assert stack["containers"]
    assert len(body["errors"]) == 1
    assert body["errors"][0]["host_id"] == EDGE


@respx.mock
async def test_stack_config_returns_path_and_content(docker_client):
    mock_zabbix_session_ok()
    cat_cmd = build_cat_command(EDGE_CONFIG_FILES[0])
    content = "services:\n  web:\n    image: nginx\n"
    FakeDockerHostClient.ssh_responses[cat_cmd] = (0, content, "")
    res = await docker_client.get(f"/api/docker/stacks/{EDGE}/{EDGE_PROJECT}/config", headers=AUTH)
    assert res.status_code == 200
    assert res.json() == {"path": EDGE_CONFIG_FILES[0], "content": content}


@respx.mock
async def test_stack_config_on_non_compose_host_is_404(docker_client):
    mock_zabbix_session_ok()
    FakeDockerHostClient.containers_by_host[DB_1] = [
        {**DB1_CONTAINER, "Labels": {"com.docker.compose.project": "myapp"}}
    ]
    res = await docker_client.get(f"/api/docker/stacks/{DB_1}/myapp/config", headers=AUTH)
    assert res.status_code == 404


async def test_stack_config_requires_session(docker_client):
    res = await docker_client.get(f"/api/docker/stacks/{EDGE}/{EDGE_PROJECT}/config")
    assert res.status_code == 401
