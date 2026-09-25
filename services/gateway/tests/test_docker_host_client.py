"""`DockerHostClient` itself — the thin docker-py wrapper. The rest of the
docker suite injects a FakeDockerHostClient and therefore never executes
these methods, which is exactly how the sparse= regression below reached
production: every test fed the wrapper's OUTPUT shape in by hand."""

from types import SimpleNamespace

import pytest

from auzui_gateway.config import DockerHost, Settings
from auzui_gateway.docker_hosts import (
    SSH_EXEC_MAX_CAPTURE_BYTES,
    DockerHostClient,
    SSHExecTimeoutError,
    _normalize_container,
)


class _FakeModel:
    def __init__(self, attrs: dict) -> None:
        self.attrs = attrs


# Trimmed to the fields _normalize_container reads. The important difference
# is `Created`: unix int in the list shape, RFC3339 string in the inspect one.
LIST_SHAPE = {
    "Id": "abc123",
    "Names": ["/web"],
    "Image": "nginx:1.25",
    "ImageID": "sha256:deadbeef",
    "State": "running",
    "Status": "Up 2 hours (healthy)",
    "Created": 1785843647,
    "Ports": [],
    "Labels": {"com.docker.compose.project": "myapp"},
}
INSPECT_SHAPE = {
    "Id": "abc123",
    "Name": "/web",
    "Created": "2026-08-04T11:40:47.264793129Z",
    "State": {"Status": "running", "Health": {"Status": "healthy"}},
    "Config": {"Image": "nginx:1.25", "Labels": {"com.docker.compose.project": "myapp"}},
}


class _FakeContainers:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def list(self, all=True, sparse=False):  # noqa: A002 — mirrors docker-py
        self.calls.append({"all": all, "sparse": sparse})
        # Faithful to docker-py: without sparse it inspects each container,
        # so attrs come back in the inspect shape.
        return [_FakeModel(LIST_SHAPE if sparse else INSPECT_SHAPE)]


