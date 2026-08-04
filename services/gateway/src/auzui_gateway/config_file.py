"""Optional TOML/YAML config-file source for `Settings`.

Deployments can point `AUZUI_CONFIG_FILE` (or drop a file at one of the
default search paths below) at a single file that sets any Settings field —
not just the Docker ones. This complements env vars rather than replacing
them: `Settings.settings_customise_sources` puts this source *below* the real
environment and `.env` file, so ENV stays the override channel Compose/K8s
deployments already rely on, while a mounted config file becomes a
convenient per-environment default.

File selection (see `_resolve_config_file_path` / `_find_default_config_file`):
- `AUZUI_CONFIG_FILE` set (via real env or `.env`, real env wins) → load
  exactly that file; missing file is a hard error (`RuntimeError`). An
  explicitly requested config must never be silently skipped.
- Unset → try, in order: /config/auzui.toml, /config/auzui.yaml,
  /config/auzui.yml, ./auzui.toml, ./auzui.yaml, ./auzui.yml. None found →
  no file source, Settings falls back to env/dotenv/defaults as before.

Format is picked from the extension: `.toml` via the stdlib `tomllib`;
`.yaml`/`.yml` via PyYAML's `safe_load`, imported lazily here so the `yaml`
extra stays optional — a YAML file without the extra installed raises a
`RuntimeError` that says so.

Schema: keys may be flat (`zabbix_api_url = "..."`, matching a Settings field
name exactly) or one level nested (`[zabbix] api_url = "..."` →
`zabbix_api_url`), matching this codebase's field-name-is-already-prefixed
convention. Both are accepted in the same file; a flat key wins if it and a
nested one both resolve to the same field. Unknown keys (typos, deeper
nesting) are dropped with a `logger.warning` rather than failing startup.
Keys are matched case-insensitively.

Fields that hold JSON (`graylog_servers`, `docker_hosts`,
`docker_registries`) or CSV (`cors_origins`, `graylog_default_streams`)
strings may be given as native TOML/YAML lists/dicts instead; this module
re-serializes them to the string the field expects so the existing
`*_list` properties in config.py remain the one parser for that string.

Never log secret values from the file — only field names/counts.
"""

from __future__ import annotations

import json
import logging
import os
import tomllib
from pathlib import Path
from typing import Any

from pydantic.fields import FieldInfo
from pydantic_settings import PydanticBaseSettingsSource

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_PATHS = (
    "/config/auzui.toml",
    "/config/auzui.yaml",
    "/config/auzui.yml",
    "./auzui.toml",
    "./auzui.yaml",
    "./auzui.yml",
)

# Settings fields that are JSON-encoded lists/dicts as far as the model is
# concerned (see config.py's `*_list` properties). A config file may supply
# the native structure instead of a pre-encoded JSON string.
JSON_STRING_FIELDS = {"graylog_servers", "docker_hosts", "docker_registries"}

# Settings fields that are CSV strings; a config file may supply a list.
CSV_STRING_FIELDS = {"cors_origins", "graylog_default_streams"}


def _resolve_config_file_path() -> str:
    """AUZUI_CONFIG_FILE, real env taking precedence over `.env` — mirrors
    the env > dotenv precedence `settings_customise_sources` gives the
    resulting Settings fields, applied here one level up (to decide which
    file to even read)."""
    env_val = os.environ.get("AUZUI_CONFIG_FILE", "").strip()
    if env_val:
        return env_val
    env_file = Path(".env")
    if env_file.is_file():
        try:
            from dotenv import dotenv_values

            dotenv_val = dotenv_values(env_file).get("AUZUI_CONFIG_FILE") or ""
        except OSError:
            dotenv_val = ""
        if dotenv_val.strip():
            return dotenv_val.strip()
    return ""


def _find_default_config_file() -> Path | None:
    for candidate in DEFAULT_CONFIG_PATHS:
        path = Path(candidate)
        if path.is_file():
            return path
    return None


