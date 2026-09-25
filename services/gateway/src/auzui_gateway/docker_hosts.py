"""Docker host connectivity and multi-host orchestration
(auzui-docker-plan.md D1/D5/D6/D8).

Mirrors graylog.py's split between a dumb per-backend client and an async
orchestration service: `DockerHostClient` is a thin SYNCHRONOUS wrapper
around one docker-py `DockerClient` for ONE host; `DockerService` is the
async layer used by docker_routes.py that fans requests out across hosts in
parallel, aggregates partial failures the same way GraylogService does,
caches, and normalizes responses to the shapes docker_routes.py/the
frontend expect.

docker-py (and paramiko, for ssh:// hosts) are OPTIONAL dependencies (extra
`docker` in pyproject.toml) and are therefore imported lazily, inside
functions rather than at module level. This keeps the gateway importable —
and every existing test green — on installs that never configured a Docker
host. Only actually reaching a host without the extra installed raises a
clear RuntimeError.
"""

import asyncio
import logging
import os
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from fastapi import HTTPException

from .cache import TTLCache
from .config import DockerHost, Settings
from .docker_stats import calc_stats

logger = logging.getLogger(__name__)

# Throttling for blocking docker-py calls run via asyncio.to_thread: a small
# per-host cap (a slow/overloaded host can't starve the others) plus a
# global cap (bounds total OS-thread fan-out for one gateway process).
PER_HOST_CONCURRENCY = 4
GLOBAL_CONCURRENCY = 16

# Cap applied per (host, resource type) in search() so a wildcard query
# against a host with thousands of containers/images can't blow up the
# response. Sized so that a real host's full inventory fits: the UI's
# image/volume/network views list everything by default (an empty q is a
# browse, not a search), and a cap they hit would silently hide rows.
SEARCH_CAP = 500

# Guards the brief window in which _build_ssh_docker_client monkeypatches
# docker.api.client.SSHHTTPAdapter; see that method for why the patch (not
# just the resulting client) needs to be built per-host.
_SSH_ADAPTER_PATCH_LOCK = threading.Lock()

_INSTALL_HINT = (
    "Docker host support requires the 'docker' extra "
    "(pip install auzui-gateway[docker] — installs docker>=7 and paramiko>=3)"
)


def _require_docker_py():
    """Import docker-py on demand. Called from inside DockerHostClient
    methods (i.e. always off the event loop, via asyncio.to_thread) so the
    import cost never blocks request handling."""
    try:
        import docker
    except ImportError as e:
        raise RuntimeError(_INSTALL_HINT) from e
    return docker


class ReadOnlyUpstreamError(RuntimeError):
    """Raised when a write reaches a host whose Docker API is fronted by a
    read-only socket proxy (e.g. tecnativa/docker-socket-proxy with
    POST=0), which answers writes with HTTP 403/405 instead of performing
    them. DockerService translates this into HTTPException(403)."""


class SSHExecTimeoutError(RuntimeError):
    """Raised by DockerHostClient.exec_ssh() when a command's wall-clock
    budget (settings.docker_ssh_exec_timeout, see exec_ssh's docstring for
    why that's separate from docker_timeout) elapses before the remote
    command exits. The channel has already been closed by the time this is
    raised. docker_compose.py turns this into HTTPException(504)."""


# -- exec_ssh tuning -----------------------------------------------------
# How often exec_ssh polls the channel for new output/exit status while
# waiting. Small enough that a fast command doesn't feel laggy, large
# enough not to busy-spin. Tests inject a much smaller value to stay fast.
SSH_EXEC_POLL_INTERVAL = 0.05

# exec_ssh retains only the last N bytes of each stream (stdout/stderr) it
# has read so far, so a runaway/verbose command (e.g. `compose pull -v` on
# many images) can't grow the gateway's memory without bound even though it
# is still fully drained off the SSH channel (which is the whole point —
# not draining it is what causes the paramiko window deadlock this guards
# against; see exec_ssh's docstring).
SSH_EXEC_MAX_CAPTURE_BYTES = 1024 * 1024  # 1 MiB per stream
_SSH_EXEC_READ_CHUNK = 32 * 1024


def _append_capped(buf: bytearray, data: bytes, cap: int) -> None:
    buf.extend(data)
    if len(buf) > cap:
        del buf[: len(buf) - cap]


