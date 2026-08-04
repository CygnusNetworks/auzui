"""`DockerHostClient` itself — the thin docker-py wrapper. The rest of the
docker suite injects a FakeDockerHostClient and therefore never executes
these methods, which is exactly how the sparse= regression below reached
production: every test fed the wrapper's OUTPUT shape in by hand."""

from auzui_gateway.config import DockerHost, Settings
from auzui_gateway.docker_hosts import DockerHostClient, _normalize_container


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


class _FakeDockerPy:
    def __init__(self) -> None:
        self.containers = _FakeContainers()


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
