"""`pull_recreate`'s config-preservation logic (docker_hosts.py).

Regression coverage for the bug where recreating a container after a pull
only copied a hand-picked subset of docker-py `containers.create()` kwargs
(ports/mounts/env/labels/restart-policy/hostname/working-dir/network
NAMES) and silently dropped everything else: Config.User,
HostConfig.ReadonlyRootfs/CapAdd/CapDrop/SecurityOpt/Privileged, resource
limits, NetworkMode (host/container:<id>/custom), and per-network
EndpointSettings (Aliases -- which Compose relies on for service-name DNS
--, static IPAMConfig addresses, Links).

Split into two layers, like test_docker_host_client.py:
  - pure unit tests of the helper functions that build the low-level
    `client.api.create_container(...)` kwargs from an inspect() dict --
    the fastest, most direct way to pin down exactly what is/isn't
    preserved.
  - one full `pull_recreate()` flow against a faked docker-py client,
    verifying the low-level API is actually called with that config, that
    extra networks get connected afterward, and that rollback on a failed
    create still restores the original container.
"""

import docker
import pytest

from auzui_gateway.config import DockerHost, Settings
from auzui_gateway.docker_hosts import (
    DockerHostClient,
    _recreate_container_spec,
    _recreate_networking,
    _strip_frozen_image_defaults,
    _with_anonymous_volumes_reused,
)

# A hardened container: non-root user, read-only rootfs, dropped
# capabilities, no-new-privileges, resource limits, a custom compose
# network with a service-name alias and a static IP, PLUS the
# auto-generated hostname/alias docker adds for the container's own id.
OLD_CONTAINER_ID = "abc123456789deadbeefcafefeedface"
SHORT_ID = OLD_CONTAINER_ID[:12]  # "abc123456789"

CONTAINER_ATTRS: dict = {
    "Id": OLD_CONTAINER_ID,
    "Name": "/web",
    "Image": "sha256:oldimage",
    "Config": {
        "Image": "myapp:1.0",
        "Hostname": SHORT_ID,  # auto-generated: no Hostname was set explicitly
        "Domainname": "",
        "User": "1000:1000",
        "Tty": False,
        "OpenStdin": False,
        "Env": ["FOO=bar", "PATH=/usr/bin"],
        "Cmd": ["run"],
        "Entrypoint": None,
        "ExposedPorts": {"8080/tcp": {}},
        "WorkingDir": "/app",
        "Labels": {"com.docker.compose.project": "stack", "com.docker.compose.service": "web"},
        "StopSignal": "SIGTERM",
        "StopTimeout": 15,
        "Healthcheck": None,
        "Volumes": None,
    },
    "HostConfig": {
        "NetworkMode": "stacknet",
        "ReadonlyRootfs": True,
        "CapAdd": None,
        "CapDrop": ["ALL"],
        "SecurityOpt": ["no-new-privileges:true"],
        "Privileged": False,
        "Memory": 134217728,
        "MemoryReservation": 67108864,
        "NanoCpus": 500000000,
        "PidsLimit": 100,
        "Ulimits": [{"Name": "nofile", "Soft": 1024, "Hard": 2048}],
        "RestartPolicy": {"Name": "unless-stopped", "MaximumRetryCount": 0},
        "PortBindings": {"8080/tcp": [{"HostIp": "", "HostPort": "8080"}]},
        "Binds": ["data-vol:/app/data:rw"],
        "Dns": ["10.0.0.53"],
        "ExtraHosts": ["db.internal:10.0.0.5"],
        "GroupAdd": ["999"],
        "Sysctls": {"net.core.somaxconn": "1024"},
    },
    # The container's one bind mount (data-vol) is already named in
    # HostConfig.Binds above; it also shows up here, as every mount does,
    # for _with_anonymous_volumes_reused to match against HostConfig and
    # confirm it must NOT be duplicated (case (c) below).
    "Mounts": [
        {"Type": "volume", "Name": "data-vol", "Destination": "/app/data", "RW": True},
    ],
    "NetworkSettings": {
        "Networks": {
            "stacknet": {
                "Aliases": ["db", SHORT_ID],
                "IPAMConfig": {"IPv4Address": "10.0.0.5"},
                "Links": None,
                "DriverOpts": {},
                "NetworkID": "netid-stacknet",
            },
            "sidecarnet": {
                "Aliases": ["web-sidecar", SHORT_ID],
                "IPAMConfig": None,
                "Links": None,
                "DriverOpts": {},
                "NetworkID": "netid-sidecar",
            },
        }
    },
}

