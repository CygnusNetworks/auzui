import json
import logging
from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import urlparse

from pydantic import AliasChoices, Field
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)

from .config_file import ConfigFileSource

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GraylogServer:
    """One Graylog backend the gateway can query. `token` never leaves the
    gateway; only `id`/`label` are exposed via /api/logs/servers."""

    id: str
    label: str
    url: str
    token: str


@dataclass(frozen=True)
class DockerHost:
    """One Docker Engine the gateway can manage, reached via a docker-socket-
    proxy (HTTP), TCP+mTLS, or an SSH tunnel (docker-py's ssh:// transport,
    no ssh binary required in the image). `tls_*`/`ssh_key` are paths to
    read-only mounted files, never inline secrets. Compose ops
    (`docker_compose.py`) only run on `compose=True` hosts, which requires
    an ssh:// URL — Compose needs a shell on the host, the other transports
    don't have one."""

    id: str
    label: str
    url: str
    tls_ca: str = ""
    tls_cert: str = ""
    tls_key: str = ""
    ssh_key: str = ""
    readonly: bool = False
    zabbix_host: str = ""
    compose: bool = False


@dataclass(frozen=True)
class DockerRegistry:
    """Credentials for an image registry the update checker (docker_updates.py)
    authenticates against. Anonymous (Docker Hub) registries omit username/token."""

    registry: str
    username: str = ""
    token: str = ""


