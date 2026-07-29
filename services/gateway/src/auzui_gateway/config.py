from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    graylog_url: str = ""
    graylog_token: str = ""
    graylog_verify_tls: bool = True
    graylog_default_streams: str = ""  # CSV of stream ids; empty = all
    graylog_source_field: str = "source"
    # Graylog API tokens authenticate as Basic token:token; some setups sit
    # behind a proxy that wants Bearer instead.
    graylog_bearer_auth: bool = False

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
    def graylog_enabled(self) -> bool:
        return bool(self.graylog_url and self.graylog_token)

    @property
    def default_stream_ids(self) -> list[str]:
        return [s.strip() for s in self.graylog_default_streams.split(",") if s.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