OLD_IMAGE_CONFIG: dict = {
    "Env": ["PATH=/usr/bin"],  # matches the container's PATH entry -> dropped
    "Labels": {},
    "Cmd": ["run"],  # matches -> dropped, new image's default Cmd applies
    "Entrypoint": None,
    "ExposedPorts": {"8080/tcp": {}},  # matches -> dropped
    "WorkingDir": "/app",  # matches -> dropped
    "User": "",  # differs from container's "1000:1000" -> KEPT
    "Healthcheck": None,
}


# --- _strip_frozen_image_defaults -------------------------------------------


def test_strip_frozen_image_defaults_drops_only_values_matching_the_old_image():
    stripped = _strip_frozen_image_defaults(dict(CONTAINER_ATTRS["Config"]), OLD_IMAGE_CONFIG)

    # User differs from the old image's default -> it was an explicit
    # override, and MUST survive (dropping it would silently re-run the
    # container as whatever the new image defaults to, e.g. root).
    assert stripped["User"] == "1000:1000"
    # PATH matches the old image's default Env entry exactly -> dropped so
    # the new image's own default applies; FOO does not appear in the old
    # image's Env at all -> kept as a user override.
    assert stripped["Env"] == ["FOO=bar"]
    # Labels differ from the old image (empty) -> kept.
    assert stripped["Labels"] == {
        "com.docker.compose.project": "stack",
        "com.docker.compose.service": "web",
    }
    # Everything else matched the old image's default -> dropped so the
    # NEW image's defaults apply instead of freezing the old ones in.
    assert stripped["Cmd"] is None
    assert stripped["ExposedPorts"] is None
    assert stripped["WorkingDir"] is None
    assert stripped["Healthcheck"] is None


def test_strip_frozen_image_defaults_is_a_noop_when_old_image_is_unavailable():
    """Old image pruned/unavailable -> keep every value exactly as
    inspected rather than guessing; that's the documented safe fallback."""
    config = dict(CONTAINER_ATTRS["Config"])
    assert _strip_frozen_image_defaults(config, None) == config


# --- _recreate_networking ----------------------------------------------------


def test_recreate_networking_drops_the_old_containers_short_id_alias():
    networking_config, extra = _recreate_networking(CONTAINER_ATTRS, OLD_CONTAINER_ID)

    primary = networking_config["EndpointsConfig"]["stacknet"]
    assert primary["Aliases"] == ["db"]  # short id alias stripped
    assert primary["IPAMConfig"] == {"IPv4Address": "10.0.0.5"}

    assert [name for name, _ in extra] == ["sidecarnet"]
    sidecar_settings = dict(extra)["sidecarnet"]
    assert sidecar_settings["Aliases"] == ["web-sidecar"]


def test_recreate_networking_prefers_the_hostconfig_networkmode_as_primary():
    attrs = {
        **CONTAINER_ATTRS,
        "HostConfig": {**CONTAINER_ATTRS["HostConfig"], "NetworkMode": "sidecarnet"},
    }
    networking_config, extra = _recreate_networking(attrs, OLD_CONTAINER_ID)
    assert set(networking_config["EndpointsConfig"]) == {"sidecarnet"}
    assert [name for name, _ in extra] == ["stacknet"]


@pytest.mark.parametrize("mode", ["host", "none", "container:otherid"])
def test_recreate_networking_attaches_nothing_for_host_none_or_container_mode(mode):
    attrs = {
        **CONTAINER_ATTRS,
        "HostConfig": {**CONTAINER_ATTRS["HostConfig"], "NetworkMode": mode},
    }
    networking_config, extra = _recreate_networking(attrs, OLD_CONTAINER_ID)
    assert networking_config is None
    assert extra == []


# --- _with_anonymous_volumes_reused -----------------------------------------


