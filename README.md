# auzui — A Usable Zabbix UI

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)
[![CI](https://github.com/cygnusnetworks/auzui/actions/workflows/ci.yml/badge.svg)](https://github.com/cygnusnetworks/auzui/actions/workflows/ci.yml)
[![Docker](https://img.shields.io/badge/ghcr.io-cygnusnetworks%2Fauzui-2496ED?logo=docker&logoColor=white)](https://github.com/cygnusnetworks/auzui/pkgs/container/auzui)
[![React 19 + TypeScript](https://img.shields.io/badge/React%2019-TypeScript-61DAFB?logo=react&logoColor=black)](./frontend)

> **Early stage / pre-MVP.** auzui is under active design and initial
> implementation. APIs, layouts, and scope may still change significantly.

**auzui** is a modern, self-hosted monitoring single-page application that
runs **next to** your existing [Zabbix](https://www.zabbix.com/) web UI —
not instead of it. Configuration and administration stay in the classic
Zabbix UI for now; auzui focuses entirely on the monitoring workflows that
benefit most from a rebuilt, fast, dense, dark-mode-first interface:
Problems triage, Host deep-dives, Latest Data, auto-generated dashboards,
and infrastructure exploration — all driven by Zabbix's existing
JSON-RPC API.

The guiding principle is **Zero-Config Deep Observability**: auzui derives
as much as it can automatically from what Zabbix already knows (item tags,
units, templates, trigger expressions, LLD, inventory) instead of asking
operators to configure dashboards, panels, or thresholds by hand.

## Why auzui

The stock Zabbix web UI (`ui/` in the Zabbix source tree) is a large,
~1,700-file PHP monolith — its own MVC, hundreds of controllers, jQuery and
hand-rolled ES6, no build system, server-rendered PNG graphs. It is
functionally complete but shows its age in day-to-day monitoring use.
auzui is a greenfield rebuild of the *monitoring* surface — Problems,
Hosts, Latest Data, dashboards, topology — with modern navigation, native
charts, a command palette, and a UI built for high information density and
fast triage.

## Features

- **Problems as a live triage board** — virtualized list, inline
  acknowledge/comment without modal cascades, severity filter chips, bulk
  actions, a URL-addressable side panel instead of a popup (filters are
  shareable links).
- **Host Deep-Dive auto-dashboards** — a fully generated per-host dashboard:
  sections by component class, trigger thresholds rendered as chart zones,
  an interface/port matrix, storage & certificate forecasts, 7-day ghost
  lines — with **zero manual dashboard configuration**.
- **Infrastructure Explorer** — heatmap drill-down from host groups → host
  tiles → component tiles → item, colored by status or utilization, with a
  "top movers" sidebar at every level.
- **Auto-Topology** — a force-directed dependency graph built from trigger
  dependencies, LLDP/CDP neighbors, shared subnets, and statistical event
  correlation, each edge tagged with its evidence layer and confidence.
- **Metric Browser** — faceted search across every item (component tag,
  unit, template, group), a small-multiples wall sortable by deviation from
  baseline, with multi-select overlay comparison across hosts.
- **⌘K command palette** — global search over hosts/items/triggers/
  dashboards plus actions ("Ack problem…", "Go to host…"), replacing deep
  menu navigation.
- **Dark-mode first**, high information density, consistent severity color
  semantics, skeleton loading instead of spinners.
- *Optional:* **InfluxDB fast path** for time-series (via an `effluence`
  export) — see [Time-series sources](#time-series-sources) below.
- *Optional:* **Graylog logs** — a stream browser and host-scoped log panel
  synced to the same time range as the charts, entirely feature-gated.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  auzui SPA (React + TS, Vite)                                │
│  TanStack Router/Query · shadcn/ui · uPlot                   │
└──────────┬────────────────────┬──────────────────┬───────────┘
           │ JSON-RPC (Bearer)  │ /api/ts          │ /api/logs (opt.)
           ▼                    ▼                  ▼
  api_jsonrpc.php        auzui-gateway (optional, small)
  (existing PHP UI,      – Flux aggregateWindow ("N points over range")
   run headless)         – hides the Influx token
                          – optional: Graylog proxy (token, streams, search)
           │                    │                  │
           ▼                    ▼                  ▼
   PostgreSQL/Timescale     InfluxDB 2         Graylog REST API
                            (effluence)        (streams + search)
```

The existing Zabbix web UI is kept running as a **headless API backend**
(its JSON-RPC layer lives in the PHP frontend, not the C server — auzui
does not reimplement it). `auzui-gateway` is only needed once InfluxDB
and/or Graylog are configured; without it, the SPA talks straight to
`api_jsonrpc.php` and everything still works, just without the optional
fast paths. Full breakdown: [docs/architecture.md](./docs/architecture.md).

## Time-series sources

auzui reads time-series through a `TimeseriesSource` abstraction with two
implementations:

- **`ZabbixApiSource`** (default, always available) — `history.get` for
  short/recent ranges, `trend.get` for longer windows. This works fine as
  long as the query stays inside the **warm history / value-cache
  window** — Latest Data, sparklines, short chart ranges.
- **`InfluxSource`** (optional, primary when configured) — routes through
  `auzui-gateway` to a Flux `aggregateWindow` query, downsampled
  server-side. Substantially faster, and the only practical way to cover
  long ranges or dense multi-item dashboards on a large instance.

The 50-second-plus `history.get` calls below are **not a Zabbix API
defect** — they're the signature of a query falling out of the warm
cache/history path and hitting a large history table/hypertable directly
on a big instance. Measured on the same item (1-minute interval, ~103k
items on the reference instance):

| Range | Zabbix `history.get` | InfluxDB (effluence) | Factor |
|---|---|---|---|
| 1h   | **50,216 ms** (61 pts, 4 kB)     | **48 ms** (59 pts)   | ~1050× |
| 6h   | **50,257 ms** (362 pts, 25 kB)   | **77 ms**            | ~650×  |
| 24h  | **50,392 ms** (1,442 pts, 99 kB) | **82 ms** (@5m agg)  | ~615×  |
| 7d   | timeout (>50 s)                  | **113 ms**           | —      |
| 30d  | timeout                          | **119 ms**           | —      |
| 365d | practically unusable             | **62 ms** (14 pts)   | —      |

auzui stays **fully usable without InfluxDB** — conservative default
ranges, `trend.get` fallback for long windows, graceful timeout handling —
and gets noticeably faster and more capable **with** InfluxDB configured.
Full cache-hypothesis writeup, the effluence Flux query, and an operator
recommendation for when it's worth setting up:
[docs/timeseries-sources.md](./docs/timeseries-sources.md).

## Monorepo layout

```
frontend/                 Vite + React 19 + TypeScript SPA
packages/
  zabbix-client/           typed JSON-RPC client
  timeseries/              TimeseriesSource abstraction (Zabbix + Influx) + LTTB
  logs/                    LogSource abstraction (Graylog), optional
services/
  gateway/                 auzui-gateway (FastAPI) — optional Influx/Graylog proxy
docs/                      architecture, deployment, time-series notes
site/                      static product page (GitHub Pages)
```

## Quickstart

Prerequisites: Node ≥ 22, [pnpm](https://pnpm.io/) (version pinned via
`packageManager` in `package.json`), and [uv](https://docs.astral.sh/uv/)
for the optional gateway.

```bash
# Frontend + workspace packages
pnpm install
pnpm dev            # runs the frontend/ dev server

# Optional: auzui-gateway (only needed for InfluxDB/Graylog)
uv sync --package auzui-gateway --extra dev
uv run uvicorn auzui_gateway.main:app --reload --host 0.0.0.0 --port 8080
```

Or with [just](https://github.com/casey/just):

```bash
just install
just dev            # frontend
just gateway-dev     # gateway
just lint
just test
just build
```

Configuration reference (Zabbix/Influx/Graylog env vars, nginx pattern,
planned deployment): [docs/deployment.md](./docs/deployment.md).

## Clean-room statement

auzui is an **independent, clean-room implementation** built purely
against Zabbix's documented JSON-RPC API contract. It contains **no
Zabbix source code**. The existing Zabbix web UI is treated as an opaque,
already-installed backend service that auzui talks to over HTTP — it is
never read, copied, or forked. See [NOTICE.md](./NOTICE.md) for the full
licensing and trademark statement.

## Contributing

1. Open an issue or discuss the change before large design work.
2. Keep documentation, user-facing strings, and code comments in English.
3. Do not copy any Zabbix source into the tree.
4. Run `just lint` and `just test` before opening a PR.

## License

auzui is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0-only) — see [LICENSE](./LICENSE). See [NOTICE.md](./NOTICE.md)
for the clean-room statement and trademark notes.

Copyright © 2026 Cygnus Networks GmbH.

"Zabbix" is a trademark of Zabbix LLC / SIA Zabbix. auzui is not
affiliated with, endorsed by, or sponsored by Zabbix LLC/SIA; the name is
used solely to describe factual interoperability with the Zabbix JSON-RPC
API. "Graylog" and "InfluxDB" are trademarks of their respective owners and
are used solely to describe optional, factual interoperability.
