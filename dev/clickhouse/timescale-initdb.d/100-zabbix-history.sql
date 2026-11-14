-- Zabbix numeric history tables as in production (Zabbix 8.0 PostgreSQL
-- schema + TimescaleDB): 1-day chunks on the integer `clock` column,
-- compression segmentby itemid, orderby clock, ns.
-- Chunks are compressed explicitly after loading (load_compare.sh), not by
-- a policy; production compresses after 2 days.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE history (
    itemid bigint                         NOT NULL,
    clock  integer          DEFAULT '0'   NOT NULL,
    value  DOUBLE PRECISION DEFAULT '0.0000' NOT NULL,
    ns     integer          DEFAULT '0'   NOT NULL,
    PRIMARY KEY (itemid, clock, ns)
);

CREATE TABLE history_uint (
    itemid bigint                         NOT NULL,
    clock  integer          DEFAULT '0'   NOT NULL,
    value  numeric(20)      DEFAULT '0'   NOT NULL,
    ns     integer          DEFAULT '0'   NOT NULL,
    PRIMARY KEY (itemid, clock, ns)
);

SELECT create_hypertable('history', 'clock', chunk_time_interval => 86400);
SELECT create_hypertable('history_uint', 'clock', chunk_time_interval => 86400);

ALTER TABLE history SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'itemid',
    timescaledb.compress_orderby = 'clock,ns'
);
ALTER TABLE history_uint SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'itemid',
    timescaledb.compress_orderby = 'clock,ns'
);