class DockerHostClient:
    """Dumb synchronous wrapper around a docker-py DockerClient for ONE
    host. Every method here blocks; callers (DockerService) MUST invoke
    them via asyncio.to_thread. No caching, no fan-out, no response
    normalization happens here — that's DockerService's job, and keeping
    this class dumb is exactly what makes it fakeable in tests without
    docker-py installed (see test_docker_stats.py)."""

    def __init__(self, host: DockerHost, settings: Settings) -> None:
        self._host = host
        self._settings = settings
        self._client: Any = None  # docker.DockerClient, built lazily

    @property
    def host(self) -> DockerHost:
        return self._host

    # -- connection setup ---------------------------------------------

    def _get_client(self):
        if self._client is None:
            self._client = self._build_client()
        return self._client

    def _build_client(self):
        docker = _require_docker_py()
        host = self._host
        settings = self._settings

        if host.url.startswith("ssh://"):
            return self._build_ssh_docker_client(docker)

        tls_config = None
        if host.tls_ca or host.tls_cert or host.tls_key:
            if not (host.tls_cert and host.tls_key):
                raise RuntimeError(f"docker host {host.id!r}: mTLS needs both tls_cert and tls_key")
            tls_config = docker.tls.TLSConfig(
                client_cert=(host.tls_cert, host.tls_key),
                ca_cert=host.tls_ca or None,
                verify=True,
            )
        return docker.DockerClient(
            base_url=host.url, tls=tls_config, timeout=settings.docker_timeout, version="auto"
        )

    def _build_ssh_docker_client(self, docker):
        """docker-py's own ssh:// transport (`SSHHTTPAdapter`, used when
        use_ssh_client=False) already defaults to `paramiko.RejectPolicy`
        for unknown host keys — good — but it verifies against
        `paramiko.SSHClient.load_system_host_keys()`, i.e. the *process's*
        `~/.ssh/known_hosts`, not the known_hosts file this deployment
        mounted for us (`settings.docker_ssh_known_hosts`). Worse,
        `SSHHTTPAdapter.__init__` connects EAGERLY (paramiko `.connect()`
        runs before `docker.DockerClient(...)` even returns), so there is
        no safe point to reach in and swap the verification source
        afterwards — by then the connection attempt already happened with
        the wrong host-key store.

        So we swap docker-py's adapter class for a thin subclass — for the
        duration of this one constructor call only — that runs the exact
        same base-class logic (RejectPolicy, eager connect) but loads OUR
        known_hosts file and OUR per-host ssh_key instead of the system
        defaults. `docker.api.client.APIClient.__init__` references the
        class via a plain `from .sshconn import SSHHTTPAdapter` name bound
        in ITS OWN module namespace, so the patch target is
        `docker.api.client.SSHHTTPAdapter`, not `docker.transport.sshconn`
        (patching the latter would silently do nothing)."""
        import docker.api.client as api_client_module

        settings = self._settings
        host = self._host
        known_hosts = settings.docker_ssh_known_hosts
        if not known_hosts:
            raise RuntimeError(
                f"docker host {host.id!r} uses ssh:// but docker_ssh_known_hosts "
                "is unset; refusing to connect without host-key verification"
            )
        if not os.path.isfile(known_hosts):
            raise RuntimeError(f"docker_ssh_known_hosts file not found: {known_hosts}")

        ssh_key = host.ssh_key
        base_adapter_cls = api_client_module.SSHHTTPAdapter

        class _HardenedSSHHTTPAdapter(base_adapter_cls):
            def _create_paramiko_client(self, base_url):
                super()._create_paramiko_client(base_url)
                # Base class already loaded the SYSTEM known_hosts (a no-op
                # if none exists) and set RejectPolicy; replace which
                # known_hosts file is authoritative and which key to offer.
                self.ssh_client._system_host_keys.clear()
                self.ssh_client.load_host_keys(known_hosts)
                if ssh_key:
                    self.ssh_params["key_filename"] = ssh_key

        # Client construction happens inside asyncio.to_thread, but several
        # DIFFERENT hosts' clients can be built concurrently on different
        # worker threads; serialize the monkeypatch window so one host's
        # restore can never race another host's construction.
        with _SSH_ADAPTER_PATCH_LOCK:
            api_client_module.SSHHTTPAdapter = _HardenedSSHHTTPAdapter
            try:
                return docker.DockerClient(
                    base_url=host.url, use_ssh_client=False, timeout=settings.docker_timeout
                )
            finally:
                api_client_module.SSHHTTPAdapter = base_adapter_cls

    def _paramiko_client(self):
        """Independent, directly-verified paramiko connection used for
        exec_ssh (running one-off shell commands, e.g. `docker compose ...`
        from docker_compose.py) — kept separate from the docker-py transport
        above so exec_ssh works even against docker-py versions where
        reaching into the adapter's internals (`_harden_ssh_adapter`) fails."""
        import paramiko

        host = self._host
        settings = self._settings
        known_hosts = settings.docker_ssh_known_hosts
        if not known_hosts:
            raise RuntimeError(
                f"docker host {host.id!r} uses ssh:// but docker_ssh_known_hosts "
                "is unset; refusing to connect without host-key verification"
            )
        if not os.path.isfile(known_hosts):
            raise RuntimeError(f"docker_ssh_known_hosts file not found: {known_hosts}")

        parsed = urlparse(host.url)
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
        client.load_host_keys(known_hosts)
        client.connect(
            hostname=parsed.hostname,
            port=parsed.port or 22,
            username=parsed.username,
            key_filename=host.ssh_key or None,
            timeout=settings.docker_timeout,
        )
        return client

    # -- read operations -------------------------------------------------

    def ping(self) -> None:
        self._get_client().ping()

    def version(self) -> dict:
        return self._get_client().version()

    def info(self) -> dict:
        return self._get_client().info()

    def list_containers(self, all: bool = True) -> list[dict]:
        # sparse=True is required, not an optimization: docker-py defaults to
        # sparse=False, which issues an extra inspect per container and leaves
        # `attrs` in the INSPECT shape. That shape differs from the list shape
        # _normalize_container expects -- notably `Created` is an RFC3339
        # string there but a unix int here, so normalizing blows up with
        # ValueError: invalid literal for int(). It also turns one request
        # into N+1, which is expensive across a WireGuard tunnel.
        return [c.attrs for c in self._get_client().containers.list(all=all, sparse=True)]

    def inspect_container(self, cid: str) -> dict:
        return self._get_client().containers.get(cid).attrs

    def stats(self, cid: str, one_shot: bool = True) -> dict:
        return self._get_client().containers.get(cid).stats(stream=False, one_shot=one_shot)

    def logs(
        self,
        cid: str,
        *,
        since: float | int | None = None,
        until: float | int | None = None,
        tail: int | str | None = None,
        stdout: bool = True,
        stderr: bool = True,
    ) -> str:
        """Raw timestamped log text for one container. Each line is prefixed
        with a `1\\t`/`2\\t` stream tag; DockerService._parse_log_lines splits
        on the tag and re-sorts by the embedded RFC3339Nano timestamp.

        The two streams are fetched with one call each rather than in a single
        demultiplexed call: docker-py's `APIClient.logs()` has no `demux`
        parameter (unlike `attach`/`exec_start`), and `Container.logs(**kwargs)`
        forwards the unknown keyword straight into it, so passing it raised
        `TypeError: ContainerApiMixin.logs() got an unexpected keyword argument
        'demux'` for every container. Verified against docker-py 7.2.0, the
        pinned version. The Docker API does not interleave-merge the streams
        for us either way, so this costs one extra round trip and nothing
        else."""
        container = self._get_client().containers.get(cid)
        kwargs: dict[str, Any] = {"timestamps": True, "stream": False}
        if since is not None:
            kwargs["since"] = since
        if until is not None:
            kwargs["until"] = until
        if tail is not None:
            kwargs["tail"] = tail

        lines: list[str] = []
        for want, tag in ((stdout, "1"), (stderr, "2")):
            if not want:
                continue
            raw = container.logs(stdout=tag == "1", stderr=tag == "2", **kwargs)
            lines += [f"{tag}\t{ln}" for ln in _decode(raw).splitlines() if ln]
        return "\n".join(lines)

    def list_images(self) -> list[dict]:
        return [i.attrs for i in self._get_client().images.list()]

    def list_volumes(self) -> list[dict]:
        return [v.attrs for v in self._get_client().volumes.list()]

    def list_networks(self) -> list[dict]:
        return [n.attrs for n in self._get_client().networks.list()]

    def exec_ssh(
        self,
        command: str,
        *,
        timeout: float | None = None,
        poll_interval: float = SSH_EXEC_POLL_INTERVAL,
    ) -> tuple[int, str, str]:
        """Run one server-constructed, already-quoted command over SSH (used
        by docker_compose.py). Only valid for ssh:// hosts.

        Deliberately does NOT call `recv_exit_status()` before draining
        stdout/stderr (as a naive `client.exec_command()` + `.read()` +
        `recv_exit_status()` sequence would). Paramiko's SSH channel has a
        ~2 MiB receive window; if the remote writes more than that before
        the local side reads anything, the remote blocks on its own write
        and `recv_exit_status()` — which paramiko does not apply
        `exec_command`'s `timeout=` to; that only covers individual
        recv/send calls — waits forever, pinning the calling thread. This
        is a documented paramiko footgun, and `docker compose pull -v` on a
        multi-image stack is exactly the kind of chatty command that can
        exceed the window.

        Instead this polls the channel directly (`recv_ready` /
        `recv_stderr_ready` / `exit_status_ready`), draining both streams
        as data arrives regardless of whether the command has exited yet,
        under one overall wall-clock budget (`timeout`, defaulting to
        `settings.docker_ssh_exec_timeout` — deliberately much larger than
        `settings.docker_timeout`, since a legitimate `compose pull` can run
        for minutes; see that setting's docstring in config.py). If the
        deadline is hit before the command exits, the channel is closed and
        `SSHExecTimeoutError` is raised — docker_compose.py turns that into
        HTTPException(504). Each stream is capped to the last
        `SSH_EXEC_MAX_CAPTURE_BYTES` it produced (still fully drained off
        the wire, just not fully retained) so a runaway command can't grow
        the gateway's memory without bound.
        """
        if not self._host.url.startswith("ssh://"):
            raise RuntimeError(
                f"exec_ssh is only available for ssh:// hosts (host={self._host.id})"
            )
        if timeout is None:
            timeout = self._settings.docker_ssh_exec_timeout
        client = self._paramiko_client()
        try:
            # exec_command()'s own `timeout=` only bounds the channel's
            # individual blocking calls (connect/recv/send), not the
            # command's overall runtime -- that's `timeout` above, enforced
            # by the poll loop below. We only use the returned `stdout` to
            # reach the underlying channel; its/`stderr`'s file-like
            # .read() is never called (that's the deadlock this avoids).
            _, stdout, _stderr = client.exec_command(command, timeout=self._settings.docker_timeout)
            chan = stdout.channel
            deadline = time.monotonic() + timeout
            stdout_buf = bytearray()
            stderr_buf = bytearray()
            while True:
                drained = False
                while chan.recv_ready():
                    chunk = chan.recv(_SSH_EXEC_READ_CHUNK)
                    if not chunk:
                        break
                    _append_capped(stdout_buf, chunk, SSH_EXEC_MAX_CAPTURE_BYTES)
                    drained = True
                while chan.recv_stderr_ready():
                    chunk = chan.recv_stderr(_SSH_EXEC_READ_CHUNK)
                    if not chunk:
                        break
                    _append_capped(stderr_buf, chunk, SSH_EXEC_MAX_CAPTURE_BYTES)
                    drained = True
                if (
                    chan.exit_status_ready()
                    and not chan.recv_ready()
                    and not chan.recv_stderr_ready()
                ):
                    exit_code = chan.recv_exit_status()
                    return exit_code, _decode(bytes(stdout_buf)), _decode(bytes(stderr_buf))
                if time.monotonic() >= deadline:
                    chan.close()
                    raise SSHExecTimeoutError(
                        f"command on host {self._host.id!r} did not exit within "
                        f"{timeout:.0f}s: {command!r}"
                    )
                if not drained:
                    time.sleep(poll_interval)
        finally:
            client.close()

    # -- write operations --------------------------------------------------

    def container_action(self, cid: str, action: str) -> None:
        if action not in ("start", "stop", "restart"):
            raise ValueError(f"unsupported action: {action}")
        container = self._get_client().containers.get(cid)
        try:
            getattr(container, action)()
        except Exception as e:
            raise _translate_write_error(e) from e

    def pull_recreate(self, cid: str) -> dict:
        """Watchtower-principle update: pull the image, and if the digest
        actually changed, replace the container in place while preserving
        its FULL inspected runtime config -- not just a hand-picked subset.
        That includes security-relevant settings (Config.User,
        HostConfig.ReadonlyRootfs/CapAdd/CapDrop/SecurityOpt/Privileged),
        resource limits (Memory/NanoCpus/PidsLimit/Ulimits/...), namespace
        and mode settings (NetworkMode incl. host/container:<id>, PidMode,
        IpcMode, UsernsMode, Init, ...), and per-network endpoint details
        (Aliases -- which Compose relies on for service-name DNS --,
        static IPAMConfig addresses, Links). See `_recreate_container_spec`
        for how the inspected `Config`/`HostConfig`/`NetworkSettings` are
        turned into `client.api.create_container(...)` arguments (the
        low-level API, which accepts the inspected `HostConfig` dict
        through as-is via `host_config=`) rather than docker-py's
        high-level `containers.create(...)`, whose kwargs only cover a
        fraction of what a container can be configured with.

        Everything after the old container is stopped is wrapped so ANY
        failure rolls back to the ORIGINAL container instead of leaving
        the host with neither the old nor the new one running:

            pull -> compare RepoDigest -> build create() args from inspect
                 -> stop old -> rename old to "<name>-auzui-backup"
                 -> create + start new container under the original name
                 -> connect any additional (non-primary) networks
                 -> success: remove the backup
                 -> ANY exception after the rename: remove whatever partial
                    replacement exists, rename the backup back to the
                    original name, start it again, then re-raise.
        """
        docker = _require_docker_py()
        client = self._get_client()
        container = client.containers.get(cid)
        attrs = container.attrs
        image_ref = attrs["Config"]["Image"]

        old_image_config: dict | None = None
        try:
            old_image = client.images.get(attrs["Image"])
            old_digest = _repo_digest(old_image.attrs, image_ref)
            old_image_config = old_image.attrs.get("Config")
        except docker.errors.NotFound:
            old_digest = None

        try:
            pulled_image = client.images.pull(image_ref)
        except Exception as e:
            raise _translate_write_error(e) from e
        new_digest = _repo_digest(pulled_image.attrs, image_ref)

        if old_digest and new_digest and old_digest == new_digest:
            return {"updated": False, "digest": new_digest, "container_id": cid}

        name = attrs["Name"].lstrip("/")
        backup_name = f"{name}-auzui-backup"
        create_kwargs, extra_networks = _recreate_container_spec(
            attrs, pulled_image.id, old_image_config
        )

        try:
            container.stop()
        except Exception as e:
            raise _translate_write_error(e) from e

        try:
            container.rename(backup_name)
        except Exception as e:
            # Nothing beyond "stopped" happened yet — just try to get the
            # original container running again before reporting failure.
            try:
                container.start()
            except Exception:
                logger.exception(
                    "pull_recreate(%s): could not restart container after a failed rename", cid
                )
            raise _translate_write_error(e) from e

        try:
            created = client.api.create_container(name=name, **create_kwargs)
            new_container = client.containers.get(created["Id"])
            new_container.start()
            for net_name, endpoint in extra_networks:
                try:
                    ipam = endpoint.get("IPAMConfig") or {}
                    client.api.connect_container_to_network(
                        new_container.id,
                        net_name,
                        aliases=endpoint.get("Aliases"),
                        links=endpoint.get("Links"),
                        ipv4_address=ipam.get("IPv4Address"),
                        ipv6_address=ipam.get("IPv6Address"),
                        driver_opt=endpoint.get("DriverOpts"),
                    )
                except Exception:
                    # Best-effort: the primary network is already attached
                    # via create_kwargs["networking_config"]; a secondary
                    # network failing to attach is logged, not fatal to the
                    # update.
                    logger.warning(
                        "pull_recreate(%s): could not attach replacement to network %s",
                        cid,
                        net_name,
                    )
        except Exception as e:
            logger.warning(
                "pull_recreate(%s): create/start of replacement failed, rolling back", cid
            )
            try:
                stale = client.containers.get(name)
            except Exception:
                pass
            else:
                try:
                    stale.remove(force=True)
                except Exception:
                    logger.exception("pull_recreate(%s): could not remove failed replacement", cid)
            try:
                container.rename(name)
                container.start()
            except Exception:
                # The backup itself could not be restored — this needs a
                # human. Log loudly with the backup's name so it's easy to
                # find and recover by hand.
                logger.exception(
                    "pull_recreate(%s): ROLLBACK FAILED — %r may need manual recovery",
                    cid,
                    backup_name,
                )
            raise _translate_write_error(e) from e
        else:
            try:
                container.remove(force=True)
            except Exception:
                logger.warning("pull_recreate(%s): could not remove old container backup", cid)
            return {
                "updated": True,
                "digest": new_digest or old_digest,
                "container_id": new_container.id,
            }


