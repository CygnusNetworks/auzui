#!/usr/bin/env bash
# Stretch the imported 30 days to ~360 days in ClickHouse and TimescaleDB by
# copying them 11 times, each copy shifted 30 days further back. Same items,
# same value patterns — only to measure storage and query time at one year of
# retention. InfluxDB is left out: production keeps only 30 days raw there.
#
#   dev/clickhouse/extend_365d.sh
set -euo pipefail

CH="http://127.0.0.1:8123/?user=admin&password=admin"
PSQL=(docker exec -i auzui-timescaledb psql -U zabbix -d zabbix -v ON_ERROR_STOP=1 -q -At)
SHIFT=$((30 * 86400))

ch() { curl -sf "$CH" --data-binary "$1"; }

base_start=$(ch "SELECT toUnixTimestamp(min(clock_ns)) FROM zabbix.history_uint")
base_end=$(ch "SELECT toUnixTimestamp(max(clock_ns)) + 1 FROM zabbix.history_uint")

for k in $(seq 1 11); do
    off=$((k * SHIFT))
    for table in history history_uint; do
        ch "INSERT INTO zabbix.$table
            SELECT itemid, clock_ns - toIntervalSecond($off), value FROM zabbix.$table
            WHERE clock_ns >= toDateTime64($base_start, 9) AND clock_ns < toDateTime64($base_end, 9)"
        "${PSQL[@]}" -c "INSERT INTO $table (itemid, clock, value, ns)
            SELECT itemid, clock - $off, value, ns FROM $table
            WHERE clock >= $base_start AND clock < $base_end"
        "${PSQL[@]}" -c "SELECT count(compress_chunk(c, if_not_compressed => true))
            FROM show_chunks('$table') c" >/dev/null
    done
    echo "copy $k/11 done ($(date +%H:%M:%S))"
done

for table in history history_uint; do
    ch "OPTIMIZE TABLE zabbix.$table FINAL"
    "${PSQL[@]}" -c "VACUUM ANALYZE $table"
done
echo "done"
