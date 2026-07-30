# Time-series sources: Zabbix API vs. InfluxDB

auzui reads time-series data from two possible sources behind a single
`TimeseriesSource` interface.

## The short version

- **Zabbix's `history.get`/`trend.get` is the default path and always
  available** — Latest Data, sparklines, short chart ranges, and
  trigger-adjacent values are served directly from the Zabbix API.
- **InfluxDB (via an `effluence` export) is optional.** When configured,
  auzui prefers it for charting: downsampling happens server-side in a
  Flux `aggregateWindow` query, which makes long ranges and dense
  multi-item dashboards cheap regardless of instance size.

| Path | Good for |
|---|---|
| Zabbix `history.get` | short/recent ranges, latest values |
| Zabbix `trend.get` | longer ranges at hourly aggregation |
| InfluxDB (effluence) | all chart ranges, multi-item views, server-side downsampling |

## Operator recommendation

- If your dashboards mostly look at short or recent windows, **the Zabbix
  API path alone is enough** — don't stand up InfluxDB just for auzui.
- If you already have (or are willing to run) an `effluence` export to
  InfluxDB — for example because you already use it for Grafana —
  **configure it in `auzui-gateway`.** auzui automatically prefers
  `InfluxSource` once `/api/ts/status` reports `enabled: true`, and every
  chart and long-range view (up to 365 days) uses server-side
  downsampling.

## Implementation behaviour

1. **Without Influx, default chart ranges are conservative**; longer
   ranges fall back to `trend.get`.
2. **Timeouts and slow calls are handled gracefully** — abort, skeleton
   loading, retry — never blocking the rest of the view.
3. **InfluxDB is feature-gated** exactly like Graylog: `/api/ts/status`
   tells the SPA whether to use `InfluxSource`, otherwise it falls back to
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