def _decode(data: bytes | str | None) -> str:
    if isinstance(data, bytes):
        return data.decode("utf-8", errors="replace")
    return data or ""


def _translate_write_error(exc: Exception) -> Exception:
    """docker-py surfaces a read-only socket proxy's 403/405 as an
    APIError whose `.response` is the underlying httpx/requests Response;
    turn that into our own marker exception so DockerService can report it
    as HTTPException(403) instead of a generic 5xx."""
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status in (403, 405):
        return ReadOnlyUpstreamError("the Docker upstream is read-only (write rejected)")
    return exc


def _repo_digest(image_attrs: dict, image_ref: str) -> str | None:
    digests = image_attrs.get("RepoDigests") or []
    repo = image_ref.rsplit(":", 1)[0]
    for d in digests:
        if d.startswith(f"{repo}@"):
            return d
    return digests[0] if digests else None


def _with_anonymous_volumes_reused(attrs: dict, host_config: dict) -> dict:
    """Reuse anonymous (but still NAMED, e.g. `a1b2c3.../data`) volumes by
    name instead of letting Docker generate a fresh, empty one for the
    recreated container.

    `attrs["Mounts"]` -- the container's actual, resolved mount list --
    carries every volume mount with its generated `Name`, INCLUDING ones
    that came from an image's own `VOLUME` directive (e.g. postgres's
    `/var/lib/postgresql/data`), a bare `docker run -v /data`, or a
    Compose `volumes: [/data]` entry. None of those show up in
    `HostConfig.Binds` (which only has `src:dst` pairs for mounts given an
    explicit source), and a Compose-style one shows up in
    `HostConfig.Mounts` as `Type=volume` with an EMPTY `Source` -- so
    passing `HostConfig` through verbatim would create the new container
    with brand-new, empty volumes at those destinations: silent data loss
    on every update of e.g. a database container.

    For every `attrs["Mounts"]` entry with `Type == "volume"` and a `Name`
    whose `Destination` HostConfig doesn't already cover by name, this
    adds `"{Name}:{Destination}[:ro]"` to a COPY of `Binds` so the SAME
    volume is attached, and drops the matching source-less `Mounts` entry
    (if any) so Docker doesn't reject a duplicate mount point. Named
    volumes/binds HostConfig already references are left untouched."""
    host_config = dict(host_config)
    binds = list(host_config.get("Binds") or [])
    mounts = list(host_config.get("Mounts") or [])

    covered: set[str] = set()
    for bind in binds:
        parts = bind.split(":")
        if len(parts) >= 2 and parts[0]:
            covered.add(parts[1])
    for m in mounts:
        if m.get("Source"):
            covered.add(m.get("Target", ""))

    for m in attrs.get("Mounts") or []:
        if m.get("Type") != "volume" or not m.get("Name"):
            continue
        destination = m.get("Destination")
        if not destination or destination in covered:
            continue
        suffix = "" if m.get("RW", True) else ":ro"
        binds.append(f"{m['Name']}:{destination}{suffix}")
        mounts = [
            mm for mm in mounts if not (mm.get("Target") == destination and not mm.get("Source"))
        ]
        covered.add(destination)

    if binds:
        host_config["Binds"] = binds
    if host_config.get("Mounts") is not None:
        host_config["Mounts"] = mounts or None
    return host_config


