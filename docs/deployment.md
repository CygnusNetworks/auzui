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

### Docker (optional — container management)

| Variable | Default | Purpose |
|---|---|---|
| `DOCKER_HOSTS` | *(empty)* | JSON array of Docker Engines to manage. Leave empty to disable the feature entirely. Full schema: [docs/configuration.md](./configuration.md#docker_hosts-schema). |
| `DOCKER_REGISTRIES` | *(empty)* | JSON array of registry credentials for the update checker. Registries not listed (e.g. Docker Hub) are queried anonymously. |
| `DOCKER_TIMEOUT` | `10.0` | HTTP/SSH timeout (seconds) per Docker host call. |
| `DOCKER_CACHE_TTL` | `10.0` | Cache lifetime (seconds) for the host summary and container list. |
| `DOCKER_STATS_CACHE_TTL` | `5.0` | Cache lifetime (seconds) for bulk container stats. |
| `DOCKER_UPDATE_CHECK_TTL` | `3600.0` | Cache lifetime (seconds) for a resolved registry digest. |
| `DOCKER_SSH_KNOWN_HOSTS` | *(empty)* | Path to a `known_hosts` file (read-only mount) used to verify `ssh://` hosts' keys. Required for any `ssh://` entry in `DOCKER_HOSTS`. |

`DOCKER_HOSTS` must contain at least one valid entry for the Docker path to
be enabled. See [docs/configuration.md](./configuration.md#docker-integration)
for the full host schema, the three connection variants, and the
authorization model, and the section below for how to deploy each variant.

### Config file (optional — alternative to the variables above)

Any variable on this page can instead be set via a mounted TOML/YAML file
(`AUZUI_CONFIG_FILE`, or one of the default search paths) — precedence is
ENV > `.env` > config file > default, so this never changes the behavior of
an existing ENV-only deployment. See
[docs/configuration.md](./configuration.md#configuration-files-tomlyaml)
for the full schema; example files:
[`examples/auzui.toml`](../examples/auzui.toml) /
[`examples/auzui.yaml`](../examples/auzui.yaml).

```yaml
services:
  auzui:
    # ...
    environment:
      AUZUI_CONFIG_FILE: /config/auzui.toml
    volumes:
      - ./auzui.toml:/config/auzui.toml:ro
```

`.toml` files need no extra dependency; `.yaml`/`.yml` needs the gateway's
`yaml` extra installed — already included in the official image alongside
the `docker` extra (see the `Dockerfile`'s `uv sync ... --extra docker
--extra yaml`). A custom build that only ever uses TOML can drop the `yaml`
extra to save the PyYAML dependency.

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

## Deploying the Docker plugin

The Docker integration (`DOCKER_HOSTS`, see
[docs/configuration.md](./configuration.md#docker-integration)) connects to
each Docker Engine one of three ways; how you deploy it depends on which
variant a given host uses.

### Socket-proxy sidecar (recommended default)

For a host reached over `http://`/`https://`, do not point `DOCKER_HOSTS`
directly at `/var/run/docker.sock` or an unauthenticated TCP socket. Put
[`tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy)
in front of it as a sidecar, and point the `DOCKER_HOSTS` entry's `url` at
the proxy instead. A read-only deployment (`CONTAINERS=1 POST=0`) is the
safe default — the proxy itself rejects every write with `403`/`405`, which
the gateway surfaces as a clean "read-only upstream" error even if a host's
`readonly` flag were left `false` by mistake:

```yaml
services:
  auzui:
    # ...
    environment:
      DOCKER_HOSTS: >-
        [{"id":"prod-a","label":"prod-a","url":"http://docker-socket-proxy:2375","readonly":true}]

  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy:latest
    restart: unless-stopped
    environment:
      # Read-only: only the endpoints Docker container management actually
      # needs, and no writes at all.
      CONTAINERS: 1
      IMAGES: 1
      NETWORKS: 1
      VOLUMES: 1
      INFO: 1
      VERSION: 1
      POST: 0
      # To allow actions (start/stop/restart, pull/recreate) through this
      # host: set POST: 1 here AND readonly: false on its DOCKER_HOSTS
      # entry. The gateway still requires a Zabbix Admin/Super Admin caller
      # on top of that — see the authorization model in configuration.md.
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    # No published ports: only auzui reaches it, over the compose network.
```

Run one socket-proxy sidecar per Docker host you manage this way (on that
host's own Docker daemon), each with its own `DOCKER_HOSTS` entry pointing
at it.

### TCP + mutual TLS

For a host with `dockerd --tlsverify` enabled, mount the CA certificate,
client certificate, and client key **read-only** into the gateway container
and point `tls_ca`/`tls_cert`/`tls_key` at their in-container paths:

```yaml
services:
  auzui:
    # ...
    volumes:
      - ./certs/db1:/certs/db1:ro
    environment:
      DOCKER_HOSTS: >-
        [{"id":"db-1","url":"tcp://10.0.0.5:2376",
          "tls_ca":"/certs/db1/ca.pem","tls_cert":"/certs/db1/cert.pem","tls_key":"/certs/db1/key.pem"}]
```

### `ssh://` (also required for Compose support)

An `ssh://` host is the only variant that supports the Compose
`pull`/`up`/`restart` actions (`compose: true`), since it's the only one
with a real shell behind it. It needs its private key and a `known_hosts`
file mounted **read-only** — the gateway's own container runs `read_only`,
so it can never write these itself, and host-key verification always
enforces paramiko's `RejectPolicy` against the mounted `known_hosts` (never
`AutoAddPolicy`, i.e. an unrecognized host key fails the connection instead
of being trusted on first use):

```yaml
services:
  auzui:
    # ...
    volumes:
      - ./ssh/edge_ed25519:/keys/edge_ed25519:ro
      - ./ssh/known_hosts:/config/ssh/known_hosts:ro
    environment:
      DOCKER_SSH_KNOWN_HOSTS: /config/ssh/known_hosts
      DOCKER_HOSTS: >-
        [{"id":"edge","url":"ssh://deploy@edge.example.com","ssh_key":"/keys/edge_ed25519",
          "zabbix_host":"edge.example.com","compose":true}]
```

Populate `known_hosts` the normal way (`ssh-keyscan edge.example.com >>
known_hosts`, verified out of band) before mounting it — it is the entire
trust anchor for that host's connection.

### Image extras

The official image (`ghcr.io/cygnusnetworks/auzui`, `cygnusnetworks/auzui`)
is already built with the `docker` extra (`docker>=7`, `paramiko>=3`) and
the `yaml` extra (PyYAML, for YAML config files) — no extra image
configuration is needed to use `DOCKER_HOSTS` or a `.yaml` config file. A
custom build that installs `auzui-gateway` itself needs
`pip install auzui-gateway[docker]` (add `,yaml` for YAML config-file
support); see the `Dockerfile`'s `uv sync ... --extra docker --extra yaml`
for the exact invocation.

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

### Docker host visibility is coarse-grained

Any authenticated Zabbix session may list every host configured in
`DOCKER_HOSTS` and see its containers, inspect data, logs, stats, and
update status via `/api/docker/*` — Docker hosts are not mapped to Zabbix
host permissions the way `/api/ts` (per-item) or `/api/logs/host`
(per-host) are, because docker-py/the socket proxy have no concept of a
Zabbix host/item at all. Do not put a host in `DOCKER_HOSTS` that some
Zabbix users should not even know exists. Write actions (start/stop/
restart, pull/recreate, compose pull/up/restart) narrow further: they
require a Zabbix Admin/Super Admin session **and** a non-`readonly` host —
see [docs/configuration.md](./configuration.md#authorization-model).

### Session revocation lag

The gateway caches "this token is a valid session" for
`PERMISSION_CACHE_TTL` seconds (default 300). A session revoked in Zabbix is
still accepted by the gateway for up to that window. Lower the TTL if you need
tighter revocation.

