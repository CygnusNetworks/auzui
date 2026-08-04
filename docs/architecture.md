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
time-series, Graylog logs, Docker container management, Kerberos/SPNEGO
SSO) — it exists to keep upstream tokens out of the browser and to enforce
Zabbix permissions on data it proxies. It is deliberately minimal
(FastAPI, Python) and is **not** a general API proxy: CRUD, Problems, and
configuration traffic goes straight from the SPA to `api_jsonrpc.php`.
Docker is the first component that talks directly to managed hosts (rather
than a monitoring backend) and the first with write actions beyond Zabbix
itself — see `/api/docker/*` below.

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

### `/api/docker/*` — container management (Docker, optional)

`docker_routes.py` is the gateway's first `APIRouter` **module** — every
other route above is still defined inline in `app.py`; Docker's routes are
built by `create_docker_router(settings, zabbix, docker_service,
update_checker, compose_runner)` and mounted with `app.include_router(...)`.
`bearer_token` was moved out of `app.py` into a small `deps.py` so both
modules can depend on it without a circular import; `app.py` re-exports it
so existing tests importing it from there keep working.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/docker/status` | `{ enabled: bool }` — feature flag for the SPA |
| `GET` | `/api/docker/hosts` | Per-host summary (running/stopped containers, images, engine version) fanned out across all configured hosts |
| `GET` | `/api/docker/containers` | Normalized container list, optionally filtered by `hosts` |
| `GET` | `/api/docker/containers/{host_id}/{cid}` | Trimmed inspect data for one container |
| `GET` | `/api/docker/containers/{host_id}/{cid}/stats` | One-shot normalized resource stats |
| `POST` | `/api/docker/stats` | Bulk stats for `{targets: {host_id: [container_id, ...]}}`, used by the list view |
| `GET` | `/api/docker/containers/{host_id}/{cid}/logs` | `since`/`until`/`tail` + cursor, for both a historical range and a live poll |
| `GET` | `/api/docker/search` | Free-text search across containers/images/volumes/networks |
| `GET` | `/api/docker/updates` | Registry digest comparison per container |
| `GET` | `/api/docker/permissions` | `{ can_act: bool }` for the caller — see the auth caveat below |
| `POST` | `/api/docker/containers/{host_id}/{cid}/action` | `start`/`stop`/`restart`/`pull_recreate` — write, admin-gated |
| `GET` | `/api/docker/stacks/{host_id}` | Compose-project grouping of that host's containers |
| `POST` | `/api/docker/stacks/{host_id}/{project}/action` | `pull`/`up`/`restart` via SSH — write, admin-gated, `ssh://` hosts only |

**Fan-out and partial-result aggregation.** `DockerService` follows the same
shape `GraylogService` established for multi-backend Graylog: a fan-out
request (`hosts`, `containers`, `stats_bulk`, `search`) issues one call per
target host/container with `asyncio.gather(..., return_exceptions=True)`,
so one unreachable host degrades the response to a **partial result** —
the other hosts' data plus an `errors: [{host_id, message}]` list — instead
of failing the whole request. Only when *every* selected host fails does
the call raise a single `HTTPException(502)`, mirroring `graylog.py`
exactly.

**Blocking docker-py under `asyncio.to_thread` + semaphores.** docker-py is
a synchronous client (the only Python client that speaks all three
transports — socket-proxy HTTP, TCP+mTLS, and `ssh://` via paramiko —
uniformly). `DockerHostClient` is therefore a dumb, fully synchronous
per-host wrapper; every one of its methods is called by `DockerService`
exclusively through `await asyncio.to_thread(...)`, throttled by a
per-host `asyncio.Semaphore(4)` (a slow host can't starve the others) and a
global `asyncio.Semaphore(16)` (bounds total OS-thread fan-out for one
gateway process). Client construction is lazy and `asyncio.Lock`-guarded
per host, so concurrent first requests to the same host don't race to build
two clients.

**Config-file layer.** Alongside environment variables, `Settings` accepts
an optional TOML/YAML file as an additional `pydantic-settings` source
(`config_file.py`'s `ConfigFileSource`, wired into
`Settings.settings_customise_sources` below env/`.env` and above field
defaults). It was introduced together with Docker support because
`DOCKER_HOSTS`/`DOCKER_REGISTRIES` are the settings most likely to grow
past a single-line env var, but the file can set **any** Settings field —
see [docs/configuration.md](configuration.md#configuration-files-tomlyaml)
for the full precedence and schema rules.

**Authorization caveat (mirrors the Graylog one above).** Docker host
*visibility* is coarse-grained: any valid Zabbix session can see every host
in `DOCKER_HOSTS` and its containers/logs/stats/update-status — there is no
per-Zabbix-host or per-item mapping the way `/api/ts` and `/api/logs/host`
have, because docker-py/the socket proxy have no concept of a Zabbix
host/item at all. Only *write* actions narrow further: they require the
caller's Zabbix role to resolve to Admin/Super Admin
(`ZabbixClient.get_user_role_type`) **and** the target host to have
`readonly: false`. Full detail:
[docs/configuration.md#authorization-model](configuration.md#authorization-model).

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
  docker/                  DockerSource abstraction, optional
services/
  gateway/                 auzui-gateway (FastAPI) — optional Influx/Graylog/Docker proxy
docs/                      architecture, deployment, time-series notes
site/                      static product page (GitHub Pages)
```
