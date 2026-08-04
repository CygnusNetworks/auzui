"""DOCKER_HOSTS/DOCKER_REGISTRIES parsing (config.py's docker_host_list /
docker_registry_list / docker_enabled), mirroring test coverage style for
graylog_server_list. Also covers the same hosts configured via a TOML and a
YAML config file (config_file.py), since that's the other entry point into
the same properties."""

import json

import pytest

from auzui_gateway.config import DockerHost, DockerRegistry, Settings

from .conftest import make_settings

HOSTS_JSON = json.dumps(
    [
        {"id": "prod-a", "label": "prod-a", "url": "http://sockproxy-a:2375", "readonly": True},
        {
            "id": "db-1",
            "url": "tcp://10.0.0.5:2376",
            "tls_ca": "/certs/db1/ca.pem",
            "tls_cert": "/certs/db1/cert.pem",
            "tls_key": "/certs/db1/key.pem",
        },
        {
            "id": "edge",
            "url": "ssh://deploy@edge.example.com",
            "ssh_key": "/keys/id_ed25519",
            "zabbix_host": "edge.example.com",
        },
    ]
)

REGISTRIES_JSON = json.dumps(
    [
        {"registry": "ghcr.io", "username": "bot", "token": "tok"},
        {"registry": "docker.io"},
    ]
)


def test_docker_disabled_by_default():
    settings = make_settings()
    assert settings.docker_host_list == []
    assert settings.docker_enabled is False


def test_docker_hosts_parsed():
    settings = make_settings(docker_hosts=HOSTS_JSON)
    hosts = settings.docker_host_list
    assert [h.id for h in hosts] == ["prod-a", "db-1", "edge"]
    assert settings.docker_enabled is True

    prod = hosts[0]
    assert prod == DockerHost(
        id="prod-a", label="prod-a", url="http://sockproxy-a:2375", readonly=True, compose=False
    )

    db1 = hosts[1]
    assert db1.tls_ca == "/certs/db1/ca.pem"
    assert db1.tls_cert == "/certs/db1/cert.pem"
    assert db1.tls_key == "/certs/db1/key.pem"
    assert db1.readonly is False
    # non-ssh:// URL -> compose defaults to False
    assert db1.compose is False


def test_compose_defaults_true_for_ssh_url():
    settings = make_settings(docker_hosts=HOSTS_JSON)
    edge = settings.docker_host_list[2]
    assert edge.url.startswith("ssh://")
    assert edge.compose is True
    assert edge.zabbix_host == "edge.example.com"
    assert edge.ssh_key == "/keys/id_ed25519"


def test_compose_explicit_value_wins_over_ssh_default():
    hosts = json.dumps([{"id": "a", "url": "ssh://h", "compose": False}])
    assert make_settings(docker_hosts=hosts).docker_host_list[0].compose is False

    hosts = json.dumps([{"id": "b", "url": "http://h:2375", "compose": True}])
    assert make_settings(docker_hosts=hosts).docker_host_list[0].compose is True


def test_default_label_falls_back_to_id():
    hosts = json.dumps([{"id": "noname", "url": "http://h:2375"}])
    assert make_settings(docker_hosts=hosts).docker_host_list[0].label == "noname"


def test_missing_id_generates_positional_default():
    hosts = json.dumps([{"url": "http://h:2375"}, {"url": "http://h2:2375"}])
    parsed = make_settings(docker_hosts=hosts).docker_host_list
    assert parsed[0].id == "dh-0"
    assert parsed[1].id == "dh-1"


def test_missing_url_entry_is_skipped(caplog):
    hosts = json.dumps([{"id": "no-url"}, {"id": "ok", "url": "http://h:2375"}])
    with caplog.at_level("WARNING"):
        parsed = make_settings(docker_hosts=hosts).docker_host_list
    assert [h.id for h in parsed] == ["ok"]
    assert "missing url" in caplog.text


def test_duplicate_id_second_entry_is_dropped(caplog):
    hosts = json.dumps(
        [
            {"id": "dup", "url": "http://a:2375"},
            {"id": "dup", "url": "http://b:2375"},
        ]
    )
    with caplog.at_level("WARNING"):
        parsed = make_settings(docker_hosts=hosts).docker_host_list
    assert len(parsed) == 1
    assert parsed[0].url == "http://a:2375"
    assert "duplicate id" in caplog.text


