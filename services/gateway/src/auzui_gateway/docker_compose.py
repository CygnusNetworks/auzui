"""SSH-based `docker compose` operations for hosts flagged `compose=true`
(plan.md D8, Dockge-level compose support).

Security is the entire point of this module: every command that reaches the
remote shell is assembled server-side from a fixed whitelist
(`docker compose pull|up -d|restart|ps --format json`, `cat <file>`) — no
caller-supplied string is ever concatenated into a command line. The only
caller-controlled input is the *action* (validated against a literal set)
and the *project* name (used solely to look up containers in
`DockerService`, never interpolated). Working directory and compose file
paths come exclusively from the `com.docker.compose.project.working_dir`
and `com.docker.compose.project.config_files` labels docker itself attaches
to every container of a compose project — never from request parameters —
and are validated (`validate_compose_path`) before being `shlex.quote`d, so
a compromised or malicious label content still cannot break out of its
argument position."""

import asyncio
import json
import logging
import shlex
from typing import Any, Literal

from fastapi import HTTPException

from .config import DockerHost, Settings
from .docker_hosts import DockerHostClient, DockerService

logger = logging.getLogger(__name__)

ComposeAction = Literal["pull", "up", "restart"]
_ACTIONS: dict[str, tuple[str, ...]] = {
    "pull": ("pull",),
    "up": ("up", "-d"),
    "restart": ("restart",),
}

# Characters that have special meaning to a POSIX shell. A path or project
# name containing any of these is rejected outright, before shlex.quote even
# runs — belt and suspenders, per CONTRACT 2.5.
_SHELL_METACHARS = set(";|&$`<>()\n\r\"'*?[]{}~!#")

# Read-only display of a compose file must not be able to flood the gateway
# (or the response) with an arbitrarily large file.
MAX_CONFIG_FILE_BYTES = 256 * 1024

# Truncate stderr in error responses so a chatty compose failure doesn't
# blow up the HTTP response.
_MAX_ERROR_CHARS = 2000

_PROJECT_NAME_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")


def validate_compose_path(path: str) -> str:
    """Validates a path taken from a compose-project label before it is
    ever used to build a command: must be absolute, must not contain a `..`
    segment, must not contain a NUL byte, and must not contain any character
    with special meaning to a shell. Returns the path unchanged so it can be
    used inline; raises ValueError on any violation (callers turn this into
    HTTPException(400))."""
    if not path or not path.startswith("/"):
        raise ValueError(f"path must be absolute: {path!r}")
    if "\x00" in path:
        raise ValueError("path contains a NUL byte")
    if any(ch in _SHELL_METACHARS for ch in path):
        raise ValueError(f"path contains shell metacharacters: {path!r}")
    if ".." in path.split("/"):
        raise ValueError(f"path must not contain '..' segments: {path!r}")
    return path


def validate_project_name(name: str) -> str:
    """A compose project name is only ever used to look up containers inside
    the gateway (`DockerService.containers`), but if it were ever needed on
    a command line the same defense-in-depth applies: restrict to the
    character set docker itself allows for project names."""
    if not name or any(ch not in _PROJECT_NAME_CHARS for ch in name):
        raise ValueError(f"invalid compose project name: {name!r}")
    return name


def _quote_path(path: str) -> str:
    validate_compose_path(path)
    return shlex.quote(path)


def build_compose_command(working_dir: str, config_files: list[str], *args: str) -> str:
    """Builds `cd <working_dir> && docker compose -f <f1> -f <f2> ... <args>`
    with every path individually validated and quoted. `args` must already be
    literal words from the action whitelist (never caller-supplied text)."""
    parts = ["cd", _quote_path(working_dir), "&&", "docker", "compose"]
    for f in config_files:
        parts += ["-f", _quote_path(f)]
    parts += list(args)
    return " ".join(parts)


def build_cat_command(config_file: str) -> str:
    """Builds `cat <config_file>` for the read-only compose-file view."""
    return f"cat {_quote_path(config_file)}"


def parse_compose_ps(stdout: str) -> list[dict[str, Any]]:
    """Parses `docker compose ps --format json` output. Depending on the
    compose plugin version this is either a single JSON array or
    newline-delimited JSON objects (JSON Lines) — both are accepted. Blank
    output (no containers) returns an empty list."""
    text = stdout.strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        return [parsed]
    # Not a single JSON document: fall back to JSON Lines.
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            logger.warning("compose ps: skipping unparsable line: %r", line)
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def _truncate(text: str, limit: int = _MAX_ERROR_CHARS) -> str:
    return text if len(text) <= limit else text[:limit] + "... (truncated)"


