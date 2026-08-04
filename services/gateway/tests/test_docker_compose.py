import pytest
from fastapi import HTTPException

from auzui_gateway import docker_compose
from auzui_gateway.config import DockerHost, Settings
from auzui_gateway.docker_compose import (
    ComposeRunner,
    build_cat_command,
    build_compose_command,
    parse_compose_ps,
    validate_compose_path,
    validate_project_name,
)

WORKING_DIR = "/srv/stacks/myapp"
CONFIG_FILES = ["/srv/stacks/myapp/docker-compose.yml", "/srv/stacks/myapp/override.yml"]


# --- command construction ----------------------------------------------------


def test_build_compose_command_pull():
    cmd = build_compose_command(WORKING_DIR, CONFIG_FILES, "pull")
    assert cmd == (
        "cd /srv/stacks/myapp && docker compose "
        "-f /srv/stacks/myapp/docker-compose.yml -f /srv/stacks/myapp/override.yml pull"
    )


def test_build_compose_command_up():
    cmd = build_compose_command(WORKING_DIR, CONFIG_FILES, "up", "-d")
    assert cmd == (
        "cd /srv/stacks/myapp && docker compose "
        "-f /srv/stacks/myapp/docker-compose.yml -f /srv/stacks/myapp/override.yml up -d"
    )


def test_build_compose_command_restart():
    cmd = build_compose_command(WORKING_DIR, CONFIG_FILES, "restart")
    assert cmd == (
        "cd /srv/stacks/myapp && docker compose "
        "-f /srv/stacks/myapp/docker-compose.yml -f /srv/stacks/myapp/override.yml restart"
    )


def test_build_compose_command_ps():
    cmd = build_compose_command(WORKING_DIR, CONFIG_FILES, "ps", "--format", "json")
    assert cmd == (
        "cd /srv/stacks/myapp && docker compose "
        "-f /srv/stacks/myapp/docker-compose.yml -f /srv/stacks/myapp/override.yml "
        "ps --format json"
    )


def test_build_compose_command_single_file():
    cmd = build_compose_command(WORKING_DIR, [CONFIG_FILES[0]], "pull")
    assert cmd == (
        "cd /srv/stacks/myapp && docker compose -f /srv/stacks/myapp/docker-compose.yml pull"
    )


def test_build_cat_command():
    cmd = build_cat_command(CONFIG_FILES[0])
    assert cmd == "cat /srv/stacks/myapp/docker-compose.yml"


def test_build_compose_command_quotes_paths_with_spaces():
    cmd = build_compose_command("/srv/my app", ["/srv/my app/docker-compose.yml"], "pull")
    assert cmd == ("cd '/srv/my app' && docker compose -f '/srv/my app/docker-compose.yml' pull")


# --- path validation attack matrix -------------------------------------------


VALID_PATHS = ["/srv/app/docker-compose.yml", "/srv/stacks/my-app_1/x.yaml"]

INVALID_PATHS = [
    "/srv/app; rm -rf /",
    "../etc/passwd",
    "etc/passwd",  # relative
    "relative/path.yml",
    "/srv/app/`whoami`",
    "/srv/app/\nrm -rf /",
    "/srv/app/$(whoami)",
    "",
    "/srv/../etc/passwd",
    "/srv/app/file|cat /etc/shadow",
    "/srv/app/file&&reboot",
    "/srv/app/file>out",
    "/srv/app/file<in",
    "/srv/app/file'quote",
    '/srv/app/file"quote',
]


@pytest.mark.parametrize("path", VALID_PATHS)
def test_validate_compose_path_accepts_valid(path):
    assert validate_compose_path(path) == path


@pytest.mark.parametrize("path", INVALID_PATHS)
def test_validate_compose_path_rejects_attack_matrix(path):
    with pytest.raises(ValueError):
        validate_compose_path(path)


def test_validate_project_name_accepts_valid():
    assert validate_project_name("my-app_1.2") == "my-app_1.2"


@pytest.mark.parametrize("name", ["my app", "app;rm", "../app", "", "app`whoami`", "app$(whoami)"])
def test_validate_project_name_rejects_invalid(name):
    with pytest.raises(ValueError):
        validate_project_name(name)


# --- ps parsing: JSON array or JSON lines ------------------------------------


