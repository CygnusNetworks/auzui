from auzui_gateway.influx import build_flux, choose_every


async def test_health(client):
    res = await client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["influx"] is True
    assert body["graylog"] is True


def test_choose_every_targets_point_budget():
    # 1 h at 60 points → 60 s windows; tiny ranges clamp to 1 s
    assert choose_every(0, 3600, 60) == 60
    assert choose_every(0, 10, 800) == 1
    # 365 d at 800 points → ~11 h windows
    assert 39_000 <= choose_every(0, 365 * 86400, 800) <= 40_000


def test_build_flux_contains_effluence_schema():
    flux = build_flux("zabbix", ["1", "2"], 0, 3600, 60, "mean")
    assert 'from(bucket: "zabbix")' in flux
    assert '_measurement == "history"' in flux
    assert '_measurement == "history_uint"' in flux
    assert 'r.itemid == "1" or r.itemid == "2"' in flux
    assert "aggregateWindow(every: 60s, fn: mean" in flux