def _recreate_container_spec(
    attrs: dict, new_image: str, old_image_config: dict | None
) -> tuple[dict[str, Any], list[tuple[str, dict[str, Any]]]]:
    """Build `client.api.create_container(...)` kwargs (docker-py's
    LOW-level API) that reproduce `attrs`' FULL inspected runtime
    configuration against the freshly pulled `new_image` -- unlike
    docker-py's high-level `containers.create(...)`, whose kwargs cover
    only a hand-picked subset of what a container can be configured with
    and silently drop everything else (the bug this function fixes).

    `HostConfig` -- which carries every security- and resource-relevant
    setting (ReadonlyRootfs, CapAdd/CapDrop, SecurityOpt, Privileged,
    memory/cpu limits, Ulimits, Devices, Dns*, NetworkMode incl.
    host/container:<id>, PidMode, IpcMode, UsernsMode, Sysctls, LogConfig,
    Binds/Mounts, RestartPolicy, ...) -- is passed through *verbatim* as
    `host_config`, aside from one addition: `_with_anonymous_volumes_reused`
    adds a named Bind for every anonymous volume in `attrs["Mounts"]` (an
    image `VOLUME`, a bare `-v /data`, or a Compose `volumes: [/data]`
    entry) that HostConfig doesn't already reference by name, so the
    recreated container reuses the SAME volume instead of Docker silently
    creating a fresh, empty one. Nothing security-relevant is stripped.

    Returns (kwargs, extra_networks) where extra_networks is
    [(network_name, endpoint_settings), ...] for every network beyond the
    primary one `create_container` attaches at creation time (via
    `networking_config`); the caller connects those afterward, preserving
    each one's Aliases/IPAMConfig/Links/DriverOpts."""
    old_container_id = attrs.get("Id", "")
    config = dict(attrs.get("Config") or {})
    config["Image"] = new_image

    # Docker defaults a container's Hostname to its own short id when none
    # was set explicitly at creation. Carrying that over verbatim would
    # make the NEW container claim the OLD container's short id as its
    # hostname instead of getting one auto-generated from its own id.
    if old_container_id and config.get("Hostname") == old_container_id[:12]:
        config["Hostname"] = None

    config = _strip_frozen_image_defaults(config, old_image_config)

    host_config = _with_anonymous_volumes_reused(attrs, attrs.get("HostConfig") or {})
    networking_config, extra_networks = _recreate_networking(attrs, old_container_id)

    kwargs: dict[str, Any] = {
        "image": config["Image"],
        "command": config.get("Cmd"),
        "hostname": config.get("Hostname"),
        "domainname": config.get("Domainname"),
        "user": config.get("User"),
        "tty": bool(config.get("Tty")),
        "stdin_open": bool(config.get("OpenStdin")),
        "ports": config.get("ExposedPorts"),
        "environment": config.get("Env"),
        "volumes": config.get("Volumes"),
        "entrypoint": config.get("Entrypoint"),
        "working_dir": config.get("WorkingDir"),
        "labels": config.get("Labels"),
        "stop_signal": config.get("StopSignal"),
        "stop_timeout": config.get("StopTimeout"),
        "healthcheck": config.get("Healthcheck"),
        "host_config": host_config,
        "networking_config": networking_config,
        "detach": True,
    }
    return kwargs, extra_networks