def test_parse_compose_ps_json_array():
    stdout = '[{"Name":"myapp-web-1","State":"running"},{"Name":"myapp-db-1","State":"running"}]'
    rows = parse_compose_ps(stdout)
    assert rows == [
        {"Name": "myapp-web-1", "State": "running"},
        {"Name": "myapp-db-1", "State": "running"},
    ]


def test_parse_compose_ps_json_lines():
    stdout = '{"Name":"myapp-web-1","State":"running"}\n{"Name":"myapp-db-1","State":"exited"}\n'
    rows = parse_compose_ps(stdout)
    assert rows == [
        {"Name": "myapp-web-1", "State": "running"},
        {"Name": "myapp-db-1", "State": "exited"},
    ]


def test_parse_compose_ps_single_object():
    rows = parse_compose_ps('{"Name":"myapp-web-1","State":"running"}')
    assert rows == [{"Name": "myapp-web-1", "State": "running"}]


def test_parse_compose_ps_empty():
    assert parse_compose_ps("") == []
    assert parse_compose_ps("   \n  ") == []


def test_parse_compose_ps_skips_unparsable_lines():
    stdout = '{"Name":"ok","State":"running"}\nnot json\n'
    rows = parse_compose_ps(stdout)
    assert rows == [{"Name": "ok", "State": "running"}]


# --- ComposeRunner integration with a fake SSH transport --------------------


class FakeDockerHostClient:
    """Stand-in for docker_hosts.DockerHostClient: records every command it
    was asked to run over "SSH" and returns a scripted (exit_code, stdout,
    stderr) response."""

    calls: list[str] = []
    responses: dict[str, tuple[int, str, str]] = {}
    default_response: tuple[int, str, str] = (0, "", "")

    def __init__(self, host, settings) -> None:
        self.host = host
        self.settings = settings

    def exec_ssh(self, command: str) -> tuple[int, str, str]:
        FakeDockerHostClient.calls.append(command)
        return FakeDockerHostClient.responses.get(command, FakeDockerHostClient.default_response)


class FakeDockerService:
    """Duck-typed stand-in for docker_hosts.DockerService, implementing only
    what ComposeRunner needs: get_host() and containers()."""

    def __init__(self, hosts: dict[str, DockerHost], containers: list[dict]) -> None:
        self._hosts = hosts
        self._containers = containers

    def get_host(self, host_id: str) -> DockerHost:
        try:
            return self._hosts[host_id]
        except KeyError:
            raise HTTPException(404, f"unknown host {host_id!r}") from None

    async def containers(self, host_ids, all_: bool) -> dict:
        rows = [c for c in self._containers if c["host_id"] in host_ids]
        return {"containers": rows, "errors": []}


SSH_HOST = DockerHost(id="edge", label="edge", url="ssh://deploy@edge.example.com", compose=True)
NON_COMPOSE_HOST = DockerHost(id="prod-a", label="prod-a", url="http://sockproxy-a:2375")

CONTAINER_ROW = {
    "id": "abc123",
    "host_id": "edge",
    "name": "myapp-web-1",
    "names": ["myapp-web-1"],
    "image": "nginx",
    "tag": "1.25",
    "image_id": "sha256:x",
    "state": "running",
    "status": "Up",
    "health": "",
    "created": 1700000000,
    "ports": [],
    "project": "myapp",
    "service": "web",
    "compose_working_dir": WORKING_DIR,
    "labels": {
        "com.docker.compose.project": "myapp",
        "com.docker.compose.service": "web",
        "com.docker.compose.project.working_dir": WORKING_DIR,
        "com.docker.compose.project.config_files": ",".join(CONFIG_FILES),
    },
}


@pytest.fixture(autouse=True)
def fake_transport(monkeypatch):
    FakeDockerHostClient.calls = []
    FakeDockerHostClient.responses = {}
    FakeDockerHostClient.default_response = (0, "", "")
    monkeypatch.setattr(docker_compose, "DockerHostClient", FakeDockerHostClient)
    yield


def make_runner(hosts=None, containers=None) -> ComposeRunner:
    hosts = hosts if hosts is not None else {"edge": SSH_HOST, "prod-a": NON_COMPOSE_HOST}
    containers = containers if containers is not None else [CONTAINER_ROW]
    service = FakeDockerService(hosts, containers)
    settings = Settings(_env_file=None)
    return ComposeRunner(service, settings)