class _FakeContainer:
    """docker-py's Container.logs(**kwargs) forwards straight into
    APIClient.logs — whose signature this mirrors *exactly*, `demux` included
    by its absence (verified against docker-py 7.2.0). An unknown keyword
    therefore raises TypeError here just as it does in production."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def logs(
        self,
        stdout=True,
        stderr=True,
        stream=False,
        timestamps=False,
        tail="all",
        since=None,
        until=None,
        follow=None,
    ) -> bytes:
        self.calls.append({"stdout": stdout, "stderr": stderr, "tail": tail, "since": since})
        if stdout and not stderr:
            return (
                b"2026-08-04T11:40:47.100000000Z out-one\n2026-08-04T11:40:49.300000000Z out-two\n"
            )
        if stderr and not stdout:
            return b"2026-08-04T11:40:48.200000000Z err-one\n"
        raise AssertionError("both streams in one call: the Docker API does not merge them")


class _FakeDockerPy:
    def __init__(self) -> None:
        self.containers = _FakeContainers()
        self.container = _FakeContainer()
        self.containers.get = lambda cid: self.container  # type: ignore[method-assign]


def _client() -> tuple[DockerHostClient, _FakeDockerPy]:
    host = DockerHost(id="edge", label="edge", url="tcp://127.0.0.1:2375")
    client = DockerHostClient(host, Settings())
    fake = _FakeDockerPy()
    client._client = fake
    return client, fake


def test_list_containers_returns_the_list_shape_not_the_inspect_shape():
    client, _ = _client()

    rows = client.list_containers(all=True)

    # Regression: with docker-py's sparse=False default these were inspect
    # payloads, and normalizing them raised
    # ValueError: invalid literal for int() with base 10: '2026-08-04T...'
    assert rows == [LIST_SHAPE]
    normalized = _normalize_container("edge", rows[0])
    assert normalized["created"] == 1785843647
    assert normalized["name"] == "web"


def test_list_containers_issues_a_single_request_per_host():
    client, fake = _client()

    client.list_containers(all=False)

    # sparse=False would also mean one inspect per container on top of the
    # list call — N+1 round trips across the WireGuard tunnel.
    assert fake.containers.calls == [{"all": False, "sparse": True}]


def test_logs_fetches_each_stream_separately_and_tags_the_lines():
    client, fake = _client()

    # Regression: this used to pass demux=True in one call, which raised
    # TypeError: ContainerApiMixin.logs() got an unexpected keyword argument
    # 'demux' — every log request 500'd, for every container.
    raw = client.logs("abc123", tail=50)

    assert [c["stdout"] for c in fake.container.calls] == [True, False]
    assert [c["stderr"] for c in fake.container.calls] == [False, True]
    assert all(c["tail"] == 50 for c in fake.container.calls)
    assert raw.splitlines() == [
        "1\t2026-08-04T11:40:47.100000000Z out-one",
        "1\t2026-08-04T11:40:49.300000000Z out-two",
        "2\t2026-08-04T11:40:48.200000000Z err-one",
    ]


def test_logs_requests_only_the_stream_that_was_asked_for():
    client, fake = _client()

    raw = client.logs("abc123", stderr=False)

    assert fake.container.calls == [{"stdout": True, "stderr": False, "tail": "all", "since": None}]
    assert all(ln.startswith("1\t") for ln in raw.splitlines())


# --- exec_ssh -----------------------------------------------------------
#
# These fake the paramiko *channel* directly (recv_ready/recv/recv_stderr_
# ready/recv_stderr/exit_status_ready/recv_exit_status/close) rather than a
# real socket, so no network or real paramiko connection is involved.


class FakeChannel:
    """Stand-in for paramiko.Channel. `stdout_chunks`/`stderr_chunks` are
    consumed one at a time as if arriving progressively off the wire;
    `exit_status_ready()` only reports True once both are drained (unless
    `never_exits`, which simulates a hung remote command)."""

    def __init__(self, stdout_chunks=(), stderr_chunks=(), exit_code=0, never_exits=False):
        self._stdout_chunks = list(stdout_chunks)
        self._stderr_chunks = list(stderr_chunks)
        self._exit_code = exit_code
        self._never_exits = never_exits
        self.closed = False

    def recv_ready(self):
        return bool(self._stdout_chunks)

    def recv(self, nbytes):
        return self._stdout_chunks.pop(0) if self._stdout_chunks else b""

    def recv_stderr_ready(self):
        return bool(self._stderr_chunks)

    def recv_stderr(self, nbytes):
        return self._stderr_chunks.pop(0) if self._stderr_chunks else b""

    def exit_status_ready(self):
        if self._never_exits:
            return False
        return not self._stdout_chunks and not self._stderr_chunks

    def recv_exit_status(self):
        return self._exit_code

    def close(self):
        self.closed = True


class FakeParamikoClient:
    """Stand-in for paramiko.SSHClient, just enough of exec_command() to
    hand exec_ssh a channel: real paramiko's exec_command() returns three
    ChannelFile objects that all share one `.channel`, so this mirrors that
    (exec_ssh never calls .read() on stdout/stderr, only reaches through to
    .channel — that's the whole point of the fix under test)."""

    def __init__(self, channel: FakeChannel):
        self.channel = channel
        self.exec_command_calls: list[tuple[str, float | None]] = []
        self.closed = False

    def exec_command(self, command, timeout=None):
        self.exec_command_calls.append((command, timeout))
        stdout = SimpleNamespace(channel=self.channel)
        stderr = SimpleNamespace(channel=self.channel)
        stdin = SimpleNamespace(channel=self.channel)
        return stdin, stdout, stderr

    def close(self):
        self.closed = True


def _ssh_client(channel: FakeChannel) -> tuple[DockerHostClient, FakeParamikoClient]:
    host = DockerHost(id="edge", label="edge", url="ssh://deploy@edge.example.com", compose=True)
    client = DockerHostClient(host, Settings())
    fake_paramiko = FakeParamikoClient(channel)
    client._paramiko_client = lambda: fake_paramiko  # type: ignore[method-assign]
    return client, fake_paramiko


def test_exec_ssh_drains_output_larger_than_any_ssh_window_before_reading_exit_status():
    """Regression: the old implementation called recv_exit_status() before
    reading any output. If the remote writes more than paramiko's ~2 MiB
    receive window before the local side reads anything, the remote blocks
    on its own write and recv_exit_status() never returns -- a permanent
    deadlock pinning the calling thread. This feeds output in many small
    chunks totalling well over that window (and over the retention cap) and
    checks it still gets a clean exit -- i.e. the code was draining the
    channel *before* the command had necessarily exited, not waiting on
    recv_exit_status() first."""
    chunk = b"x" * 65536  # 64 KiB
    n_chunks = 48  # 3 MiB total: > paramiko's ~2 MiB window and > the 1 MiB cap
    stdout_chunks = [chunk] * n_chunks
    channel = FakeChannel(stdout_chunks=stdout_chunks, exit_code=0)
    client, fake_paramiko = _ssh_client(channel)

    exit_code, stdout, stderr = client.exec_ssh(
        "docker compose pull -v", timeout=5.0, poll_interval=0.001
    )

    assert exit_code == 0
    assert stderr == ""
    # Only the last SSH_EXEC_MAX_CAPTURE_BYTES bytes are retained, even
    # though all 3 MiB were drained off the (fake) wire.
    assert len(stdout.encode()) == SSH_EXEC_MAX_CAPTURE_BYTES
    assert stdout == "x" * SSH_EXEC_MAX_CAPTURE_BYTES
    assert not channel.closed
    assert fake_paramiko.closed


def test_exec_ssh_raises_and_closes_channel_when_command_never_exits():
    """A command that hangs forever (or a remote that stops responding)
    must not hang the caller: exec_ssh enforces an overall deadline and
    raises SSHExecTimeoutError, closing the channel so nothing is left
    dangling."""
    channel = FakeChannel(never_exits=True)
    client, fake_paramiko = _ssh_client(channel)

    with pytest.raises(SSHExecTimeoutError):
        client.exec_ssh("docker compose pull", timeout=0.05, poll_interval=0.01)

    assert channel.closed
    assert fake_paramiko.closed


def test_exec_ssh_uses_configured_docker_ssh_exec_timeout_by_default():
    """When no explicit timeout is passed, exec_ssh falls back to
    settings.docker_ssh_exec_timeout (not settings.docker_timeout, which is
    far too small for a legitimate `compose pull`)."""
    channel = FakeChannel(never_exits=True)
    host = DockerHost(id="edge", label="edge", url="ssh://deploy@edge.example.com", compose=True)
    settings = Settings(docker_ssh_exec_timeout=0.05)
    client = DockerHostClient(host, settings)
    fake_paramiko = FakeParamikoClient(channel)
    client._paramiko_client = lambda: fake_paramiko  # type: ignore[method-assign]

    with pytest.raises(SSHExecTimeoutError):
        client.exec_ssh("docker compose pull", poll_interval=0.01)

    assert channel.closed


def test_exec_ssh_separates_stdout_and_stderr():
    channel = FakeChannel(stdout_chunks=[b"out-1", b"out-2"], stderr_chunks=[b"err-1"], exit_code=1)
    client, _ = _ssh_client(channel)

    exit_code, stdout, stderr = client.exec_ssh("cmd", timeout=5.0, poll_interval=0.001)

    assert exit_code == 1
    assert stdout == "out-1out-2"
    assert stderr == "err-1"