def test_reuses_an_image_volume_directive_anonymous_volume_by_name():
    """(a) An image VOLUME (e.g. postgres's /var/lib/postgresql/data) only
    shows up in attrs["Mounts"] -- never in HostConfig -- so it must be
    reused by name, or the recreated container starts with a fresh, empty
    volume at that path: silent data loss."""
    attrs = {
        **CONTAINER_ATTRS,
        "Mounts": [
            *CONTAINER_ATTRS["Mounts"],
            {
                "Type": "volume",
                "Name": "a1b2c3anonvol",
                "Destination": "/var/lib/postgresql/data",
                "RW": True,
            },
        ],
    }
    host_config = _with_anonymous_volumes_reused(attrs, attrs["HostConfig"])
    assert "a1b2c3anonvol:/var/lib/postgresql/data" in host_config["Binds"]


def test_reuses_a_compose_style_hostconfig_mounts_entry_without_source():
    """(b) Compose's `volumes: [/data]` shorthand shows up in
    HostConfig.Mounts as Type=volume with an EMPTY Source. It must be
    replaced by a named Bind (so the SAME volume is reused), and the
    source-less Mounts entry dropped so Docker doesn't reject a duplicate
    mount point at the same destination."""
    attrs = {
        **CONTAINER_ATTRS,
        "Mounts": [
            *CONTAINER_ATTRS["Mounts"],
            {"Type": "volume", "Name": "compose-anon-vol", "Destination": "/data", "RW": True},
        ],
        "HostConfig": {
            **CONTAINER_ATTRS["HostConfig"],
            "Mounts": [{"Type": "volume", "Target": "/data", "Source": ""}],
        },
    }
    host_config = _with_anonymous_volumes_reused(attrs, attrs["HostConfig"])
    assert "compose-anon-vol:/data" in host_config["Binds"]
    assert all(m.get("Target") != "/data" for m in (host_config.get("Mounts") or []))


def test_does_not_duplicate_a_volume_already_in_hostconfig_binds():
    """(c) data-vol is already referenced by name in HostConfig.Binds ->
    the matching attrs["Mounts"] entry must not produce a second Bind."""
    host_config = _with_anonymous_volumes_reused(CONTAINER_ATTRS, CONTAINER_ATTRS["HostConfig"])
    assert host_config["Binds"].count("data-vol:/app/data:rw") == 1
    assert host_config["Binds"] == ["data-vol:/app/data:rw"]


def test_reused_anonymous_volume_keeps_read_only_suffix():
    """(d) A read-only anonymous volume must be reused as :ro, not
    silently become read-write."""
    attrs = {
        **CONTAINER_ATTRS,
        "Mounts": [
            *CONTAINER_ATTRS["Mounts"],
            {"Type": "volume", "Name": "ro-anon-vol", "Destination": "/ro-data", "RW": False},
        ],
    }
    host_config = _with_anonymous_volumes_reused(attrs, attrs["HostConfig"])
    assert "ro-anon-vol:/ro-data:ro" in host_config["Binds"]


# --- _recreate_container_spec -------------------------------------------------


def test_recreate_container_spec_passes_hostconfig_through_verbatim():
    kwargs, extra_networks = _recreate_container_spec(CONTAINER_ATTRS, "sha256:newimage", None)

    host_config = kwargs["host_config"]
    # Every security- and resource-relevant HostConfig field survives,
    # untouched -- this is the core of the fix.
    assert host_config["ReadonlyRootfs"] is True
    assert host_config["CapDrop"] == ["ALL"]
    assert host_config["SecurityOpt"] == ["no-new-privileges:true"]
    assert host_config["Privileged"] is False
    assert host_config["Memory"] == 134217728
    assert host_config["NanoCpus"] == 500000000
    assert host_config["PidsLimit"] == 100
    assert host_config["Ulimits"] == [{"Name": "nofile", "Soft": 1024, "Hard": 2048}]
    assert host_config["Dns"] == ["10.0.0.53"]
    assert host_config["ExtraHosts"] == ["db.internal:10.0.0.5"]
    assert host_config["GroupAdd"] == ["999"]
    assert host_config["Sysctls"] == {"net.core.somaxconn": "1024"}
    assert host_config["RestartPolicy"] == {"Name": "unless-stopped", "MaximumRetryCount": 0}
    assert host_config["Binds"] == ["data-vol:/app/data:rw"]

    assert kwargs["image"] == "sha256:newimage"
    assert kwargs["user"] == "1000:1000"
    # Hostname was auto-generated (equal to the old container's short id)
    # -> dropped so the new container gets its own.
    assert kwargs["hostname"] is None

    assert kwargs["networking_config"]["EndpointsConfig"]["stacknet"]["Aliases"] == ["db"]
    assert [n for n, _ in extra_networks] == ["sidecarnet"]


