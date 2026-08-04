"""ConfigFileSource (config_file.py): TOML/YAML config-file layer that can
set any Settings field, at env > .env > config-file > default precedence
(Settings.settings_customise_sources in config.py)."""

import json
from pathlib import Path

import pytest

from auzui_gateway.config import Settings
from auzui_gateway.config_file import DEFAULT_CONFIG_PATHS


@pytest.fixture(autouse=True)
def _isolated_cwd(tmp_path, monkeypatch):
    # Every test gets a clean cwd so the default-search-path fallback never
    # picks up a stray file from the repo checkout, and AUZUI_CONFIG_FILE
    # never leaks from the outer shell.
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("AUZUI_CONFIG_FILE", raising=False)


def test_toml_file_sets_flat_and_nested_fields(tmp_path, monkeypatch):
    config = tmp_path / "auzui.toml"
    config.write_text(
        """
permission_cache_ttl = 111

[zabbix]
api_url = "https://zbx.example/api_jsonrpc.php"
ui_url = "https://zbx.example"

[influx]
url = "http://influx:8086"
token = "influx-tok"
org = "monitoring"
"""
    )
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    settings = Settings(_env_file=None)

    assert settings.permission_cache_ttl == 111
    assert settings.zabbix_api_url == "https://zbx.example/api_jsonrpc.php"
    assert settings.zabbix_ui_url == "https://zbx.example"
    assert settings.influx_url == "http://influx:8086"
    assert settings.influx_token == "influx-tok"
    assert settings.influx_org == "monitoring"


def test_yaml_file_sets_flat_and_nested_fields(tmp_path, monkeypatch):
    pytest.importorskip("yaml")
    config = tmp_path / "auzui.yaml"
    config.write_text(
        """
permission_cache_ttl: 111
zabbix:
  api_url: https://zbx.example/api_jsonrpc.php
  ui_url: https://zbx.example
influx:
  url: http://influx:8086
  token: influx-tok
  org: monitoring
"""
    )
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    settings = Settings(_env_file=None)

    assert settings.permission_cache_ttl == 111
    assert settings.zabbix_api_url == "https://zbx.example/api_jsonrpc.php"
    assert settings.zabbix_ui_url == "https://zbx.example"
    assert settings.influx_url == "http://influx:8086"
    assert settings.influx_token == "influx-tok"
    assert settings.influx_org == "monitoring"


def test_env_wins_over_config_file(tmp_path, monkeypatch):
    config = tmp_path / "auzui.toml"
    config.write_text('zabbix_api_url = "https://from-file/api_jsonrpc.php"\n')
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    monkeypatch.setenv("ZABBIX_API_URL", "https://from-env/api_jsonrpc.php")

    settings = Settings(_env_file=None)
    assert settings.zabbix_api_url == "https://from-env/api_jsonrpc.php"


def test_dotenv_wins_over_config_file(tmp_path, monkeypatch):
    config = tmp_path / "auzui.toml"
    config.write_text('zabbix_api_url = "https://from-file/api_jsonrpc.php"\n')
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    (tmp_path / ".env").write_text("ZABBIX_API_URL=https://from-dotenv/api_jsonrpc.php\n")

    settings = Settings()  # default env_file=".env" resolved relative to cwd
    assert settings.zabbix_api_url == "https://from-dotenv/api_jsonrpc.php"


def test_flat_key_wins_over_nested_for_same_field(tmp_path, monkeypatch):
    config = tmp_path / "auzui.toml"
    config.write_text(
        """
zabbix_api_url = "https://flat/api_jsonrpc.php"

[zabbix]
api_url = "https://nested/api_jsonrpc.php"
"""
    )
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    settings = Settings(_env_file=None)
    assert settings.zabbix_api_url == "https://flat/api_jsonrpc.php"


def test_unknown_key_is_dropped_and_logged(tmp_path, monkeypatch, caplog):
    config = tmp_path / "auzui.toml"
    config.write_text(
        """
totally_unknown_field = "x"

[zabbix]
not_a_real_subfield = "y"
"""
    )
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    with caplog.at_level("WARNING"):
        settings = Settings(_env_file=None)
    assert not hasattr(settings, "totally_unknown_field")
    assert "totally_unknown_field" in caplog.text
    assert "zabbix.not_a_real_subfield" in caplog.text


def test_broken_toml_raises_runtime_error(tmp_path, monkeypatch):
    config = tmp_path / "auzui.toml"
    config.write_text("this is not [valid toml")
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    with pytest.raises(RuntimeError, match="failed to parse config file"):
        Settings(_env_file=None)


def test_broken_yaml_raises_runtime_error(tmp_path, monkeypatch):
    pytest.importorskip("yaml")
    config = tmp_path / "auzui.yaml"
    config.write_text("key: [unclosed\n")
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    with pytest.raises(RuntimeError, match="failed to parse config file"):
        Settings(_env_file=None)


def test_unsupported_extension_raises_runtime_error(tmp_path, monkeypatch):
    config = tmp_path / "auzui.ini"
    config.write_text("zabbix_api_url = x\n")
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    with pytest.raises(RuntimeError, match="unsupported config file extension"):
        Settings(_env_file=None)


def test_explicit_missing_file_raises_runtime_error(tmp_path, monkeypatch):
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(tmp_path / "does-not-exist.toml"))
    with pytest.raises(RuntimeError, match="does not exist"):
        Settings(_env_file=None)


