# Time-series sources: Zabbix API vs. InfluxDB

auzui reads time-series data from two possible sources behind a single
`TimeseriesSource` interface. Understanding when each is fast — and why —
matters both for auzui's own defaults and for operators deciding whether to
stand up an InfluxDB export path.

## The short version

- **Zabbix's `history.get`/`trend.get` is the default path and works fine**
  as long as you stay inside the **"warm" history / value-cache window** —
  Latest Data, sparklines, short chart ranges, trigger-adjacent values.
- **InfluxDB (via an `effluence` export) is optional, but is clearly the
  more performant path** — especially for longer ranges, multi-item
  charts, and dense dashboards. auzui works fully without it; it gets
  noticeably better with it.
- The 50-second `history.get` calls documented below are **not a defect in
  the Zabbix API**. They are the signature of a query falling out of the
  warm cache/history path and having to scan a large history
  table/hypertable on a big instance.

## Cache hypothesis: warm history vs. cold history

Historical data through the Zabbix API works well as long as the query
stays within the limits of the **history and/or value cache** — i.e. the
"warm", recently-written history. Typical warm-path queries: Latest Data,
sparklines, short chart windows, values near an active trigger.

The extreme latencies and timeouts show up when `history.get` has to reach
**outside** that warm window and hit the full history table/hypertable
directly (long ranges, many items, full scan/chunk paths). That is a
**storage-layer access/scaling problem**, not a general defect of the API
layer — `item.get` and `problem.get` against the same instance stay fast
throughout.

| Path | Good for | Problematic for |
|---|---|---|
| Zabbix `history.get` | short/recent ranges, cache/warm history | long ranges, cold history, large hypertables |
| Zabbix `trend.get` | longer ranges at hourly aggregation | fine resolution (trends are coarse) |
| InfluxDB (effluence) | practically all chart ranges, multi-item, downsampling | only available if the export pipeline exists |

## Measurements

Measured against the same item (item 357562, "Interface tiqora: Bits
sent", 1-minute interval, `value_type` uint) on a production-scale
instance (~103k items):

| Range | Zabbix `history.get` | InfluxDB (effluence) | Factor |
|---|---|---|---|
| 1h   | **50,216 ms** (61 points, 4 kB)    | **48 ms** (59 points)   | ~1050× |
| 6h   | **50,257 ms** (362 points, 25 kB)  | **77 ms**               | ~650×  |
| 24h  | **50,392 ms** (1,442 points, 99 kB)| **82 ms** (@5m agg)     | ~615×  |
| 7d   | timeout (>50 s)                    | **113 ms**              | —      |
| 30d  | timeout                            | **119 ms**              | —      |
| 365d | practically unusable               | **62 ms** (14 points)   | —      |

### Interpretation

- On this instance, `history.get` already cost a **fixed ~50 seconds per
  call** starting at 1 hour, regardless of payload size (4 kB and 99 kB
  took the same time). Payload scales linearly with the range; latency
  doesn't — that is the signature of an expensive history-DB access path
  (missing/ineffective chunk pruning or index usage on the hypertable), not
  something wrong with the API layer itself.
- `item.get` and `problem.get` stayed fast throughout — the cost is
  specific to history queries falling outside the warm path.
- Whether 1 hour was already "cold" on this particular instance (value
  cache vs. history table, housekeeper retention, chunking behaviour) is
  still an open calibration question — a useful follow-up measurement is
  comparing against a very short window (last N values, 5–15 min) or a
  freshly-written item to find the actual warm/cold boundary per instance.

## Operator recommendation: when does InfluxDB pay off?

- If your Zabbix instance is small, history queries stay warm, or your
  dashboards only ever look at short/recent windows: **the Zabbix API path
  alone is enough.** Don't bother standing up InfluxDB just for auzui.
- If you already have (or are willing to run) an `effluence` export to
  InfluxDB — as is common on larger instances, or if you already use it
  for Grafana — **configure it in `auzui-gateway`.** auzui will
  automatically prefer `InfluxSource` once `/api/ts/status` reports
  `enabled: true`, and every chart, dense dashboard, and long-range view
  gets substantially faster and can safely go out to 365 days.
- Rule of thumb from the measurements above: once dashboards want **charts
  longer than roughly an hour**, or **many items on one screen**
  (Infrastructure Explorer, Auto-Dashboards, Metric Browser), the Zabbix
  API path risks multi-second-to-timeout latency on large instances while
  InfluxDB stays comfortably sub-100ms. Below that — Latest Data,
  single-item sparklines, trigger-adjacent values — the plain API path is
  perfectly fine and adding InfluxDB buys little.

## Consequences for the implementation

1. **Default chart ranges without Influx are conservative** (roughly
   15 minutes to 1 hour, to be calibrated per instance); longer ranges fall
   back to `trend.get` or show an explicit "this may take a while /
   InfluxDB recommended" hint.
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