def test_invalid_json_is_ignored(caplog):
    with caplog.at_level("WARNING"):
        parsed = make_settings(docker_hosts="{not json").docker_host_list
    assert parsed == []
    assert "not valid JSON" in caplog.text


def test_non_list_json_is_ignored():
    assert make_settings(docker_hosts='{"id": "a"}').docker_host_list == []


def test_non_dict_entries_are_skipped():
    hosts = json.dumps(["not-a-dict", {"id": "ok", "url": "http://h:2375"}])
    parsed = make_settings(docker_hosts=hosts).docker_host_list
    assert [h.id for h in parsed] == ["ok"]


def test_docker_registries_parsed():
    settings = make_settings(docker_registries=REGISTRIES_JSON)
    registries = settings.docker_registry_list
    assert registries == [
        DockerRegistry(registry="ghcr.io", username="bot", token="tok"),
        DockerRegistry(registry="docker.io"),
    ]


def test_docker_registries_missing_registry_skipped(caplog):
    regs = json.dumps([{"username": "bot"}, {"registry": "ghcr.io"}])
    with caplog.at_level("WARNING"):
        parsed = make_settings(docker_registries=regs).docker_registry_list
    assert [r.registry for r in parsed] == ["ghcr.io"]
    assert "missing registry" in caplog.text


def test_docker_registries_empty_by_default():
    assert make_settings().docker_registry_list == []


def test_docker_defaults():
    settings = make_settings()
    assert settings.docker_timeout == 10.0
    assert settings.docker_cache_ttl == 10.0
    assert settings.docker_stats_cache_ttl == 5.0
    assert settings.docker_update_check_ttl == 3600.0
    assert settings.docker_ssh_known_hosts == ""


# ---- same hosts, driven through a config file instead of DOCKER_HOSTS -----


@pytest.fixture(autouse=True)
def _no_default_config_file(monkeypatch, tmp_path):
    # Prevent stray ./auzui.toml et al in the repo/cwd from leaking into
    # these tests via the default-search-path fallback.
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("AUZUI_CONFIG_FILE", raising=False)


def _expected_hosts() -> list[DockerHost]:
    return [
        DockerHost(id="prod-a", label="prod-a", url="http://sockproxy-a:2375", readonly=True),
        DockerHost(id="edge", url="ssh://deploy@edge.example.com", compose=True),
    ]


def test_docker_hosts_via_toml_file(tmp_path, monkeypatch):
    config = tmp_path / "auzui.toml"
    config.write_text(
        """
[docker]
timeout = 20.0

[[docker.hosts]]
id = "prod-a"
label = "prod-a"
url = "http://sockproxy-a:2375"
readonly = true

[[docker.hosts]]
id = "edge"
url = "ssh://deploy@edge.example.com"
"""
    )
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    settings = Settings(_env_file=None)
    hosts = settings.docker_host_list
    assert [h.id for h in hosts] == ["prod-a", "edge"]
    assert hosts[0].readonly is True
    assert hosts[1].compose is True
    assert settings.docker_timeout == 20.0
    assert settings.docker_enabled is True


def test_docker_hosts_via_yaml_file(tmp_path, monkeypatch):
    pytest.importorskip("yaml")
    config = tmp_path / "auzui.yaml"
    config.write_text(
        """
docker:
  timeout: 20.0
  hosts:
    - id: prod-a
      label: prod-a
      url: http://sockproxy-a:2375
      readonly: true
    - id: edge
      url: ssh://deploy@edge.example.com
"""
    )
    monkeypatch.setenv("AUZUI_CONFIG_FILE", str(config))
    settings = Settings(_env_file=None)
    hosts = settings.docker_host_list
    assert [h.id for h in hosts] == ["prod-a", "edge"]
    assert hosts[0].readonly is True
    assert hosts[1].compose is True
    assert settings.docker_timeout == 20.0
    assert settings.docker_enabled is True