async def test_act_pull_runs_expected_command():
    runner = make_runner()
    result = await runner.act("edge", "myapp", "pull")
    assert result == {"stdout": "", "stderr": ""}
    assert FakeDockerHostClient.calls == [build_compose_command(WORKING_DIR, CONFIG_FILES, "pull")]


async def test_act_up_runs_expected_command():
    runner = make_runner()
    await runner.act("edge", "myapp", "up")
    assert FakeDockerHostClient.calls == [
        build_compose_command(WORKING_DIR, CONFIG_FILES, "up", "-d")
    ]


async def test_act_restart_runs_expected_command():
    runner = make_runner()
    await runner.act("edge", "myapp", "restart")
    assert FakeDockerHostClient.calls == [
        build_compose_command(WORKING_DIR, CONFIG_FILES, "restart")
    ]


async def test_act_rejects_unknown_action():
    runner = make_runner()
    with pytest.raises(HTTPException) as exc_info:
        await runner.act("edge", "myapp", "delete_everything")
    assert exc_info.value.status_code == 400
    assert FakeDockerHostClient.calls == []


async def test_act_non_zero_exit_raises_502():
    FakeDockerHostClient.default_response = (1, "", "error: something broke")
    runner = make_runner()
    with pytest.raises(HTTPException) as exc_info:
        await runner.act("edge", "myapp", "pull")
    assert exc_info.value.status_code == 502
    assert "something broke" in exc_info.value.detail


async def test_act_rejects_non_compose_host():
    runner = make_runner()
    with pytest.raises(HTTPException) as exc_info:
        await runner.act("prod-a", "myapp", "pull")
    assert exc_info.value.status_code == 404
    assert FakeDockerHostClient.calls == []


async def test_act_unknown_host():
    runner = make_runner()
    with pytest.raises(HTTPException) as exc_info:
        await runner.act("nope", "myapp", "pull")
    assert exc_info.value.status_code == 404


async def test_act_unknown_project():
    runner = make_runner()
    with pytest.raises(HTTPException) as exc_info:
        await runner.act("edge", "no-such-project", "pull")
    assert exc_info.value.status_code == 404


async def test_ps_parses_json_array_response():
    command = build_compose_command(WORKING_DIR, CONFIG_FILES, "ps", "--format", "json")
    FakeDockerHostClient.responses[command] = (
        0,
        '[{"Name":"myapp-web-1","State":"running"}]',
        "",
    )
    runner = make_runner()
    rows = await runner.ps("edge", "myapp")
    assert rows == [{"Name": "myapp-web-1", "State": "running"}]


async def test_ps_parses_json_lines_response():
    command = build_compose_command(WORKING_DIR, CONFIG_FILES, "ps", "--format", "json")
    FakeDockerHostClient.responses[command] = (
        0,
        '{"Name":"myapp-web-1","State":"running"}\n{"Name":"myapp-db-1","State":"exited"}\n',
        "",
    )
    runner = make_runner()
    rows = await runner.ps("edge", "myapp")
    assert rows == [
        {"Name": "myapp-web-1", "State": "running"},
        {"Name": "myapp-db-1", "State": "exited"},
    ]


async def test_ps_non_zero_exit_raises_502():
    FakeDockerHostClient.default_response = (1, "", "no such project")
    runner = make_runner()
    with pytest.raises(HTTPException) as exc_info:
        await runner.ps("edge", "myapp")
    assert exc_info.value.status_code == 502


async def test_config_file_returns_content():
    command = build_cat_command(CONFIG_FILES[0])
    FakeDockerHostClient.responses[command] = (0, "services:\n  web:\n    image: nginx\n", "")
    runner = make_runner()
    content = await runner.config_file("edge", "myapp")
    assert content == "services:\n  web:\n    image: nginx\n"


async def test_config_file_caps_size():
    huge = "x" * (docker_compose.MAX_CONFIG_FILE_BYTES + 1000)
    command = build_cat_command(CONFIG_FILES[0])
    FakeDockerHostClient.responses[command] = (0, huge, "")
    runner = make_runner()
    content = await runner.config_file("edge", "myapp")
    assert len(content.encode()) <= docker_compose.MAX_CONFIG_FILE_BYTES


async def test_config_file_non_zero_exit_raises_502():
    FakeDockerHostClient.default_response = (1, "", "permission denied")
    runner = make_runner()
    with pytest.raises(HTTPException) as exc_info:
        await runner.config_file("edge", "myapp")
    assert exc_info.value.status_code == 502
