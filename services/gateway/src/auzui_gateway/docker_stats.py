"""Pure CPU/memory/network/block-IO normalization from raw docker-py stats
JSON (docker_hosts.py section 2.3 of the contract). No I/O here so it can be
unit-tested without a Docker daemon.

Docker's `/containers/{id}/stats` payload nests CPU counters under
`cpu_stats`/`precpu_stats`; `precpu_stats` is only valid on a *streaming*
sample (the second and later reads of the same stream) — a one-shot read's
`precpu_stats` is all zeros. When it is not valid we fall back to the
previous cached sample (`prev`, e.g. from a prior bulk-stats poll) so CPU%
is still meaningful across separate one-shot calls."""

from typing import Any


def _cpu_pct(prev: dict[str, Any] | None, cur: dict[str, Any]) -> float:
    cpu_stats = cur.get("cpu_stats") or {}
    precpu_stats = cur.get("precpu_stats") or {}

    def usage(stats: dict[str, Any]) -> int:
        return int((stats.get("cpu_usage") or {}).get("total_usage") or 0)

    def system_usage(stats: dict[str, Any]) -> int:
        return int(stats.get("system_cpu_usage") or 0)

    def online_cpus(stats: dict[str, Any]) -> int:
        n = stats.get("online_cpus")
        if n:
            return int(n)
        percpu = (stats.get("cpu_usage") or {}).get("percpu_usage")
        return len(percpu) if percpu else 1

    cpu_total = usage(cpu_stats)
    cpu_system = system_usage(cpu_stats)

    # precpu_stats is "valid" when it carries a nonzero system usage — the
    # marker docker-cli itself uses to decide whether a streaming sample's
    # previous reading is usable.
    if system_usage(precpu_stats):
        pre_total = usage(precpu_stats)
        pre_system = system_usage(precpu_stats)
    elif prev is not None:
        pre_total = usage(prev.get("cpu_stats") or {})
        pre_system = system_usage(prev.get("cpu_stats") or {})
    else:
        return 0.0

    cpu_delta = cpu_total - pre_total
    system_delta = cpu_system - pre_system
    if cpu_delta <= 0 or system_delta <= 0:
        return 0.0
    return (cpu_delta / system_delta) * online_cpus(cpu_stats) * 100.0


def _sum_network(cur: dict[str, Any]) -> tuple[int, int]:
    networks = cur.get("networks") or {}
    rx = sum(int((v or {}).get("rx_bytes") or 0) for v in networks.values())
    tx = sum(int((v or {}).get("tx_bytes") or 0) for v in networks.values())
    return rx, tx


def _sum_blkio(cur: dict[str, Any]) -> tuple[int, int]:
    entries = (cur.get("blkio_stats") or {}).get("io_service_bytes_recursive") or []
    read = 0
    write = 0
    for entry in entries or []:
        op = str((entry or {}).get("op") or "").lower()
        value = int((entry or {}).get("value") or 0)
        if op == "read":
            read += value
        elif op == "write":
            write += value
    return read, write


def calc_stats(prev: dict[str, Any] | None, cur: dict[str, Any]) -> dict[str, Any]:
    """Normalize one raw docker-py stats sample into the contract's stats
    dict: `{cpu_pct, mem_used, mem_limit, net_rx, net_tx, blk_read,
    blk_write}`. Pure and side-effect free; robust against missing keys and
    division by zero (returns 0.0/0 rather than raising)."""
    mem_stats = cur.get("memory_stats") or {}
    mem_used = int(mem_stats.get("usage") or 0)
    # Cache counters (page cache) inflate "used" for cgroup v1 hosts; docker
    # CLI subtracts them when present so the number matches `docker stats`.
    cache = int((mem_stats.get("stats") or {}).get("cache") or 0)
    mem_used = max(mem_used - cache, 0)
    mem_limit = int(mem_stats.get("limit") or 0)

    net_rx, net_tx = _sum_network(cur)
    blk_read, blk_write = _sum_blkio(cur)

    return {
        "cpu_pct": round(_cpu_pct(prev, cur), 2),
        "mem_used": mem_used,
        "mem_limit": mem_limit,
        "net_rx": net_rx,
        "net_tx": net_tx,
        "blk_read": blk_read,
        "blk_write": blk_write,
    }
