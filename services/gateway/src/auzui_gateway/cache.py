import time


class TTLCache[T]:
    """Tiny in-memory TTL cache. Single-process; good enough for permission
    and host-mapping lookups (the gateway runs as one container)."""

    def __init__(self, ttl: float, max_entries: int = 10_000) -> None:
        self._ttl = ttl
        self._max = max_entries
        self._data: dict[str, tuple[float, T]] = {}

    def get(self, key: str) -> T | None:
        entry = self._data.get(key)
        if entry is None:
            return None
        expires, value = entry
        if time.monotonic() > expires:
            del self._data[key]
            return None
        return value

    def set(self, key: str, value: T) -> None:
        if len(self._data) >= self._max:
            # Drop the oldest half; simplicity over LRU precision.
            for k in sorted(self._data, key=lambda k: self._data[k][0])[: self._max // 2]:
                del self._data[k]
        self._data[key] = (time.monotonic() + self._ttl, value)

    def clear(self) -> None:
        self._data.clear()
