#!/usr/bin/env python3
"""Copy effluence history (InfluxDB 2) into Zabbix-8.0 ClickHouse tables.

Read-only on the InfluxDB side. Every Flux query is bounded twice — by an
itemid filter (batch) and by a time window of at most one day — because an
unfiltered range scan over the zabbix bucket can take InfluxDB down.
Queries run strictly sequentially.

    python3 dev/clickhouse/influx_import.py --items items.txt --days 30

items.txt: one Zabbix itemid per line. Influx connection from the env vars
INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG, INFLUXDB_BUCKET; ClickHouse from
--ch-url/--ch-user/--ch-password (defaults: local dev container).
"""

import argparse
import base64
import csv
import io
import os
import sys
import time
import urllib.parse
import urllib.request

DAY = 86_400


def flux(bucket: str, itemids: list[str], start: int, stop: int) -> str:
    ids = " or ".join(f'r.itemid == "{int(i)}"' for i in itemids)
    return (
        f'from(bucket: "{bucket}")\n'
        f"  |> range(start: {start}, stop: {stop})\n"
        '  |> filter(fn: (r) => r._measurement == "history" or r._measurement == "history_uint")\n'
        f"  |> filter(fn: (r) => {ids})\n"
        '  |> keep(columns: ["_time", "_value", "_measurement", "itemid"])'
    )


def influx_query(url: str, token: str, org: str, query: str, timeout: float) -> str:
    req = urllib.request.Request(
        f"{url.rstrip('/')}/api/v2/query?org={urllib.parse.quote(org)}",
        data=query.encode(),
        headers={
            "Authorization": f"Token {token}",
            "Content-Type": "application/vnd.flux",
            "Accept": "application/csv",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read().decode()


def to_rows(text: str) -> dict[str, list[str]]:
    """Annotated CSV -> {'history': [csv lines], 'history_uint': [...]}."""
    out: dict[str, list[str]] = {"history": [], "history_uint": []}
    header: list[str] | None = None
    for row in csv.reader(io.StringIO(text)):
        if not row or (row[0].startswith("#")):
            continue
        if "_time" in row and "_value" in row:
            header = row
            continue
        if header is None:
            continue
        rec = dict(zip(header, row, strict=False))
        m, v = rec.get("_measurement"), rec.get("_value")
        if m not in out or v in (None, ""):
            continue
        if m == "history_uint":
            v = v if v.isdigit() else str(int(float(v)))
        out[m].append(f"{rec['itemid']},{rec['_time']},{v}")
    return out


def ch_insert(url: str, user: str, password: str, table: str, lines: list[str]) -> None:
    if not lines:
        return
    q = urllib.parse.urlencode(
        {"query": f"INSERT INTO {table} FORMAT CSV", "date_time_input_format": "best_effort"}
    )
    auth = base64.b64encode(f"{user}:{password}".encode()).decode()
    req = urllib.request.Request(
        f"{url.rstrip('/')}/?{q}",
        data=("\n".join(lines) + "\n").encode(),
        headers={"Authorization": f"Basic {auth}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        res.read()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--items", required=True, help="file with one itemid per line")
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--batch", type=int, default=100, help="itemids per Flux query")
    ap.add_argument("--window", type=int, default=DAY, help="seconds per Flux query (<= 1 day)")
    ap.add_argument("--pause", type=float, default=0.2, help="seconds between Influx queries")
    ap.add_argument("--ch-url", default="http://127.0.0.1:8123")
    ap.add_argument("--ch-user", default="admin")
    ap.add_argument("--ch-password", default="admin")
    ap.add_argument("--ch-database", default="zabbix")
    a = ap.parse_args()
    if a.window > DAY:
        ap.error("--window must be <= 86400 (InfluxDB safety)")

    env = os.environ
    influx = (env["INFLUXDB_URL"], env["INFLUXDB_TOKEN"], env["INFLUXDB_ORG"])
    bucket = env.get("INFLUXDB_BUCKET", "zabbix")
    with open(a.items) as f:
        itemids = [ln.strip() for ln in f if ln.strip().isdigit()]
    batches = [itemids[i : i + a.batch] for i in range(0, len(itemids), a.batch)]

    end = (int(time.time()) // a.window) * a.window
    start = end - a.days * DAY
    total = {"history": 0, "history_uint": 0}
    t_begin = time.monotonic()
    for w_start in range(start, end, a.window):
        w_stop = min(w_start + a.window, end)
        for b in batches:
            text = influx_query(*influx, flux(bucket, b, w_start, w_stop), timeout=120)
            rows = to_rows(text)
            for table, lines in rows.items():
                ch_insert(a.ch_url, a.ch_user, a.ch_password, f"{a.ch_database}.{table}", lines)
                total[table] += len(lines)
            time.sleep(a.pause)
        day = time.strftime("%Y-%m-%d", time.gmtime(w_start))
        print(
            f"{day}: history={total['history']:,} history_uint={total['history_uint']:,}"
            f" ({time.monotonic() - t_begin:.0f}s)",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
