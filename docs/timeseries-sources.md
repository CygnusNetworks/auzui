# Time-series sources: Zabbix API, InfluxDB, ClickHouse

auzui reads time-series data from three possible sources behind a single
`TimeseriesSource` interface.

## The short version

- **Zabbix's `history.get`/`trend.get` is the default path and always
  available** — Latest Data, sparklines, short chart ranges, and
  trigger-adjacent values are served directly from the Zabbix API.
- **InfluxDB (via an `effluence` export) is optional.** When configured,
  auzui prefers it for charting: downsampling happens server-side in a
  Flux `aggregateWindow` query, which makes long ranges and dense
  multi-item dashboards cheap regardless of instance size.

- **ClickHouse (Zabbix 8.0 history provider) is optional too.** The
  gateway reads Zabbix's own `history`/`history_uint` tables directly and
  downsamples server-side with the same semantics as the Flux path. In
  `TS_BACKEND=auto` it is preferred over InfluxDB. Use a read-only
  ClickHouse user with limits (`readonly=1`, `max_execution_time`,
  `max_memory_usage`, `max_rows_to_read`).
- **Caveat:** with ClickHouse history Zabbix stores no trends, so
  `trend.get` returns nothing. The Zabbix-API path then falls back to
  `history.get` for long ranges (client-side LTTB), which can be slow;
  the gateway ClickHouse backend is therefore the recommended setup there.

| Path | Good for |
|---|---|
| Zabbix `history.get` | short/recent ranges, latest values |
| Zabbix `trend.get` | longer ranges at hourly aggregation |
| Zabbix `history.get` (trend fallback) | long ranges when Zabbix keeps no trends (ClickHouse history); slow on large ranges |
| InfluxDB (effluence) | all chart ranges, multi-item views, server-side downsampling |
| ClickHouse (gateway) | same, reading Zabbix 8.0 history directly; recommended with ClickHouse history |

## Operator recommendation

- If your dashboards mostly look at short or recent windows, **the Zabbix
  API path alone is enough** — don't stand up InfluxDB just for auzui.
- If you already have (or are willing to run) an `effluence` export to
  InfluxDB — for example because you already use it for Grafana —
  **configure it in `auzui-gateway`.** auzui automatically prefers
  `InfluxSource` once `/api/ts/status` reports `enabled: true`, and every
  chart and long-range view (up to 365 days) uses server-side
  downsampling.

- If Zabbix 8.0 stores history in ClickHouse, **configure
  `CLICKHOUSE_URL` in `auzui-gateway`** — there are no trends, so the
  Zabbix API path alone is slow or sparse for long ranges.

## Implementation behaviour

1. **Without Influx, default chart ranges are conservative**; longer
   ranges use `trend.get` (or `history.get` when trends are empty).
2. **Timeouts and slow calls are handled gracefully** — abort, skeleton
   loading, retry — never blocking the rest of the view.
3. **InfluxDB and ClickHouse are feature-gated** exactly like Graylog:
   `/api/ts/status` tells the SPA whether to use the gateway source, otherwise it falls back to
   `ZabbixApiSource`.

## effluence schema and Flux query reference

- Measurement: `history` (float) or `history_uint` (uint) — `effluence`
  only exports numeric types (`dbl`/`uint`).
- Tag: `itemid` (the Zabbix item ID, as a string). Field: the value.
  `_time` is the timestamp.
- Query pattern used by `auzui-gateway` (the server-side downsampling step
  is the main advantage over raw `history.get`):

```flux
from(bucket: "zabbix")
  |> range(start: -{range})
  |> filter(fn: (r) => r._measurement == "history" or r._measurement == "history_uint")
  |> filter(fn: (r) => r.itemid == "{itemid}")     // or an OR-list for multi-item
  |> group(columns: ["itemid"])
  |> aggregateWindow(every: {N}m, fn: last, createEmpty: false)
```

`auzui-gateway` picks `every` from the requested point budget (range ÷
target pixel width → "N points over range X"), chooses `fn` per metric
(`last`/`mean`; `min`+`max` for an envelope), and filters out items the
logged-in user is not permitted to see via `item.get` before ever touching
Influx.
