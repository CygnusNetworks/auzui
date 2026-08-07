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

    def exec_ssh(self, command: str) -> tuple[int, str, str]:
        """Run one server-constructed, already-quoted command over SSH (used
        by docker_compose.py). Only valid for ssh:// hosts."""
        if not self._host.url.startswith("ssh://"):
            raise RuntimeError(
                f"exec_ssh is only available for ssh:// hosts (host={self._host.id})"
            )
        client = self._paramiko_client()
        try:
            _, stdout, stderr = client.exec_command(command, timeout=self._settings.docker_timeout)
            exit_code = stdout.channel.recv_exit_status()
            return exit_code, _decode(stdout.read()), _decode(stderr.read())
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
        its full runtime config (ports, mounts, env, labels, restart
        policy, networks). Everything after the old container is stopped
        is wrapped so ANY failure rolls back to the ORIGINAL container
        instead of leaving the host with neither the old nor the new one
        running:

            pull -> compare RepoDigest -> clone create-kwargs from inspect
                 -> stop old -> rename old to "<name>-auzui-backup"
                 -> create + start new container under the original name
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

        try:
            old_image = client.images.get(attrs["Image"])
            old_digest = _repo_digest(old_image.attrs, image_ref)
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
        create_kwargs, extra_networks = _clone_create_kwargs(attrs, pulled_image.id)

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
            new_container = client.containers.create(name=name, **create_kwargs)
            new_container.start()
            for net_name in extra_networks:
                try:
                    client.networks.get(net_name).connect(new_container)
                except Exception:
                    # Best-effort: the primary network is already attached
                    # via create_kwargs["network"]; a secondary network
                    # failing to attach is logged, not fatal to the update.
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


def _clone_create_kwargs(attrs: dict, image: str) -> tuple[dict[str, Any], list[str]]:
    """Build `containers.create(...)` kwargs that reproduce `attrs`'
    runtime configuration (ports/mounts/env/labels/restart-policy/hostname/
    working-dir) against the freshly pulled `image`. Returns
    (kwargs, extra_network_names) — docker-py's `create()` only attaches
    one network up front; any additional networks the original container
    was on are connected afterward by the caller."""
    config = attrs.get("Config") or {}
    host_config = attrs.get("HostConfig") or {}
    network_settings = attrs.get("NetworkSettings") or {}

    ports: dict[str, Any] = {}
    for container_port, bindings in (host_config.get("PortBindings") or {}).items():
        if not bindings:
            ports[container_port] = None
            continue
        ports[container_port] = [
            {"HostIp": b.get("HostIp", ""), "HostPort": b.get("HostPort", "")} for b in bindings
        ]

    volumes: list[str] = []
    for m in attrs.get("Mounts") or []:
        suffix = "" if m.get("RW", True) else ":ro"
        source = m.get("Name") if m.get("Type") == "volume" else m.get("Source")
        if source and m.get("Destination"):
            volumes.append(f"{source}:{m['Destination']}{suffix}")

    restart_policy = host_config.get("RestartPolicy") or {}
    networks = list((network_settings.get("Networks") or {}).keys())

    kwargs: dict[str, Any] = {
        "image": image,
        "command": config.get("Cmd"),
        "entrypoint": config.get("Entrypoint"),
        "environment": config.get("Env") or [],
        "labels": config.get("Labels") or {},
        "ports": ports,
        "volumes": volumes,
        "restart_policy": {
            "Name": restart_policy.get("Name", ""),
            "MaximumRetryCount": restart_policy.get("MaximumRetryCount", 0),
        },
        "hostname": config.get("Hostname") or None,
        "working_dir": config.get("WorkingDir") or None,
        "detach": True,
    }
    if networks:
        kwargs["network"] = networks[0]
    return kwargs, networks[1:]


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

    async def search(self, q: str, types: list[str], host_ids: list[str] | None) -> dict:
        hosts = self._select(host_ids)
        wanted = types or ["containers", "images", "volumes", "networks"]
        method_for = {
            "containers": "list_containers",
            "images": "list_images",
            "volumes": "list_volumes",
            "networks": "list_networks",
        }
        combos = [(hid, kind) for hid in hosts for kind in wanted if kind in method_for]

        async def fetch(host_id: str, kind: str) -> list[dict]:
            if kind == "containers":
                return await self._call(host_id, method_for[kind], all=True)
            return await self._call(host_id, method_for[kind])

        outcomes = await asyncio.gather(
            *(fetch(hid, kind) for hid, kind in combos), return_exceptions=True
        )

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
            else:
                results[kind].extend({**row, "host_id": host_id} for row in matched)
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