class Settings(BaseSettings):
    """Gateway configuration. Influx and Graylog are each feature-gated:
    without URL + token the corresponding endpoints report enabled=false."""

    # populate_by_name: the config-file source (config_file.py) sets fields
    # by their plain Python name even when a field also declares a
    # validation_alias for its env var (serve_frontend, log_dedup_enabled) —
    # without this, pydantic only accepts the alias key from ANY source.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    # Optional TOML/YAML file that can set any field below (see config_file.py
    # for search paths, schema and the env > .env > file > default precedence).
    config_file: str = Field(
        default="", validation_alias=AliasChoices("AUZUI_CONFIG_FILE", "config_file")
    )

    zabbix_api_url: str = "https://zabbix-api.example.com/api_jsonrpc.php"
    # Base URL of the Zabbix web frontend for the HTTP-auth SSO exchange
    # (index_http.php). Empty = derive from zabbix_api_url.
    zabbix_web_url: str = ""
    # User-facing Zabbix UI base URL ("open in old UI" links in the SPA).
    # May differ from zabbix_web_url when the SSO exchange goes through a
    # separate, IP-restricted vhost. Empty = derive from zabbix_api_url.
    zabbix_ui_url: str = ""

    # Build provenance, injected as Docker build args (see Dockerfile/CI).
    auzui_version: str = ""
    auzui_git_sha: str = ""

    # Kerberos SSO (SPNEGO): validate Negotiate tokens against the keytab,
    # then exchange the principal for a Zabbix session via index_http.php.
    spnego_enabled: bool = False
    krb5_ktname: str = ""

    influx_url: str = ""
    influx_token: str = ""
    influx_org: str = ""
    influx_bucket: str = "zabbix"
    # Minimum aggregateWindow size (seconds). Downsampling never uses a window
    # finer than this so every item in a multi-series query shares one window
    # grid (whole-minute boundaries by default). A finer window scatters items
    # sampled a few seconds apart onto non-coinciding timestamps, which the
    # frontend renders as a blank chart for short ranges (see choose_every).
    # Match to the smallest item poll interval you actually chart; 60s is the
    # Zabbix default item interval.
    influx_min_window_seconds: int = 60

    graylog_url: str = ""
    graylog_token: str = ""
    # Multiple Graylog servers as a JSON list, e.g.
    # [{"id":"gl-a","label":"graylog-a","url":"https://a...","token":"..."}].
    # Takes precedence over graylog_url/token; the latter stay as a
    # single-server fallback so existing deployments keep working unchanged.
    graylog_servers: str = ""
    graylog_verify_tls: bool = True
    graylog_default_streams: str = ""  # CSV of stream ids; empty = all
    graylog_source_field: str = "source"
    # Graylog API tokens authenticate as Basic token:token; some setups sit
    # behind a proxy that wants Bearer instead.
    graylog_bearer_auth: bool = False
    # Cross-server log deduplication feature flag. Off by default; only when
    # enabled does the gateway collapse duplicates AND does the frontend show
    # the "merge duplicates" toggle (exposed via GET /api/logs/servers →
    # dedup_enabled). Env: LOG_DEDUP_ENABLED.
    log_dedup_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices("LOG_DEDUP_ENABLED", "log_dedup_enabled"),
    )
    # When dedup is enabled: a host logging to several Graylog servers at once
    # produces the same line once per server with a few milliseconds of
    # arrival-time spread. Messages with identical content from DIFFERENT
    # servers within this window (seconds) collapse into one row. Keep it small
    # so genuine periodic repeats (e.g. a cron line every 60 s) survive.
    log_dedup_window_seconds: float = 2.0

    # Persistence for team-wide saved filter sets (JSON file on disk). The
    # container runs read_only, so this MUST point at a writable mount (a
    # Docker volume or tmpfs at /data). If the directory is not writable the
    # store degrades to read-only/empty with a warning instead of crashing.
    filter_sets_path: str = "/data/log-filter-sets.json"

    # Upstream timeouts (seconds)
    zabbix_timeout: float = 15.0
    influx_timeout: float = 10.0
    graylog_timeout: float = 15.0

    # Permission / mapping cache TTLs (seconds)
    permission_cache_ttl: float = 300.0
    host_mapping_cache_ttl: float = 600.0

    serve_frontend: bool = Field(
        default=False,
        validation_alias=AliasChoices("AUZUI_SERVE_FRONTEND", "SERVE_FRONTEND", "serve_frontend"),
    )
    frontend_dir: str = "/app/static"

    cors_origins: str = ""  # CSV; empty = CORS middleware disabled

    # Docker hosts/registries as JSON lists, e.g.
    # [{"id":"prod-a","url":"http://sockproxy-a:2375","readonly":true}].
    # See DockerHost/DockerRegistry above for the full schema; docker_enabled
    # (below) gates the whole feature the same way influx_enabled does.
    docker_hosts: str = ""
    docker_registries: str = ""
    docker_timeout: float = 10.0
    docker_cache_ttl: float = 10.0
    docker_stats_cache_ttl: float = 5.0
    docker_update_check_ttl: float = 3600.0
    # Path to a known_hosts file (read-only mount) used for ssh:// hosts;
    # paramiko verifies against it with RejectPolicy — never AutoAddPolicy.
    docker_ssh_known_hosts: str = ""

    @property
    def effective_zabbix_web_url(self) -> str:
        if self.zabbix_web_url:
            return self.zabbix_web_url.rstrip("/")
        return self.zabbix_api_url.rsplit("/", 1)[0].rstrip("/")

    @property
    def effective_zabbix_ui_url(self) -> str:
        if self.zabbix_ui_url:
            return self.zabbix_ui_url.rstrip("/")
        return self.zabbix_api_url.rsplit("/", 1)[0].rstrip("/")

    @property
    def influx_enabled(self) -> bool:
        return bool(self.influx_url and self.influx_token and self.influx_org)

    @property
    def graylog_server_list(self) -> list[GraylogServer]:
        """Parsed multi-server config, or a single-element list derived from
        the legacy graylog_url/token, or empty when Graylog is unconfigured."""
        if self.graylog_servers.strip():
            try:
                raw = json.loads(self.graylog_servers)
            except (ValueError, TypeError):
                logger.warning("GRAYLOG_SERVERS is not valid JSON; ignoring it")
                raw = []
            servers: list[GraylogServer] = []
            for i, entry in enumerate(raw if isinstance(raw, list) else []):
                if not isinstance(entry, dict):
                    continue
                url = str(entry.get("url", "")).strip()
                token = str(entry.get("token", "")).strip()
                if not url or not token:
                    logger.warning("GRAYLOG_SERVERS entry %d missing url/token; skipped", i)
                    continue
                sid = str(entry.get("id") or f"gl-{i}")
                label = str(entry.get("label") or _derive_label(url))
                servers.append(GraylogServer(id=sid, label=label, url=url, token=token))
            return servers
        if self.graylog_url and self.graylog_token:
            return [
                GraylogServer(
                    id="default",
                    label=_derive_label(self.graylog_url),
                    url=self.graylog_url,
                    token=self.graylog_token,
                )
            ]
        return []

    @property
    def graylog_enabled(self) -> bool:
        return bool(self.graylog_server_list)

    @property
    def default_stream_ids(self) -> list[str]:
        return [s.strip() for s in self.graylog_default_streams.split(",") if s.strip()]

    @property
    def docker_host_list(self) -> list[DockerHost]:
        """Parsed DOCKER_HOSTS, exactly following graylog_server_list's
        skip-and-warn shape: invalid entries (no url) or a repeated id are
        dropped with a logger.warning, never raised — one bad entry must not
        take down every other host."""
        if not self.docker_hosts.strip():
            return []
        try:
            raw = json.loads(self.docker_hosts)
        except (ValueError, TypeError):
            logger.warning("DOCKER_HOSTS is not valid JSON; ignoring it")
            return []
        hosts: list[DockerHost] = []
        seen_ids: set[str] = set()
        for i, entry in enumerate(raw if isinstance(raw, list) else []):
            if not isinstance(entry, dict):
                continue
            url = str(entry.get("url", "")).strip()
            if not url:
                logger.warning("DOCKER_HOSTS entry %d missing url; skipped", i)
                continue
            hid = str(entry.get("id") or f"dh-{i}")
            if hid in seen_ids:
                logger.warning("DOCKER_HOSTS entry %d has duplicate id %r; skipped", i, hid)
                continue
            seen_ids.add(hid)
            compose_default = url.startswith("ssh://")
            hosts.append(
                DockerHost(
                    id=hid,
                    label=str(entry.get("label") or hid),
                    url=url,
                    tls_ca=str(entry.get("tls_ca", "")),
                    tls_cert=str(entry.get("tls_cert", "")),
                    tls_key=str(entry.get("tls_key", "")),
                    ssh_key=str(entry.get("ssh_key", "")),
                    readonly=bool(entry.get("readonly", False)),
                    zabbix_host=str(entry.get("zabbix_host", "")),
                    compose=bool(entry.get("compose", compose_default)),
                )
            )
        return hosts

    @property
    def docker_registry_list(self) -> list[DockerRegistry]:
        """Parsed DOCKER_REGISTRIES; invalid entries (no registry) are
        skipped with a warning, same shape as docker_host_list."""
        if not self.docker_registries.strip():
            return []
        try:
            raw = json.loads(self.docker_registries)
        except (ValueError, TypeError):
            logger.warning("DOCKER_REGISTRIES is not valid JSON; ignoring it")
            return []
        registries: list[DockerRegistry] = []
        for i, entry in enumerate(raw if isinstance(raw, list) else []):
            if not isinstance(entry, dict):
                continue
            registry = str(entry.get("registry", "")).strip()
            if not registry:
                logger.warning("DOCKER_REGISTRIES entry %d missing registry; skipped", i)
                continue
            registries.append(
                DockerRegistry(
                    registry=registry,
                    username=str(entry.get("username", "")),
                    token=str(entry.get("token", "")),
                )
            )
        return registries

    @property
    def docker_enabled(self) -> bool:
        return bool(self.docker_host_list)

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # ENV > .env > config file > field default (see config_file.py's
        # module docstring for the reasoning): the config file is the lowest-
        # precedence override above the hardcoded defaults, so ENV/`.env`
        # (Compose, Kubernetes) keep working unchanged and a mounted config
        # file can still be overridden per-environment.
        # A `Settings(config_file=...)` keyword has to be handed to the source
        # by hand: it decides which file to read before the model (and thus the
        # resolved `config_file` field) exists. pydantic-settings normalises
        # init kwargs onto the field's *alias*, so look under both names —
        # keying only on "config_file" silently ignores the argument.
        init_kwargs = getattr(init_settings, "init_kwargs", {}) or {}
        init_config_file = str(
            init_kwargs.get("config_file") or init_kwargs.get("AUZUI_CONFIG_FILE") or ""
        )
        return (
            init_settings,
            env_settings,
            dotenv_settings,
            ConfigFileSource(settings_cls, init_config_file),
            file_secret_settings,
        )


def _derive_label(url: str) -> str:
    """Human-readable server label from a URL host (fallback when unset)."""
    host = urlparse(url).hostname or url
    return host


@lru_cache
def get_settings() -> Settings:
    return Settings()
