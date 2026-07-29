# Deployment

auzui has two runtime pieces:

- **`frontend/`** — a static Vite build (plain HTML/CSS/JS), served either
  by any static web server / CDN, or by `auzui-gateway` itself
  (`AUZUI_SERVE_FRONTEND`, see below).
- **`services/gateway`** (`auzui-gateway`) — a small FastAPI service that is
  only required once InfluxDB and/or Graylog are configured. Without it,
  the SPA talks directly to the existing Zabbix `api_jsonrpc.php` endpoint
  and everything except the Influx/Graylog fast paths works normally.

## Gateway environment variables

All variables are read from the process environment (or a `.env` file next
to the gateway, see `.env.example` at the repo root). Every integration is
feature-gated: leave its variables empty and the corresponding
`/api/*/status` endpoint reports `enabled: false`, and the SPA hides that
surface — nothing else is affected.

### Zabbix

| Variable | Default | Purpose |
|---|---|---|
| `ZABBIX_API_URL` | `https://zabbix-api.example.com/api_jsonrpc.php` | Upstream JSON-RPC endpoint the gateway calls to verify item/host permissions for the session token it was given. |

### InfluxDB (optional — time-series fast path)

| Variable | Default | Purpose |
|---|---|---|
| `INFLUX_URL` | *(empty)* | InfluxDB 2.x base URL. Leave empty to disable the Influx path entirely. |
| `INFLUX_TOKEN` | *(empty)* | InfluxDB API token. Never exposed to the browser. |
| `INFLUX_ORG` | *(empty)* | InfluxDB organization. |
| `INFLUX_BUCKET` | `zabbix` | Bucket populated by the `effluence` export (measurements `history`/`history_uint`, tag `itemid`). |

`INFLUX_URL`, `INFLUX_TOKEN`, and `INFLUX_ORG` must **all** be set for the
Influx path to be considered enabled. See
[docs/timeseries-sources.md](./timeseries-sources.md) for why this path is
recommended once dashboards get dense or ranges get long.

### Graylog (optional — log panels)

| Variable | Default | Purpose |
|---|---|---|
| `GRAYLOG_URL` | *(empty)* | Graylog base URL, e.g. `https://graylog.example.de`. Leave empty to disable the logs feature entirely. |
| `GRAYLOG_TOKEN` | *(empty)* | Read-only Graylog API token (no write, no user administration). |
| `GRAYLOG_VERIFY_TLS` | `true` | Verify TLS certificates when calling Graylog. |
| `GRAYLOG_DEFAULT_STREAMS` | *(empty)* | Optional CSV of stream IDs to restrict what auzui offers; empty means all streams the token can see. |
| `GRAYLOG_SOURCE_FIELD` | `source` | Field name Graylog stores the sender hostname in, if a pipeline uses something other than the default `source`. |
| `GRAYLOG_BEARER_AUTH` | `false` | Graylog API tokens normally authenticate as HTTP Basic `token:token`; set this if a proxy in front of Graylog expects a `Bearer` header instead. |

`GRAYLOG_URL` and `GRAYLOG_TOKEN` must both be set for the logs path to be
enabled. See `PLAN.md` section H for the host → Graylog `source` mapping
heuristic.

### Serving the frontend from the gateway

| Variable | Default | Purpose |
|---|---|---|
| `AUZUI_SERVE_FRONTEND` | `false` | If true and `FRONTEND_DIR` is a directory, the gateway serves the built SPA itself (single container, single origin — no separate static server needed). |
| `FRONTEND_DIR` | `/app/static` | Path to the built `frontend/dist` output, mounted or copied into the gateway's container. |

### CORS

| Variable | Default | Purpose |
|---|---|---|
| `CORS_ORIGINS` | *(empty)* | CSV of allowed origins. Empty disables the CORS middleware entirely — set this when the SPA is served from a different origin than the gateway (e.g. during development, or a CDN-fronted deployment). Not needed when `AUZUI_SERVE_FRONTEND` serves the SPA from the same origin. |

## nginx reverse-proxy pattern

A typical deployment puts nginx in front, terminating TLS (and optionally
SPNEGO/Kerberos, matching the existing Zabbix-web setup) and routing:

```nginx
server {
    listen 443 ssl;
    server_name auzui.example.de;

    # Static SPA (or proxied to auzui-gateway if AUZUI_SERVE_FRONTEND=true)
    location / {
        proxy_pass http://127.0.0.1:8080;
    }

    # Optional gateway API surface (Influx/Graylog)
    location /api/ {
        proxy_pass http://127.0.0.1:8080/api/;
        proxy_set_header Host $host;
    }

    # Existing headless Zabbix API, unchanged
    location /zabbix-api/ {
        proxy_pass http://zabbix-web-nginx-pgsql/api_jsonrpc.php;
    }
}
```

If `auzui-gateway` serves the built frontend itself
(`AUZUI_SERVE_FRONTEND=true`), nginx only needs a single `proxy_pass` to
the gateway container and no separate static file server.

## Planned Puppet deployment

A Puppet-managed deployment on **`docker-virt6`** under
**`auzui.example.com`** is planned, mirroring how the existing Zabbix
stack (and other Cygnus Networks services) are rolled out on that host:
containerized `auzui-gateway` (+ optionally the SPA, via
`AUZUI_SERVE_FRONTEND`) behind the shared nginx/SPNEGO front end, with
Influx/Graylog variables sourced from the existing `docker-zabbix`
credentials where applicable. Not yet implemented — tracked as a follow-up
once the frontend/gateway reach a deployable milestone.
