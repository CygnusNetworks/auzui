import json
import logging
from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import urlparse

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GraylogServer:
    """One Graylog backend the gateway can query. `token` never leaves the
    gateway; only `id`/`label` are exposed via /api/logs/servers."""

    id: str
    label: str
    url: str
    token: str


class Settings(BaseSettings):
    """Gateway configuration. Influx and Graylog are each feature-gated:
    without URL + token the corresponding endpoints report enabled=false."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

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


def _derive_label(url: str) -> str:
    """Human-readable server label from a URL host (fallback when unset)."""
    host = urlparse(url).hostname or url
    return host


@lru_cache
def get_settings() -> Settings:
    return Settings()