def test_recreate_container_spec_keeps_explicit_hostname():
    attrs = {**CONTAINER_ATTRS, "Config": {**CONTAINER_ATTRS["Config"], "Hostname": "custom-host"}}
    kwargs, _ = _recreate_container_spec(attrs, "sha256:newimage", None)
    assert kwargs["hostname"] == "custom-host"


# --- full pull_recreate() flow, against a faked docker-py client ------------


class _FakeImage:
    def __init__(self, id_: str, attrs: dict) -> None:
        self.id = id_
        self.attrs = attrs


class _FakeImages:
    def __init__(self) -> None:
        self.by_ref: dict[str, _FakeImage] = {}
        self.pulled: dict[str, _FakeImage] = {}

    def get(self, ref: str) -> _FakeImage:
        if ref not in self.by_ref:
            raise docker.errors.NotFound(ref)
        return self.by_ref[ref]

    def pull(self, ref: str) -> _FakeImage:
        return self.pulled[ref]


class _FakeContainer:
    def __init__(self, id_: str, attrs: dict) -> None:
        self.id = id_
        self.attrs = attrs
        self.calls: list[str] = []

    def stop(self) -> None:
        self.calls.append("stop")

    def start(self) -> None:
        self.calls.append("start")

    def rename(self, name: str) -> None:
        self.calls.append(f"rename:{name}")
        self.attrs["Name"] = f"/{name}"

    def remove(self, force: bool = False) -> None:
        self.calls.append(f"remove:{force}")


class _FakeContainers:
    """Name lookups are resolved from each container's live `Name` attr
    (updated by `rename()`), not a separate name index, so a rename is
    faithfully reflected in the next `get()` by name -- exactly the
    property `pull_recreate`'s rollback path depends on."""

    def __init__(self) -> None:
        self.by_id: dict[str, _FakeContainer] = {}

    def get(self, ident: str):
        if ident in self.by_id:
            return self.by_id[ident]
        for container in self.by_id.values():
            if container.attrs.get("Name", "").lstrip("/") == ident:
                return container
        raise docker.errors.NotFound(ident)


class _FakeAPI:
    def __init__(self, containers: _FakeContainers) -> None:
        self._containers = containers
        self.create_calls: list[dict] = []
        self.connect_calls: list[tuple] = []
        self.fail_create = False
        self.next_id = "newcontaineridabc"

    def create_container(self, name: str, **kwargs):
        self.create_calls.append({"name": name, **kwargs})
        if self.fail_create:
            raise RuntimeError("create failed")
        new_attrs = {"Id": self.next_id, "Name": f"/{name}"}
        container = _FakeContainer(self.next_id, new_attrs)
        self._containers.by_id[self.next_id] = container
        return {"Id": self.next_id}

    def connect_container_to_network(self, container, net_id, **kwargs):
        self.connect_calls.append((container, net_id, kwargs))


class _FakeDockerClient:
    def __init__(self) -> None:
        self.images = _FakeImages()
        self.containers = _FakeContainers()
        self.api = _FakeAPI(self.containers)


def _client_with(attrs: dict) -> tuple[DockerHostClient, _FakeDockerClient]:
    host = DockerHost(id="edge", label="edge", url="tcp://127.0.0.1:2375")
    client = DockerHostClient(host, Settings())
    fake = _FakeDockerClient()
    old_container = _FakeContainer(attrs["Id"], dict(attrs))
    fake.containers.by_id[attrs["Id"]] = old_container
    fake.images.by_ref["sha256:oldimage"] = _FakeImage(
        "sha256:oldimage", {"RepoDigests": ["myapp@sha256:" + "1" * 64], "Config": OLD_IMAGE_CONFIG}
    )
    fake.images.pulled["myapp:1.0"] = _FakeImage(
        "sha256:newimage", {"RepoDigests": ["myapp@sha256:" + "2" * 64]}
    )
    client._client = fake
    return client, fake


