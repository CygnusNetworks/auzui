# Architecture

## Overview

auzui is a modern, monitoring-first single-page application that sits
**next to** an existing Zabbix installation — it does not replace or fork
the Zabbix web UI. Configuration/administration stays in the classic
Zabbix UI for now; auzui focuses on Problems, Hosts, Latest Data,
auto-generated dashboards, and infrastructure exploration.

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

- **The Zabbix JSON-RPC API lives in the PHP frontend**
  (`ui/include/classes/api/services/` inside the Zabbix source tree talks
  directly to the database; `api_jsonrpc.php` is just an HTTP wrapper
  around it). auzui therefore keeps the existing PHP UI installed and
  running as a **headless API backend** — it is not reimplemented.
- roughly 70–80% of the functionality auzui needs is reachable purely via
  the API: CRUD, Problems/Events, Latest Data, `history.get`/`trend.get`,
  Dashboards, `user.login` (a session token used as a Bearer token), and
  CORS is open by default.
- Known gaps in the API surface: no server-side graph downsampling; server
  status/queue/item-test run over a binary TCP protocol
  (`CZabbixServer`), not JSON-RPC; SSO/SAML/MFA are redirect flows; map
  state resolution (`CMapHelper`) is not exposed; there is no push
  transport, so realtime is polling-based.

## Datasource abstraction

The frontend defines a `TimeseriesSource` interface with two
implementations, selected automatically based on gateway configuration:

- **`ZabbixApiSource`** (default, always available) — uses `history.get`
  for short/recent ranges and `trend.get` for longer windows with coarser
  resolution. Point reduction (LTTB) runs in a Web Worker. See
  [docs/timeseries-sources.md](./timeseries-sources.md) for how the source
  is selected.
- **`InfluxSource`** (optional, primary when configured) — calls
  `auzui-gateway`, which runs a Flux `aggregateWindow` query server-side.
  Server-side downsampling makes ranges up to 365 days practical.
  Recommended whenever charts get dense or ranges get long.

A similar `LogSource` abstraction exists in `packages/logs` for the
optional Graylog integration (`GraylogSource` / `NullLogSource`).

## auzui-gateway

`services/gateway` provides the optional integrations (InfluxDB
time-series, Graylog logs, Kerberos/SPNEGO SSO) — it exists to keep
upstream tokens out of the browser and to enforce Zabbix permissions on
data it proxies. It is deliberately minimal
(FastAPI, Python) and is **not** a general API proxy: CRUD, Problems, and
configuration traffic goes straight from the SPA to `api_jsonrpc.php`.

### `/api/ts/*` — time series (InfluxDB)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/ts/status` | `{ enabled: bool }` — feature flag for the SPA |
| `POST` | `/api/ts/query` | Body: `{ itemids[], start, end, points, fn }` → downsampled series per item |

The gateway takes the caller's Zabbix session token, verifies **item
permission via `item.get`** before querying Influx (so Influx access can
never open a permission gap beyond what Zabbix already grants), resolves
each `itemid` into a Flux query against the `effluence`-exported
`history`/`history_uint` measurements, and picks the `aggregateWindow`
step from the requested point budget.

### `/api/logs/*` — logs (Graylog, optional)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/logs/status` | `{ enabled: bool, url?: string }` — feature flag for the SPA |
| `GET` | `/api/logs/streams` | Stream list (id, title, description, disabled, is_default) |
| `POST` | `/api/logs/search` | Body: `{ query, stream_ids?, from, to, limit, offset? }` → messages + total |
| `POST` | `/api/logs/host/{hostid}` | Body: `{ from, to, limit, extra_query?, stream_ids? }` — gateway resolves the Zabbix host → Graylog `source` mapping, merges the query, and checks host visibility via `host.get` |

Same permission model as Influx: the logged-in Zabbix user must be able to
see the host (`host.get`) before its logs are returned. The Graylog side
uses a read-only service token (no write, no user administration). Without
`GRAYLOG_URL`/`GRAYLOG_TOKEN` configured, `/api/logs/status` reports
`enabled: false` and the SPA simply hides the log panels — Problems/Hosts/
Charts are unaffected.

## Realtime

Realtime updates use smart polling via TanStack Query
(`refetchInterval`, gated by tab visibility) with delta queries over an
`eventid` cursor for Problems. There is no WebSocket transport in the MVP —
Zabbix's API has no push mechanism to build on.

## Monorepo layout

```
frontend/                 Vite + React 19 + TypeScript SPA
packages/
  zabbix-client/           typed JSON-RPC client (generated TS types for used methods)
  timeseries/              TimeseriesSource abstraction (Zabbix + Influx) + LTTB
  logs/                    LogSource abstraction (Graylog), optional
services/
  gateway/                 auzui-gateway (FastAPI) — optional Influx/Graylog proxy
docs/                      architecture, deployment, time-series notes
site/                      static product page (GitHub Pages)
```