def _env_map(env: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for entry in env:
        result[entry.partition("=")[0]] = entry
    return result


def _strip_frozen_image_defaults(config: dict, old_image_config: dict | None) -> dict:
    """Watchtower does not "freeze" the old image's defaults into the
    recreated container: for the handful of `Config` fields that double as
    image defaults (Env/Labels/Cmd/Entrypoint/ExposedPorts/WorkingDir/User/
    Healthcheck), a container-level value IDENTICAL to what the OLD image
    already defaulted to is dropped (set to `None`), so the NEW image's own
    default applies on the next start. Anything the operator actually
    overrode -- differs from the old image's default -- is left untouched.

    Skipped entirely, keeping every value exactly as inspected, when the
    old image's Config could not be looked up (e.g. it was pruned between
    the container starting and this update) -- that's the safe fallback."""
    if old_image_config is None:
        return config
    config = dict(config)

    old_env = _env_map(old_image_config.get("Env") or [])
    kept_env = [e for e in (config.get("Env") or []) if old_env.get(e.partition("=")[0]) != e]
    config["Env"] = kept_env or None

    old_labels = old_image_config.get("Labels") or {}
    labels = config.get("Labels") or {}
    config["Labels"] = {k: v for k, v in labels.items() if old_labels.get(k) != v} or None

    for field in ("Cmd", "Entrypoint", "ExposedPorts", "WorkingDir", "User", "Healthcheck"):
        if config.get(field) == old_image_config.get(field):
            config[field] = None

    return config


def _recreate_networking(
    attrs: dict, old_container_id: str
) -> tuple[dict[str, Any] | None, list[tuple[str, dict[str, Any]]]]:
    """NetworkingConfig for `create_container(...)` (the primary network,
    attached at creation time) plus the remaining networks to connect
    afterward -- each with its Aliases/IPAMConfig/Links/DriverOpts intact,
    which is what Compose relies on for service-name DNS and what a
    container with a static IP needs to keep it.

    NetworkMode `host`/`none`/`container:<id>` means the container shares
    or has no network namespace of its own; attaching a network in that
    case is either meaningless or a Docker API error, so nothing is
    attached here -- the mode itself already lives, unmodified, in
    `HostConfig` (passed through verbatim by the caller)."""
    host_config = attrs.get("HostConfig") or {}
    network_mode = host_config.get("NetworkMode") or ""
    if network_mode in ("host", "none") or network_mode.startswith("container:"):
        return None, []

    networks: dict[str, Any] = (attrs.get("NetworkSettings") or {}).get("Networks") or {}
    if not networks:
        return None, []

    names = list(networks.keys())
    primary = network_mode if network_mode in networks else names[0]
    others = [n for n in names if n != primary]
    short_id = old_container_id[:12] if old_container_id else None

    def endpoint_settings(name: str) -> dict[str, Any]:
        ep = networks.get(name) or {}
        # Docker auto-adds the container's own short id as an alias; drop
        # the OLD container's so the new one gets its own, not a stale one.
        aliases = [a for a in (ep.get("Aliases") or []) if a not in (old_container_id, short_id)]
        settings: dict[str, Any] = {}
        if aliases:
            settings["Aliases"] = aliases
        if ep.get("Links"):
            settings["Links"] = ep["Links"]
        if ep.get("IPAMConfig"):
            settings["IPAMConfig"] = ep["IPAMConfig"]
        if ep.get("DriverOpts"):
            settings["DriverOpts"] = ep["DriverOpts"]
        if ep.get("MacAddress"):
            settings["MacAddress"] = ep["MacAddress"]
        return settings

    networking_config = {"EndpointsConfig": {primary: endpoint_settings(primary)}}
    extra_networks = [(n, endpoint_settings(n)) for n in others]
    return networking_config, extra_networks


ClientFactory = Callable[[DockerHost, Settings], DockerHostClient]


def _default_client_factory(host: DockerHost, settings: Settings) -> DockerHostClient:
    return DockerHostClient(host, settings)


def _error_message(exc: BaseException) -> str:
    if isinstance(exc, HTTPException):
        return str(exc.detail)
    text = str(exc)
    return f"{exc.__class__.__name__}: {text}" if text else exc.__class__.__name__


def _all_errored(results: list[Any]) -> bool:
    return bool(results) and all(isinstance(r, BaseException) for r in results)


def _translate_error(exc: Exception) -> Exception:
    """Uniform per-call error translation, used by DockerService._call for
    both single-target routes (raises straight to FastAPI) and fan-out
    routes (captured by asyncio.gather(return_exceptions=True) and reported
    via _error_message)."""
    if isinstance(exc, ReadOnlyUpstreamError):
        return HTTPException(403, str(exc))
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status == 404:
        return HTTPException(404, "not found on this docker host")
    if status in (403, 405):
        return HTTPException(403, "the Docker upstream is read-only (write rejected)")
    if isinstance(exc, RuntimeError):
        # Missing 'docker' extra, missing known_hosts, non-ssh exec_ssh, ...
        return HTTPException(502, str(exc))
    return exc


def _normalize_container(host_id: str, raw: dict) -> dict:
    """/containers/json summary dict -> the contract's Container-Row shape."""
    names = [n.lstrip("/") for n in (raw.get("Names") or [])]
    name = names[0] if names else raw.get("Id", "")[:12]
    image = raw.get("Image", "")
    tag = ""
    if ":" in image and "/" not in image.rsplit(":", 1)[-1]:
        image, tag = image.rsplit(":", 1)
    ports = [
        {
            "private": p.get("PrivatePort"),
            "public": p.get("PublicPort"),
            "type": p.get("Type", "tcp"),
            "ip": p.get("IP", ""),
        }
        for p in raw.get("Ports") or []
    ]
    labels = raw.get("Labels") or {}
    status = raw.get("Status", "")
    return {
        "id": raw.get("Id", ""),
        "host_id": host_id,
        "name": name,
        "names": names,
        "image": image,
        "tag": tag,
        "image_id": raw.get("ImageID", ""),
        "state": raw.get("State", ""),
        "status": status,
        "health": _health_from_status(status),
        "created": int(raw.get("Created") or 0),
        "ports": ports,
        "project": labels.get("com.docker.compose.project", ""),
        "service": labels.get("com.docker.compose.service", ""),
        "compose_working_dir": labels.get("com.docker.compose.project.working_dir", ""),
        "labels": labels,
    }


def _health_from_status(status: str) -> str | None:
    # The list endpoint doesn't return structured Health; docker's own CLI
    # appends "(healthy)"/"(unhealthy)"/"(health: starting)" to Status, so
    # that's the only signal available without a per-container inspect.
    lowered = status.lower()
    if "(healthy)" in lowered:
        return "healthy"
    if "(unhealthy)" in lowered:
        return "unhealthy"
    if "(health: starting)" in lowered:
        return "starting"
    return None


def _parse_rfc3339nano_to_ns(ts: str) -> int:
    """Parse a docker `timestamps=True` log prefix (RFC3339Nano, e.g.
    "2024-01-01T00:00:00.123456789Z") into whole nanoseconds since the
    epoch. Manual second/fraction split because datetime.fromisoformat only
    keeps microsecond precision, and cursors must be exact to the
    nanosecond to reliably mean "strictly after this line" on the next
    live-log poll."""
    ts = ts.rstrip("Z")
    whole, _, frac = ts.partition(".")
    frac = (frac + "000000000")[:9]  # pad/truncate to exactly 9 digits
    dt = datetime.strptime(whole, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=UTC)
    return int(dt.timestamp()) * 1_000_000_000 + int(frac)


def _ns_to_rfc3339nano(ns: int) -> str:
    seconds, nanos = divmod(ns, 1_000_000_000)
    dt = datetime.fromtimestamp(seconds, tz=UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + f".{nanos:09d}Z"


def _parse_log_lines(raw: str) -> tuple[list[dict[str, Any]], str | None]:
    """Turn DockerHostClient.logs()'s tagged raw text into the contract's
    log lines + opaque cursor (last timestamp + 1ns, RFC3339Nano string)."""
    lines: list[dict[str, Any]] = []
    last_ns: int | None = None
    for entry in raw.splitlines():
        if not entry:
            continue
        tag, _, rest = entry.partition("\t")
        ts_str, _, message = rest.partition(" ")
        try:
            ns = _parse_rfc3339nano_to_ns(ts_str)
        except ValueError:
            continue
        lines.append(
            {
                "ts": ns / 1_000_000_000,
                "stream": "stdout" if tag == "1" else "stderr",
                "message": message,
            }
        )
        if last_ns is None or ns > last_ns:
            last_ns = ns
    lines.sort(key=lambda ln: ln["ts"])
    cursor = _ns_to_rfc3339nano(last_ns + 1) if last_ns is not None else None
    return lines, cursor


def _searchable_text(kind: str, row: dict) -> str:
    if kind == "containers":
        return " ".join(row.get("Names") or [])
    if kind == "images":
        return " ".join(row.get("RepoTags") or [])
    if kind in ("volumes", "networks"):
        return str(row.get("Name", ""))
    return ""


# The resource kinds search() annotates with the containers using them. Docker
# has no "list images/volumes/networks with their users" call -- `docker system
# df -v` is the closest and is both expensive and shaped differently -- so the
# link is derived from the container list, which carries all three references.
_USAGE_KINDS = ("images", "volumes", "networks")


def _usage_by_kind(containers: list[dict]) -> dict[str, dict[str, list[str]]]:
    """One host's container list -> {kind: {resource key: [container name]}}.

    Reads the /containers/json (list) shape, which carries `ImageID`, `Mounts`
    and `NetworkSettings.Networks` -- see list_containers() on why that shape
    and not the inspect one.
    """
    usage: dict[str, dict[str, list[str]]] = {kind: {} for kind in _USAGE_KINDS}
    for raw in containers:
        names = [n.lstrip("/") for n in (raw.get("Names") or [])]
        name = names[0] if names else str(raw.get("Id", ""))[:12]
        # Matched on the image ID, not the tag the container reports: the same
        # image can be known under several tags, and a container started before
        # a re-tag still reports the old one.
        image_id = str(raw.get("ImageID") or "")
        if image_id:
            usage["images"].setdefault(image_id, []).append(name)
        for mount in raw.get("Mounts") or []:
            # Bind mounts carry no Name and have no row in `docker volume ls`,
            # so only named volumes can be linked back to a listed volume.
            if mount.get("Type") == "volume" and mount.get("Name"):
                usage["volumes"].setdefault(str(mount["Name"]), []).append(name)
        for network in (raw.get("NetworkSettings") or {}).get("Networks") or {}:
            usage["networks"].setdefault(str(network), []).append(name)
    return usage


def _usage_key(kind: str, row: dict) -> str:
    """The value a resource row is looked up by in _usage_by_kind()'s maps."""
    return str(row.get("Id", "")) if kind == "images" else str(row.get("Name", ""))


class DockerService:
    """Fans requests out across configured Docker hosts, running blocking
    docker-py calls in threads under per-host + global semaphores,
    normalizing responses to the contract's shapes, and aggregating
    per-host failures the same way GraylogService does — one unreachable
    host degrades to a partial result plus an `errors` entry instead of
    failing the whole request. Only when EVERY selected host fails does a
    fan-out call raise (a single HTTPException(502), like graylog.py)."""

    def __init__(self, settings: Settings, client_factory: ClientFactory | None = None) -> None:
        self._settings = settings
        self._factory: ClientFactory = client_factory or _default_client_factory
        self._hosts: dict[str, DockerHost] = {h.id: h for h in settings.docker_host_list}
        self._clients: dict[str, DockerHostClient] = {}
        self._client_locks: dict[str, asyncio.Lock] = {hid: asyncio.Lock() for hid in self._hosts}
        self._host_semaphores: dict[str, asyncio.Semaphore] = {
            hid: asyncio.Semaphore(PER_HOST_CONCURRENCY) for hid in self._hosts
        }
        self._global_semaphore = asyncio.Semaphore(GLOBAL_CONCURRENCY)

        self._container_cache: TTLCache[list[dict]] = TTLCache(settings.docker_cache_ttl)
        self._summary_cache: TTLCache[dict] = TTLCache(settings.docker_cache_ttl)
        self._stats_cache: TTLCache[dict] = TTLCache(settings.docker_stats_cache_ttl)
        # Last RAW one-shot stats sample per "host:cid", kept outside the TTL
        # cache above (which holds the NORMALIZED result and is what makes a
        # repeat poll a cache hit): calc_stats needs the previous sample's
        # raw cpu_stats to compute a CPU% delta even after the normalized
        # result has expired from _stats_cache.
        self._stats_raw_prev: dict[str, dict] = {}

    @property
    def enabled(self) -> bool:
        return bool(self._hosts)

    def host_list(self) -> list[dict]:
        """[{id,label,readonly,compose,zabbix_host}] — never exposes URLs,
        TLS material, or SSH keys."""
        return [
            {
                "id": h.id,
                "label": h.label,
                "readonly": h.readonly,
                "compose": h.compose,
                "zabbix_host": h.zabbix_host,
            }
            for h in self._hosts.values()
        ]

    def get_host(self, host_id: str) -> DockerHost:
        host = self._hosts.get(host_id)
        if host is None:
            raise HTTPException(404, f"unknown docker host: {host_id}")
        return host

    def _select(self, host_ids: list[str] | None) -> list[str]:
        if not host_ids:
            return list(self._hosts)
        selected = [h for h in host_ids if h in self._hosts]
        # Unknown ids are ignored; if the caller selected only unknown hosts,
        # fall back to all so the request still returns something meaningful
        # (mirrors GraylogService._select).
        return selected or list(self._hosts)

    async def _client_for(self, host_id: str) -> DockerHostClient:
        self.get_host(host_id)  # 404s on an unknown id before we touch locks
        client = self._clients.get(host_id)
        if client is not None:
            return client
        async with self._client_locks[host_id]:
            client = self._clients.get(host_id)
            if client is None:
                client = self._factory(self._hosts[host_id], self._settings)
                self._clients[host_id] = client
            return client

    async def _call(self, host_id: str, method: str, *args: Any, **kwargs: Any) -> Any:
        client = await self._client_for(host_id)
        bound = getattr(client, method)
        async with self._global_semaphore, self._host_semaphores[host_id]:
            try:
                return await asyncio.to_thread(bound, *args, **kwargs)
            except HTTPException:
                raise
            except Exception as e:
                raise _translate_error(e) from e

    # -- hosts / containers -----------------------------------------------

    async def hosts_summary(self) -> dict:
        host_ids = list(self._hosts)
        results = await asyncio.gather(
            *(self._summary_for_host(hid) for hid in host_ids), return_exceptions=True
        )
        hosts: list[dict] = []
        errors: list[dict] = []
        for host_id, res in zip(host_ids, results, strict=True):
            if isinstance(res, BaseException):
                logger.warning("docker host %s summary failed: %r", host_id, res)
                errors.append({"host_id": host_id, "message": _error_message(res)})
                continue
            hosts.append(res)
        if _all_errored(results):
            raise HTTPException(502, f"all docker hosts unreachable: {errors}")
        return {"hosts": hosts, "errors": errors}

    async def _summary_for_host(self, host_id: str) -> dict:
        cached = self._summary_cache.get(host_id)
        if cached is not None:
            return cached
        host = self._hosts[host_id]
        version, info = await asyncio.gather(
            self._call(host_id, "version"), self._call(host_id, "info")
        )
        summary = {
            "id": host.id,
            "label": host.label,
            "readonly": host.readonly,
            "compose": host.compose,
            "zabbix_host": host.zabbix_host,
            "engine_version": version.get("Version", ""),
            "containers_running": info.get("ContainersRunning", 0),
            "containers_stopped": info.get("ContainersStopped", 0)
            + info.get("ContainersPaused", 0),
            "images": info.get("Images", 0),
        }
        self._summary_cache.set(host_id, summary)
        return summary

    async def containers(self, host_ids: list[str] | None, all_: bool) -> dict:
        hosts = self._select(host_ids)
        results = await asyncio.gather(
            *(self._containers_for_host(hid, all_) for hid in hosts), return_exceptions=True
        )
        rows: list[dict] = []
        errors: list[dict] = []
        for host_id, res in zip(hosts, results, strict=True):
            if isinstance(res, BaseException):
                logger.warning("containers on docker host %s failed: %r", host_id, res)
                errors.append({"host_id": host_id, "message": _error_message(res)})
                continue
            rows.extend(res)
        if _all_errored(results):
            raise HTTPException(502, f"all docker hosts unreachable: {errors}")
        return {"containers": rows, "errors": errors}

    async def _containers_for_host(self, host_id: str, all_: bool) -> list[dict]:
        cache_key = f"{host_id}:{all_}"
        cached = self._container_cache.get(cache_key)
        if cached is not None:
            return cached
        raw = await self._call(host_id, "list_containers", all=all_)
        normalized = [_normalize_container(host_id, row) for row in raw]
        self._container_cache.set(cache_key, normalized)
        return normalized

    async def inspect(self, host_id: str, cid: str) -> dict:
        raw = await self._call(host_id, "inspect_container", cid)
        raw = dict(raw)
        raw["host_id"] = host_id
        return raw

    # -- stats --------------------------------------------------------------

    async def stats_one(self, host_id: str, cid: str) -> dict:
        # one_shot=False: docker-py internally takes two samples 1s apart
        # and returns a payload with a VALID precpu_stats, so a single call
        # already yields an accurate instantaneous CPU% (D5 in the plan).
        raw = await self._call(host_id, "stats", cid, one_shot=False)
        return calc_stats(None, raw)

    async def stats_bulk(self, targets: dict[str, list[str]]) -> dict:
        keys = [(host_id, cid) for host_id, cids in targets.items() for cid in cids]
        results = await asyncio.gather(
            *(self._stats_for(host_id, cid) for host_id, cid in keys), return_exceptions=True
        )
        stats: dict[str, dict[str, dict]] = {}
        errors: list[dict] = []
        for (host_id, cid), res in zip(keys, results, strict=True):
            if isinstance(res, BaseException):
                logger.warning("stats for %s/%s failed: %r", host_id, cid, res)
                errors.append({"host_id": host_id, "message": _error_message(res)})
                continue
            stats.setdefault(host_id, {})[cid] = res
        return {"stats": stats, "errors": errors}

    async def _stats_for(self, host_id: str, cid: str) -> dict:
        cache_key = f"{host_id}:{cid}"
        cached = self._stats_cache.get(cache_key)
        if cached is not None:
            return cached
        # one_shot=True here: bulk polling of many containers can't afford
        # docker-py's 1s-apart double sample per container, so precpu_stats
        # comes back invalid and calc_stats falls back to the previous raw
        # sample we stashed on the last miss.
        raw = await self._call(host_id, "stats", cid, one_shot=True)
        normalized = calc_stats(self._stats_raw_prev.get(cache_key), raw)
        self._stats_raw_prev[cache_key] = raw
        self._stats_cache.set(cache_key, normalized)
        return normalized

    # -- logs -----------------------------------------------------------

    async def logs(
        self,
        host_id: str,
        cid: str,
        *,
        since: float | int | None = None,
        until: float | int | None = None,
        tail: int | str | None = None,
        stdout: bool = True,
        stderr: bool = True,
    ) -> dict:
        raw = await self._call(
            host_id, "logs", cid, since=since, until=until, tail=tail, stdout=stdout, stderr=stderr
        )
        lines, cursor = _parse_log_lines(raw)
        return {"lines": lines, "cursor": cursor}

    # -- search -----------------------------------------------------------

    async def search(
        self,
        q: str,
        types: list[str],
        host_ids: list[str] | None,
        with_usage: bool = True,
    ) -> dict:
        """Rows of each requested kind across the selected hosts.

        Image/volume/network rows carry a `used_by` list naming the containers
        that reference them ([] = unused, i.e. a prune candidate). That costs
        one container listing per host, so callers that only need the raw rows
        (the update checker, which lists containers itself anyway) pass
        `with_usage=False`.
        """
        hosts = self._select(host_ids)
        wanted = types or ["containers", "images", "volumes", "networks"]
        method_for = {
            "containers": "list_containers",
            "images": "list_images",
            "volumes": "list_volumes",
            "networks": "list_networks",
        }
        combos = [(hid, kind) for hid in hosts for kind in wanted if kind in method_for]
        usage_hosts = list(hosts) if with_usage and any(k in _USAGE_KINDS for k in wanted) else []

        async def fetch(host_id: str, kind: str) -> list[dict]:
            if kind == "containers":
                return await self._call(host_id, method_for[kind], all=True)
            return await self._call(host_id, method_for[kind])

        # Nested gathers so the usage listings run alongside the resource
        # listings rather than adding a second round trip after them.
        outcomes, usage_outcomes = await asyncio.gather(
            asyncio.gather(*(fetch(hid, kind) for hid, kind in combos), return_exceptions=True),
            asyncio.gather(
                *(self._call(hid, "list_containers", all=True) for hid in usage_hosts),
                return_exceptions=True,
            ),
        )

        usage: dict[str, dict[str, dict[str, list[str]]]] = {}
        for host_id, outcome in zip(usage_hosts, usage_outcomes, strict=True):
            if isinstance(outcome, BaseException):
                # Usage is an annotation, not the payload: a host whose
                # container list fails still returns its images/volumes/
                # networks, just without "used by" information. It is not
                # appended to `errors` -- the rows themselves are fine, and the
                # resource listing for the same host reports the failure if it
                # is genuinely unreachable.
                logger.warning("usage lookup on docker host %s failed: %r", host_id, outcome)
                continue
            usage[host_id] = _usage_by_kind(outcome)

        needle = q.lower().strip()
        results: dict[str, list[dict]] = {kind: [] for kind in wanted}
        errors: list[dict] = []
        for (host_id, kind), outcome in zip(combos, outcomes, strict=True):
            if isinstance(outcome, BaseException):
                logger.warning("search(%s) on docker host %s failed: %r", kind, host_id, outcome)
                errors.append({"host_id": host_id, "message": _error_message(outcome)})
                continue
            matched = [
                row
                for row in outcome
                if not needle or needle in _searchable_text(kind, row).lower()
            ][:SEARCH_CAP]
            if kind == "containers":
                results[kind].extend(_normalize_container(host_id, row) for row in matched)
                continue
            by_key = usage.get(host_id, {}).get(kind, {})
            results[kind].extend(
                {
                    **row,
                    "host_id": host_id,
                    "used_by": sorted(set(by_key.get(_usage_key(kind, row), []))),
                }
                for row in matched
            )
        return {"results": results, "errors": errors}

    # -- actions --------------------------------------------------------

    async def act(self, host_id: str, cid: str, action: str) -> dict:
        if action == "pull_recreate":
            result = await self._call(host_id, "pull_recreate", cid)
        else:
            await self._call(host_id, "container_action", cid, action)
            result = {"action": action, "container_id": cid}
        self.invalidate(host_id)
        return result

    async def stacks(self, host_id: str) -> dict:
        host = self.get_host(host_id)
        result = await self.containers([host_id], True)
        groups: dict[str, dict] = {}
        for row in result["containers"]:
            project = row.get("project")
            if not project:
                continue
            groups.setdefault(project, {"project": project, "containers": []})["containers"].append(
                row
            )
        return {
            "stacks": list(groups.values()),
            "compose": host.compose,
            "errors": result["errors"],
        }

    # -- cache invalidation --------------------------------------------

    def invalidate(self, host_id: str) -> None:
        """Drop this host's container-list and hosts-summary cache entries
        (called after a write action so the next list reflects it right
        away). TTLCache doesn't expose a delete-by-key method — reaching
        into its private `_data` dict here is the intentional, documented
        exception rather than adding one just for this single caller."""
        for key in (f"{host_id}:True", f"{host_id}:False"):
            self._container_cache._data.pop(key, None)
        self._summary_cache._data.pop(host_id, None)
