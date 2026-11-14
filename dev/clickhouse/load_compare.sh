#!/usr/bin/env bash
# Copy the history already loaded into the local ClickHouse (influx_import.py)
# into the local InfluxDB and TimescaleDB of the "compare" profile, so all
# three backends hold exactly the same values for bench.py.
#
#   docker compose -f dev/clickhouse/compose.yml --profile compare up -d
#   dev/clickhouse/load_compare.sh
#
# InfluxDB gets the effluence layout (measurement history/history_uint, tag
# itemid, field value), TimescaleDB the Zabbix layout (clock + ns), compressed
# like production afterwards.
set -euo pipefail

CH="http://127.0.0.1:8123/?user=admin&password=admin"
INFLUX="http://127.0.0.1:8086/api/v2/write?org=dev&bucket=zabbix&precision=ns"
PSQL=(docker exec -i auzui-timescaledb psql -U zabbix -d zabbix -v ON_ERROR_STOP=1 -q)

ch() { curl -sf "$CH" --data-binary "$1"; }

days=$(ch "SELECT DISTINCT toDate(clock_ns) FROM zabbix.history_uint ORDER BY 1 FORMAT TSV")

echo "== InfluxDB"
for table in history history_uint; do
    suffix=""; [ "$table" = history_uint ] && suffix="u"
    for d in $days; do
        ch "SELECT concat('$table,itemid=', toString(itemid), ' value=', toString(value), '$suffix ',
                   toString(toUnixTimestamp64Nano(clock_ns)))
            FROM zabbix.$table WHERE toDate(clock_ns) = '$d' FORMAT TSVRaw" |
            gzip -1 |
            curl -sf -H "Authorization: Token dev-token" -H "Content-Encoding: gzip" \
                -H "Content-Type: text/plain; charset=utf-8" --data-binary @- "$INFLUX"
    done
    echo "  $table done"
done

echo "== TimescaleDB"
for table in history history_uint; do
    "${PSQL[@]}" -c "TRUNCATE $table"
    ch "SELECT itemid, toUnixTimestamp(clock_ns), value, toUnixTimestamp64Nano(clock_ns) % 1000000000
        FROM zabbix.$table FORMAT CSV" |
        "${PSQL[@]}" -c "\copy $table (itemid, clock, value, ns) FROM STDIN WITH (FORMAT csv)"
    "${PSQL[@]}" -c "SELECT count(compress_chunk(c, if_not_compressed => true)) FROM show_chunks('$table') c" >/dev/null
    "${PSQL[@]}" -c "VACUUM ANALYZE $table"
    echo "  $table done"
done
