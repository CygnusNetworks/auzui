-- Zabbix 8.0 numeric history tables, column-compatible with the schema
-- Zabbix ships (/usr/share/doc/zabbix-server-*/clickhouse/history*_schema.sh):
-- same columns, primary key and TTL expression form (Zabbix parses the TTL
-- from the table definition). Differences: explicit column codecs, monthly
-- partitions and a 365-day TTL, as recommended in the Zabbix README for
-- year-long retention.

CREATE DATABASE IF NOT EXISTS zabbix;

CREATE TABLE IF NOT EXISTS zabbix.history
(
    itemid   UInt64        CODEC(ZSTD(1)),
    clock_ns DateTime64(9) CODEC(Delta, ZSTD(1)),
    value    Float64       CODEC(Gorilla, ZSTD(1))
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(clock_ns)
PRIMARY KEY (itemid, clock_ns)
TTL clock_ns + toIntervalSecond(31536000);

CREATE TABLE IF NOT EXISTS zabbix.history_uint
(
    itemid   UInt64        CODEC(ZSTD(1)),
    clock_ns DateTime64(9) CODEC(Delta, ZSTD(1)),
    value    UInt64        CODEC(T64, ZSTD(1))
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(clock_ns)
PRIMARY KEY (itemid, clock_ns)
TTL clock_ns + toIntervalSecond(31536000);

-- Read-only gateway user. The profile limits are the protection InfluxDB
-- never had: a runaway query is cancelled instead of taking the server down.
CREATE SETTINGS PROFILE IF NOT EXISTS auzui_ro SETTINGS
    readonly = 1,
    max_execution_time = 15,
    max_memory_usage = 2000000000,
    max_rows_to_read = 2000000000,
    max_result_rows = 1000000;

CREATE USER IF NOT EXISTS auzui IDENTIFIED WITH sha256_password BY 'auzui'
    SETTINGS PROFILE 'auzui_ro';

GRANT SELECT ON zabbix.history TO auzui;
GRANT SELECT ON zabbix.history_uint TO auzui;
