"""Team-wide saved log filter sets (PLAN task 1).

Persistence is a single JSON file on disk. The gateway container runs
``read_only`` with tmpfs, so this file MUST live on a writable mount (a Docker
volume at /data). If the target directory is not writable the store degrades
to read-only/empty with a logged warning instead of crashing the gateway:
listing keeps working (empty or whatever is readable), while create/update/
delete raise 503.

Concurrency: every mutation reads-modifies-writes under one asyncio.Lock and
writes atomically (temp file + os.replace) so a crash mid-write never
truncates the store.
"""

import asyncio
import contextlib
import json
import logging
import os
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(tz=UTC).isoformat(timespec="seconds")


class FilterSetStore:
    def __init__(self, path: str) -> None:
        self._path = Path(path)
        self._lock = asyncio.Lock()
        self._writable = self._probe_writable()

    def _probe_writable(self) -> bool:
        """True if we can create/replace the store file. Checked once at
        startup; a read-only mount flips the store into read-only mode."""
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            return os.access(self._path.parent, os.W_OK)
        except OSError as e:
            logger.warning(
                "filter-set storage dir %s not writable (%s); sets are read-only",
                self._path.parent,
                e,
            )
            return False

    def _read_all(self) -> list[dict[str, Any]]:
        try:
            raw = self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return []
        except OSError as e:
            logger.warning("cannot read filter-set store %s: %s", self._path, e)
            return []
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            # Corrupt file → behave as an empty store rather than 500 forever.
            logger.warning("filter-set store %s is corrupt; treating as empty", self._path)
            return []
        return [s for s in data if isinstance(s, dict)] if isinstance(data, list) else []

    def _write_all(self, sets: list[dict[str, Any]]) -> None:
        if not self._writable:
            raise HTTPException(503, "filter-set storage is read-only (no writable /data mount)")
        try:
            fd, tmp = tempfile.mkstemp(dir=self._path.parent, prefix=".filter-sets-", suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    json.dump(sets, fh, ensure_ascii=False, indent=2)
                os.replace(tmp, self._path)
            except BaseException:
                # Never leave the temp file behind on failure.
                with contextlib.suppress(OSError):
                    os.unlink(tmp)
                raise
        except OSError as e:
            logger.warning("cannot write filter-set store %s: %s", self._path, e)
            raise HTTPException(503, "filter-set storage write failed") from e

    @staticmethod
    def _visible(s: dict[str, Any], username: str) -> bool:
        return s.get("owner") == username or bool(s.get("shared"))

    async def list_for(self, username: str) -> list[dict[str, Any]]:
        """The caller's own sets plus every shared set (any owner)."""
        async with self._lock:
            return [s for s in self._read_all() if self._visible(s, username)]

    async def create(
        self, username: str, name: str, shared: bool, filters: dict[str, Any]
    ) -> dict[str, Any]:
        async with self._lock:
            sets = self._read_all()
            record = {
                "id": uuid.uuid4().hex,
                "name": name,
                "owner": username,
                "shared": shared,
                "filters": filters,
                "created": _now(),
                "updated": _now(),
            }
            sets.append(record)
            self._write_all(sets)
            return record

    async def update(
        self, set_id: str, username: str, name: str, shared: bool, filters: dict[str, Any]
    ) -> dict[str, Any]:
        async with self._lock:
            sets = self._read_all()
            for s in sets:
                if s.get("id") != set_id:
                    continue
                if s.get("owner") != username:
                    raise HTTPException(403, "only the owner may edit this filter set")
                s["name"] = name
                s["shared"] = shared
                s["filters"] = filters
                s["updated"] = _now()
                self._write_all(sets)
                return s
            raise HTTPException(404, "filter set not found")

    async def delete(self, set_id: str, username: str) -> None:
        async with self._lock:
            sets = self._read_all()
            target = next((s for s in sets if s.get("id") == set_id), None)
            if target is None:
                raise HTTPException(404, "filter set not found")
            if target.get("owner") != username:
                raise HTTPException(403, "only the owner may delete this filter set")
            self._write_all([s for s in sets if s.get("id") != set_id])
