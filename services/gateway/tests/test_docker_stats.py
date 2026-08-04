"""calc_stats (pure, no I/O) against real docker-stats JSON shapes, and
DockerService.stats_bulk's caching behavior against a fake client (no
docker-py involved anywhere in this file)."""

from __future__ import annotations

import pytest

from auzui_gateway.config import DockerHost, Settings
from auzui_gateway.docker_hosts import DockerService
from auzui_gateway.docker_stats import calc_stats


def _one_shot_sample(
    cpu_total: int, mem_usage: int = 1_000_000, mem_limit: int = 2_000_000
) -> dict:
    """A one-shot (`docker stats --no-stream`) sample: precpu_stats carries
    no system_cpu_usage, so it's unusable for a CPU% delta on its own."""
    return {
        "cpu_stats": {
            "cpu_usage": {"total_usage": cpu_total, "percpu_usage": [cpu_total]},
            "system_cpu_usage": cpu_total * 10,
            "online_cpus": 2,
        },
        "precpu_stats": {"cpu_usage": {"total_usage": 0}, "system_cpu_usage": 0},
        "memory_stats": {"usage": mem_usage, "limit": mem_limit, "stats": {"cache": 0}},
        "networks": {"eth0": {"rx_bytes": 100, "tx_bytes": 200}},
        "blkio_stats": {
            "io_service_bytes_recursive": [
                {"op": "read", "value": 300},
                {"op": "write", "value": 400},
            ]
        },
    }


def _streaming_sample(cpu_total: int, precpu_total: int) -> dict:
    """A streaming (`docker stats`) sample: docker itself took two readings
    1s apart, so precpu_stats is already a valid, usable prior sample."""
    return {
        "cpu_stats": {
            "cpu_usage": {"total_usage": cpu_total, "percpu_usage": [cpu_total, cpu_total]},
            "system_cpu_usage": cpu_total * 10,
            "online_cpus": 2,
        },
        "precpu_stats": {
            "cpu_usage": {"total_usage": precpu_total},
            "system_cpu_usage": precpu_total * 10,
        },
        "memory_stats": {"usage": 500_000, "limit": 1_000_000, "stats": {"cache": 100_000}},
        "networks": {},
        "blkio_stats": {},
    }


class TestCalcStats:
    def test_one_shot_without_prev_yields_zero_cpu_pct(self):
        cur = _one_shot_sample(cpu_total=1000)
        result = calc_stats(None, cur)
        assert result["cpu_pct"] == 0.0
        assert result["mem_used"] == 1_000_000
        assert result["mem_limit"] == 2_000_000
        assert result["net_rx"] == 100
        assert result["net_tx"] == 200
        assert result["blk_read"] == 300
        assert result["blk_write"] == 400

    def test_one_shot_with_prev_computes_delta_from_prev_sample(self):
        prev = _one_shot_sample(cpu_total=1000)
        cur = _one_shot_sample(cpu_total=3000)
        result = calc_stats(prev, cur)
        # cpu_delta = 2000, system_delta = (30000-10000)=20000, online_cpus=2
        assert result["cpu_pct"] == pytest.approx(20.0)

    def test_streaming_sample_uses_valid_precpu_ignoring_prev(self):
        cur = _streaming_sample(cpu_total=5000, precpu_total=1000)
        # prev is deliberately a decoy with different numbers — a valid
        # precpu_stats on `cur` itself must win.
        decoy_prev = _one_shot_sample(cpu_total=999_999)
        result = calc_stats(decoy_prev, cur)
        # cpu_delta=4000, system_delta=(50000-10000)=40000, online_cpus=2
        assert result["cpu_pct"] == pytest.approx(20.0)
        # cache bytes are subtracted from the raw usage figure
        assert result["mem_used"] == 400_000
        assert result["mem_limit"] == 1_000_000

    def test_missing_networks_and_blkio_keys_default_to_zero(self):
        cur = {
            "cpu_stats": {"cpu_usage": {"total_usage": 0}, "system_cpu_usage": 0},
            "precpu_stats": {},
            "memory_stats": {"usage": 42, "limit": 100},
        }
        result = calc_stats(None, cur)
        assert result == {
            "cpu_pct": 0.0,
            "mem_used": 42,
            "mem_limit": 100,
            "net_rx": 0,
            "net_tx": 0,
            "blk_read": 0,
            "blk_write": 0,
        }

    def test_mem_limit_zero_does_not_raise(self):
        cur = {
            "cpu_stats": {},
            "precpu_stats": {},
            "memory_stats": {"usage": 0, "limit": 0},
        }
        result = calc_stats(None, cur)
        assert result["mem_limit"] == 0
        assert result["cpu_pct"] == 0.0

    def test_zero_or_negative_deltas_never_raise_or_go_negative(self):
        # system_cpu_usage went backwards (containers can be moved between
        # cgroups, clocks can be weird) — must clamp to 0.0, never raise.
        prev = _one_shot_sample(cpu_total=5000)
        cur = _one_shot_sample(cpu_total=1000)
        result = calc_stats(prev, cur)
        assert result["cpu_pct"] == 0.0


class _FakeDockerHostClient:
    """Stands in for DockerHostClient; records call counts so the test can
    assert the bulk-stats cache actually prevents redundant client calls."""

    def __init__(self, host, settings):
        self.host = host
        self.settings = settings
        self.calls = 0
        self._cpu_values = iter([1000, 3000, 3000, 9000])

    def stats(self, cid: str, one_shot: bool = True) -> dict:
        self.calls += 1
        return _one_shot_sample(cpu_total=next(self._cpu_values))


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        docker_hosts='[{"id":"h1","label":"host-1","url":"http://sockproxy:2375"}]',
        docker_stats_cache_ttl=0.05,
    )


class TestStatsBulkCache:
    async def test_second_call_within_ttl_hits_cache_then_expires(self, settings):
        fakes: dict[str, _FakeDockerHostClient] = {}

        def factory(host: DockerHost, s: Settings) -> _FakeDockerHostClient:
            client = _FakeDockerHostClient(host, s)
            fakes[host.id] = client
            return client

        service = DockerService(settings, client_factory=factory)

        first = await service.stats_bulk({"h1": ["c1"]})
        assert first["errors"] == []
        assert first["stats"]["h1"]["c1"]["cpu_pct"] == 0.0  # no prev sample yet
        assert fakes["h1"].calls == 1

        # Second call inside the TTL window must be served from the cache —
        # no additional call to the fake client.
        second = await service.stats_bulk({"h1": ["c1"]})
        assert second == first
        assert fakes["h1"].calls == 1

        # Let the (very short) TTL expire, then call again: this must reach
        # the fake client again and compute a fresh CPU delta.
        import asyncio

        await asyncio.sleep(0.1)
        third = await service.stats_bulk({"h1": ["c1"]})
        assert fakes["h1"].calls == 2
        assert third["stats"]["h1"]["c1"]["cpu_pct"] == pytest.approx(20.0)
