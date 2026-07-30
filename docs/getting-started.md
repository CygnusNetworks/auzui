# Getting started

## Prerequisites

- An existing **Zabbix ≥ 6.4** installation with the classic web frontend
  (`ui/`) reachable, and its JSON-RPC endpoint (`api_jsonrpc.php`) exposed —
  auzui talks to Zabbix exclusively through that Bearer-token API, it does
  not touch the database or any other Zabbix component. See
  [Clean-room statement](../README.md#clean-room-statement).
- A Zabbix user account (or several) to log in with. No extra Zabbix-side
  configuration is required — no plugins, no custom API tokens, no schema
  changes.
- Optional: an InfluxDB 2.x bucket populated by an `effluence` export, and/or
  a Graylog instance with a read-only API token, if you want the time-series
  and log fast paths described below. Neither is required to run auzui.
- [Docker](https://docs.docker.com/get-docker/) and
  [Docker Compose](https://docs.docker.com/compose/) for the quickstart
  below, or Node ≥ 22 + [pnpm](https://pnpm.io/) + [uv](https://docs.astral.sh/uv/)
  for a local dev setup (see [development.md](development.md)).

## Quickstart via Docker Compose

auzui ships as a single image (`ghcr.io/cygnusnetworks/auzui`) that bundles
the built SPA and `auzui-gateway` behind one FastAPI process
(`AUZUI_SERVE_FRONTEND=true`). Copy the example compose file and point it at
your Zabbix instance:

```bash
curl -O https://raw.githubusercontent.com/CygnusNetworks/auzui/main/docker-compose.example.yml
mv docker-compose.example.yml docker-compose.yml
```

Edit `docker-compose.yml` and set at minimum:

```yaml
environment:
  ZABBIX_API_URL: "https://zabbix.example.com/api_jsonrpc.php"
```

Then:

```bash
docker compose up -d
docker compose logs -f auzui   # watch startup / health
```

The container binds to `127.0.0.1:8080` by default (see the compose file) —
put a reverse proxy (nginx, Traefik, …) in front for TLS and external access.
See [deployment.md](deployment.md) for the nginx pattern, security headers,
and hardening notes, and [configuration.md](configuration.md) for the full
environment variable reference (InfluxDB, Graylog, SPNEGO, CORS, …).

Health check:

```bash
curl -fs http://127.0.0.1:8080/health
# {"status":"ok","version":"...","influx":false,"graylog":false}
```

`influx`/`graylog` reflect whichever optional integrations you configured —
`false` is expected and fine if you left `INFLUX_URL`/`GRAYLOG_URL` unset.

## First steps in the UI

1. Open the auzui URL in a browser. If SPNEGO/Kerberos SSO is not configured
   (`SPNEGO_ENABLED=false`, the default), you land on the login form and
   authenticate with your normal Zabbix username/password — auzui calls
   Zabbix's `user.login` and keeps the returned session token in
   `sessionStorage` (see [authentication.md](authentication.md)).
2. **Problems** (`/`) is the landing page: a live triage board over Zabbix's
   current problems, with severity filter chips, inline acknowledge, and a
   URL-addressable detail panel.
3. **Hosts** (`/hosts`) lists monitored hosts; **Host detail**
   (`/hosts/$hostId`) is the auto-generated per-host dashboard (component
   sections, thresholds rendered as chart zones, an interface/port matrix).
4. **Latest Data** (`/latest-data`) mirrors the classic Zabbix "Latest data"
   view with modern filtering.
5. **Explorer** (`/explorer`), **Topology** (`/topology`), and **Metrics**
   (`/metrics`) are the heatmap drill-down, dependency graph, and faceted
   metric browser described in the [README feature list](../README.md#features).
6. **⌘K** (Ctrl+K on non-Mac) opens the command palette — global search over
   hosts/items/triggers plus quick actions.
7. **Logs** (`/logs`) only appears once Graylog is configured (see below);
   otherwise the route and its nav entry are hidden entirely.
8. **Maintenance** (`/maintenance`) manages Zabbix maintenance windows.

## What works without `auzui-gateway`

`auzui-gateway` (`services/gateway`) is entirely optional. Without it — or
with it running but `INFLUX_URL`/`GRAYLOG_URL` unset — the SPA talks directly
to `api_jsonrpc.php` and every core monitoring workflow works normally:

| Feature | Without gateway / without Influx / without Graylog |
|---|---|
| Problems, Hosts, Latest Data, Explorer, Topology, Metrics, command palette | **Fully functional** — driven entirely by the Zabbix JSON-RPC API |
| Chart time-series | Falls back to `history.get`/`trend.get` (see [timeseries-sources.md](timeseries-sources.md) for when this gets slow on large instances) |
| Log panels (`/logs`, host-scoped log tab) | Hidden entirely — `/api/logs/status` reports `enabled: false` |
| Kerberos/SPNEGO SSO | Falls back to the password login form — `/api/auth/methods` reports `spnego: false` |

In other words: `auzui-gateway` unlocks the InfluxDB fast path and the
Graylog log panels, and optionally serves the built SPA — it is never
required for the core monitoring UI to work. Full variable-by-variable
reference: [configuration.md](configuration.md).