def test_no_config_file_is_not_an_error(monkeypatch):
    # No AUZUI_CONFIG_FILE, no default-search-path file in the (isolated) cwd.
    settings = Settings(_env_file=None)
    assert settings.zabbix_api_url == "https://zabbix-api.example.com/api_jsonrpc.php"


def test_default_search_path_is_found(tmp_path, monkeypatch):
    # First default path that resolves relative to cwd: ./auzui.toml.
    assert "./auzui.toml" in DEFAULT_CONFIG_PATHS
    (tmp_path / "auzui.toml").write_text('zabbix_api_url = "https://from-default-path/x"\n')
    settings = Settings(_env_file=None)
    assert settings.zabbix_api_url == "https://from-default-path/x"


def test_list_serializes_to_json_string_for_graylog_servers(tmp_path, monkeypatch):
    config = tmp_path / "auzui.toml"
    config.write_text(
        """
[graylog]
verify_tls = true
[[graylog.servers]]
id = "gl-a"
url = "https://graylog-a.example.com"
token = "tok-a"
"""
    )
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    settings = Settings(_env_file=None)

    assert isinstance(settings.graylog_servers, str)
    parsed = json.loads(settings.graylog_servers)
    assert parsed == [{"id": "gl-a", "url": "https://graylog-a.example.com", "token": "tok-a"}]
    assert settings.graylog_verify_tls is True
    servers = settings.graylog_server_list
    assert len(servers) == 1
    assert servers[0].id == "gl-a"


def test_list_serializes_to_json_string_for_docker_hosts(tmp_path, monkeypatch):
    config = tmp_path / "auzui.toml"
    config.write_text(
        """
[[docker.hosts]]
id = "prod-a"
url = "http://sockproxy-a:2375"
readonly = true
"""
    )
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    settings = Settings(_env_file=None)

    assert isinstance(settings.docker_hosts, str)
    parsed = json.loads(settings.docker_hosts)
    assert parsed == [{"id": "prod-a", "url": "http://sockproxy-a:2375", "readonly": True}]
    hosts = settings.docker_host_list
    assert len(hosts) == 1
    assert hosts[0].id == "prod-a"
    assert hosts[0].readonly is True


def test_list_joins_to_csv_for_cors_origins(tmp_path, monkeypatch):
    config = tmp_path / "auzui.toml"
    config.write_text('cors_origins = ["https://a.example", "https://b.example"]\n')
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    settings = Settings(_env_file=None)
    assert settings.cors_origins == "https://a.example,https://b.example"


def test_validation_alias_fields_settable_from_file(tmp_path, monkeypatch):
    # serve_frontend and log_dedup_enabled both declare a validation_alias
    # for their env var name; the config file must be able to set them by
    # their plain field name regardless (populate_by_name=True in config.py).
    config = tmp_path / "auzui.toml"
    config.write_text(
        """
serve_frontend = true
log_dedup_enabled = true
"""
    )
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    settings = Settings(_env_file=None)
    assert settings.serve_frontend is True
    assert settings.log_dedup_enabled is True


def test_case_insensitive_keys(tmp_path, monkeypatch):
    config = tmp_path / "auzui.toml"
    config.write_text('ZABBIX_API_URL = "https://upper.example/x"\n')
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    settings = Settings(_env_file=None)
    assert settings.zabbix_api_url == "https://upper.example/x"


def test_config_file_settable_via_constructor(tmp_path, monkeypatch):
    # Settings(config_file=...) must load the file just like the env var does.
    # pydantic-settings normalises init kwargs onto the field's alias, so
    # settings_customise_sources has to look under both names — keying only on
    # the field name made the constructor argument a silent no-op.
    monkeypatch.delenv("AUZUI_CONFIG_FILE", raising=False)
    config = tmp_path / "auzui.toml"
    config.write_text('[zabbix]\napi_url = "https://from-ctor.example/api_jsonrpc.php"\n')
    settings = Settings(config_file=str(config), _env_file=None)
    assert settings.zabbix_api_url == "https://from-ctor.example/api_jsonrpc.php"


def test_env_wins_over_constructor_config_file(tmp_path, monkeypatch):
    config = tmp_path / "auzui.toml"
    config.write_text('[zabbix]\napi_url = "https://from-file.example/api_jsonrpc.php"\n')
    monkeypatch.setenv("ZABBIX_API_URL", "https://from-env.example/api_jsonrpc.php")
    settings = Settings(config_file=str(config), _env_file=None)
    assert settings.zabbix_api_url == "https://from-env.example/api_jsonrpc.php"


def test_shipped_examples_load_identically(monkeypatch):
    # The two files in examples/ document the same configuration in both
    # formats; if they drift apart the docs lie. Also proves the shipped
    # examples actually parse against the current Settings model.
    monkeypatch.delenv("AUZUI_CONFIG_FILE", raising=False)
    root = Path(__file__).resolve().parents[3]
    toml_settings = Settings(config_file=str(root / "examples/auzui.toml"), _env_file=None)
    yaml_settings = Settings(config_file=str(root / "examples/auzui.yaml"), _env_file=None)
    # `config_file` itself necessarily differs — it holds the path we loaded.
    assert toml_settings.model_dump(exclude={"config_file"}) == yaml_settings.model_dump(
        exclude={"config_file"}
    )
    assert toml_settings.docker_enabled
    assert [h.id for h in toml_settings.docker_host_list] == ["prod-a", "db-1", "edge"]