def test_pull_recreate_preserves_hostconfig_and_reconnects_networks_with_aliases():
    client, fake = _client_with(CONTAINER_ATTRS)

    result = client.pull_recreate(OLD_CONTAINER_ID)

    assert result["updated"] is True
    assert result["container_id"] == fake.api.next_id

    [create_call] = fake.api.create_calls
    assert create_call["name"] == "web"
    assert create_call["host_config"]["ReadonlyRootfs"] is True
    assert create_call["host_config"]["CapDrop"] == ["ALL"]
    assert create_call["host_config"]["SecurityOpt"] == ["no-new-privileges:true"]
    assert create_call["networking_config"]["EndpointsConfig"]["stacknet"]["Aliases"] == ["db"]
    assert create_call["networking_config"]["EndpointsConfig"]["stacknet"]["IPAMConfig"] == {
        "IPv4Address": "10.0.0.5"
    }

    # Secondary network connected afterward with its alias preserved.
    [(new_cid, net_id, kwargs)] = fake.api.connect_calls
    assert new_cid == fake.api.next_id
    assert net_id == "sidecarnet"
    assert kwargs["aliases"] == ["web-sidecar"]

    # Old container stopped, renamed to the backup name, then removed once
    # the replacement is confirmed running.
    old = fake.containers.by_id[OLD_CONTAINER_ID]
    assert "stop" in old.calls
    assert "rename:web-auzui-backup" in old.calls
    assert any(c.startswith("remove:") for c in old.calls)

    new_container = fake.containers.by_id[fake.api.next_id]
    assert "start" in new_container.calls


def test_pull_recreate_reuses_anonymous_volume_by_name():
    attrs = {
        **CONTAINER_ATTRS,
        "Mounts": [
            *CONTAINER_ATTRS["Mounts"],
            {
                "Type": "volume",
                "Name": "a1b2c3anonvol",
                "Destination": "/var/lib/postgresql/data",
                "RW": True,
            },
        ],
    }
    client, fake = _client_with(attrs)

    client.pull_recreate(OLD_CONTAINER_ID)

    [create_call] = fake.api.create_calls
    # The image-VOLUME-declared anonymous volume is reused by name, not
    # silently replaced by a fresh, empty one.
    assert "a1b2c3anonvol:/var/lib/postgresql/data" in create_call["host_config"]["Binds"]
    # The pre-existing named bind is still there too, untouched.
    assert "data-vol:/app/data:rw" in create_call["host_config"]["Binds"]


def test_pull_recreate_skips_network_mode_host():
    attrs = {
        **CONTAINER_ATTRS,
        "HostConfig": {**CONTAINER_ATTRS["HostConfig"], "NetworkMode": "host"},
    }
    client, fake = _client_with(attrs)

    client.pull_recreate(OLD_CONTAINER_ID)

    [create_call] = fake.api.create_calls
    assert create_call["networking_config"] is None
    assert create_call["host_config"]["NetworkMode"] == "host"
    assert fake.api.connect_calls == []


def test_pull_recreate_rolls_back_on_create_failure():
    client, fake = _client_with(CONTAINER_ATTRS)
    fake.api.fail_create = True

    with pytest.raises(RuntimeError, match="create failed"):
        client.pull_recreate(OLD_CONTAINER_ID)

    old = fake.containers.by_id[OLD_CONTAINER_ID]
    # stop -> rename to backup -> (create fails) -> rename back -> start
    assert old.calls == ["stop", "rename:web-auzui-backup", "rename:web", "start"]
    # The original name resolves back to the restored (old) container.
    assert fake.containers.get("web") is old


def test_pull_recreate_is_a_noop_when_digest_is_unchanged():
    attrs = dict(CONTAINER_ATTRS)
    client, fake = _client_with(attrs)
    same_digest = "myapp@sha256:" + "1" * 64
    fake.images.by_ref["sha256:oldimage"].attrs["RepoDigests"] = [same_digest]
    fake.images.pulled["myapp:1.0"].attrs["RepoDigests"] = [same_digest]

    result = client.pull_recreate(OLD_CONTAINER_ID)

    assert result == {"updated": False, "digest": same_digest, "container_id": OLD_CONTAINER_ID}
    assert fake.api.create_calls == []