def _load_toml(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as fh:
            return tomllib.load(fh)
    except (tomllib.TOMLDecodeError, OSError) as exc:
        raise RuntimeError(f"failed to parse config file {path}: {exc}") from exc


def _load_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml
    except ImportError as exc:
        raise RuntimeError(
            "YAML config requires the 'yaml' extra: pip install auzui-gateway[yaml]"
        ) from exc
    try:
        with path.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
    except yaml.YAMLError as exc:
        raise RuntimeError(f"failed to parse config file {path}: {exc}") from exc
    except OSError as exc:
        raise RuntimeError(f"failed to read config file {path}: {exc}") from exc
    return data or {}


def _load_config_data(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix == ".toml":
        data = _load_toml(path)
    elif suffix in (".yaml", ".yml"):
        data = _load_yaml(path)
    else:
        raise RuntimeError(
            f"unsupported config file extension {suffix!r} for {path} "
            "(supported: .toml, .yaml, .yml)"
        )
    if not isinstance(data, dict):
        raise RuntimeError(f"config file {path} must contain a mapping at the top level")
    return data


def _serialize(field_name: str, value: Any) -> Any:
    """Match a config file's native list/dict to the str-typed field
    Settings expects (JSON_STRING_FIELDS/CSV_STRING_FIELDS above)."""
    if field_name in JSON_STRING_FIELDS and isinstance(value, list | dict):
        return json.dumps(value)
    if field_name in CSV_STRING_FIELDS and isinstance(value, list):
        return ",".join(str(v) for v in value)
    return value


class ConfigFileSource(PydanticBaseSettingsSource):
    """pydantic-settings source that loads Settings fields from an optional
    TOML/YAML file. See module docstring for file selection, schema and
    precedence rules. Instantiated once per `Settings()` construction, in
    `Settings.settings_customise_sources`."""

    def __init__(self, settings_cls: type, init_config_file: str = "") -> None:
        super().__init__(settings_cls)
        # `init_config_file` carries a `Settings(config_file=...)` keyword. It
        # has to be threaded in explicitly: which file to read must be decided
        # *before* the model exists, so this source cannot read the resulting
        # `config_file` field — without this, the constructor argument would be
        # silently ignored while only the env var worked.
        self._data = self._load(init_config_file)

    def _load(self, init_config_file: str = "") -> dict[str, Any]:
        explicit = init_config_file.strip() or _resolve_config_file_path()
        if explicit:
            path = Path(explicit)
            if not path.is_file():
                raise RuntimeError(
                    f"config file {explicit!r} does not exist "
                    "(an explicitly requested config file must be reachable)"
                )
        else:
            path = _find_default_config_file()
            if path is None:
                return {}
        raw = _load_config_data(path)
        resolved = self._resolve_fields(raw)
        logger.info("loaded config file %s (%d settings)", path, len(resolved))
        return resolved

    def _resolve_fields(self, raw: dict[str, Any]) -> dict[str, Any]:
        field_names = set(self.settings_cls.model_fields)
        nested: dict[str, Any] = {}
        flat: dict[str, Any] = {}
        for key, value in raw.items():
            lower_key = str(key).lower()
            if isinstance(value, dict):
                for subkey, subvalue in value.items():
                    joined = f"{lower_key}_{str(subkey).lower()}"
                    if joined in field_names:
                        nested[joined] = _serialize(joined, subvalue)
                    else:
                        logger.warning("config file: unknown key '%s.%s' ignored", key, subkey)
            elif lower_key in field_names:
                flat[lower_key] = _serialize(lower_key, value)
            else:
                logger.warning("config file: unknown key '%s' ignored", key)
        # Flat wins over nested when both resolve to the same field (1.3).
        return {**nested, **flat}

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        return self._data.get(field_name), field_name, False

    def __call__(self) -> dict[str, Any]:
        return dict(self._data)
