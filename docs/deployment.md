# Deployment

auzui has two runtime pieces:

- **`frontend/`** — a static Vite build (plain HTML/CSS/JS), served either
  by any static web server / CDN, or by `auzui-gateway` itself
  (`AUZUI_SERVE_FRONTEND`, see below).
- **`services/gateway`** (`auzui-gateway`) — a small FastAPI service that
  provides the optional integrations: InfluxDB time-series, Graylog logs,
  and Kerberos/SPNEGO SSO. Without it, the SPA talks directly to the
  existing Zabbix `api_jsonrpc.php` endpoint with password login and
  everything else works normally.

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
SPNEGO/Kerberos, matching the existing Zabbix-web setup) and routing. The
snippet below is a **hardened** starting point — the security headers are not
optional in production:

```nginx
server {
    listen 443 ssl;
    server_name auzui.example.de;

    # --- Security headers -------------------------------------------------
    # HSTS: force HTTPS for a year (add ; preload only once you are sure).
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    # Clickjacking: auzui is never meant to be framed.
    add_header X-Frame-Options "DENY" always;
    add_header Content-Security-Policy "frame-ancestors 'none'" always;
    # No MIME sniffing, minimal referrer leakage.
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    # Content-Security-Policy is the most effective second line of defence for
    # the session token (kept in sessionStorage). The SPA is self-contained; a
    # strict policy works. Verify against your build, then tighten:
    #   add_header Content-Security-Policy "default-src 'self'; \
    #       script-src 'self'; style-src 'self' 'unsafe-inline'; \
    #       img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; \
    #       base-uri 'self'; object-src 'none'" always;

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

## Security notes

Read these before exposing auzui to users.

### SPNEGO SSO: isolate `index_http.php`

When `SPNEGO_ENABLED=true`, the gateway validates the browser's Kerberos
ticket and then mints a Zabbix session by calling the Zabbix frontend's
`index_http.php` with HTTP-Basic `username:x` — Zabbix trusts the
web-server-provided user, so the password is irrelevant. This means anyone
who can reach `index_http.php` directly can obtain a session for **any
username**. Therefore:

- `index_http.php` (the HTTP-auth vhost) **must not be reachable** from
  untrusted networks — restrict it to the gateway's source IP / an internal
  network segment. `ZABBIX_WEB_URL` may point at this restricted vhost while
  `ZABBIX_UI_URL` points at the user-facing one.
- Keep the gateway ↔ Zabbix hop on a trusted network; the Kerberos ticket
  validation is the only thing standing between a caller and a minted session.

### Log access is coarse-grained

Any authenticated Zabbix session may free-text search **every configured
Graylog stream** via `/api/logs/search` — Graylog streams are not mapped to
Zabbix host permissions (the per-host and per-item paths *are* permission
checked). Scope `GRAYLOG_DEFAULT_STREAMS` to the streams every auzui user is
allowed to read; do not enable Graylog against streams containing logs that
only a subset of your Zabbix users should see.

### Session revocation lag

The gateway caches "this token is a valid session" for
`PERMISSION_CACHE_TTL` seconds (default 300). A session revoked in Zabbix is
still accepted by the gateway for up to that window. Lower the TTL if you need
tighter revocation.