class ComposeRunner:
    """Runs whitelisted `docker compose` commands over SSH on hosts flagged
    `compose=true`, per CONTRACT 2.5. `settings` is only needed to build a
    throwaway `DockerHostClient` for the exec call; if not passed explicitly
    it is taken from the `DockerService` instance (`_settings`/`_s`), so a
    single `ComposeRunner(docker_service)` keeps working regardless of which
    private attribute name that service ends up using."""

    def __init__(self, service: DockerService, settings: Settings | None = None) -> None:
        self._service = service
        self._settings = settings or self._settings_from_service(service)

    @staticmethod
    def _settings_from_service(service: DockerService) -> Settings:
        for attr in ("_settings", "_s", "settings"):
            value = getattr(service, attr, None)
            if isinstance(value, Settings):
                return value
        raise RuntimeError(
            "ComposeRunner: could not determine Settings from the given DockerService "
            "instance; pass settings explicitly: ComposeRunner(service, settings)"
        )

    def _compose_host(self, host_id: str) -> DockerHost:
        host = self._service.get_host(host_id)
        if not host.compose:
            raise HTTPException(404, f"host {host_id!r} does not support compose operations")
        return host

    async def _project_labels(self, host: DockerHost, project: str) -> tuple[str, list[str]]:
        validate_project_name(project)
        result = await self._service.containers([host.id], True)
        containers = [c for c in result.get("containers", []) if c.get("project") == project]
        if not containers:
            raise HTTPException(404, f"no containers found for compose project {project!r}")
        labels = containers[0].get("labels") or {}
        working_dir = str(labels.get("com.docker.compose.project.working_dir", ""))
        config_files_raw = str(labels.get("com.docker.compose.project.config_files", ""))
        config_files = [f for f in config_files_raw.split(",") if f]
        if not working_dir or not config_files:
            raise HTTPException(
                502, f"compose project {project!r} is missing working_dir/config_files labels"
            )
        try:
            validate_compose_path(working_dir)
            for f in config_files:
                validate_compose_path(f)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return working_dir, config_files

    async def _exec(self, host: DockerHost, command: str) -> tuple[int, str, str]:
        client = DockerHostClient(host, self._settings)
        return await asyncio.to_thread(client.exec_ssh, command)

    async def ps(self, host_id: str, project: str) -> list[dict[str, Any]]:
        """Live `docker compose ps --format json` for one stack."""
        host = self._compose_host(host_id)
        working_dir, config_files = await self._project_labels(host, project)
        command = build_compose_command(working_dir, config_files, "ps", "--format", "json")
        exit_code, stdout, stderr = await self._exec(host, command)
        if exit_code != 0:
            raise HTTPException(502, f"compose ps failed: {_truncate(stderr)}")
        return parse_compose_ps(stdout)

    async def config_file(self, host_id: str, project: str) -> str:
        """Read-only content of the stack's primary compose file, capped at
        `MAX_CONFIG_FILE_BYTES` so a huge file cannot flood the gateway."""
        host = self._compose_host(host_id)
        _working_dir, config_files = await self._project_labels(host, project)
        command = build_cat_command(config_files[0])
        exit_code, stdout, stderr = await self._exec(host, command)
        if exit_code != 0:
            raise HTTPException(502, f"reading compose file failed: {_truncate(stderr)}")
        encoded = stdout.encode("utf-8", errors="replace")
        if len(encoded) > MAX_CONFIG_FILE_BYTES:
            encoded = encoded[:MAX_CONFIG_FILE_BYTES]
        return encoded.decode("utf-8", errors="replace")

    async def act(self, host_id: str, project: str, action: str) -> dict[str, str]:
        """Runs one whitelisted compose action (`pull`, `up`, `restart`).
        Any other value is rejected with HTTPException(400) before anything
        is executed — the action never reaches a command line."""
        if action not in _ACTIONS:
            raise HTTPException(400, f"unsupported compose action: {action!r}")
        host = self._compose_host(host_id)
        working_dir, config_files = await self._project_labels(host, project)
        command = build_compose_command(working_dir, config_files, *_ACTIONS[action])
        exit_code, stdout, stderr = await self._exec(host, command)
        if exit_code != 0:
            raise HTTPException(502, f"compose {action} failed: {_truncate(stderr)}")
        return {"stdout": stdout, "stderr": stderr}
