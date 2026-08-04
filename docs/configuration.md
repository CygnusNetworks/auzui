# Configuration reference

Full reference of every `auzui-gateway` setting. The gateway reads its
settings from process environment variables (or a `.env` file next to it —
see `.env.example` at the repo root); the source of truth is
[`services/gateway/src/auzui_gateway/config.py`](../services/gateway/src/auzui_gateway/config.py).
Names are case-insensitive. Every setting below can **also** be set via an
optional TOML/YAML config file — see
[Configuration files (TOML/YAML)](#configuration-files-tomlyaml) — which is
an equally supported alternative to ENV, not a fallback of last resort.

Every integration is **feature-gated**: leave its variables empty and the
corresponding `/api/*/status` endpoint reports `enabled: false`, and the SPA
hides that surface entirely — nothing else is affected. See
[getting-started.md](getting-started.md#what-works-without-auzui-gateway) for
what still works with everything disabled.

## Zabbix (required)

| Variable | Default | Effect |
|---|---|---|
| `ZABBIX_API_URL` | `https://zabbix-api.example.com/api_jsonrpc.php` | Upstream JSON-RPC endpoint the gateway calls to validate session tokens and check item/host permissions (`user.get`, `item.get`, `host.get`). |
| `ZABBIX_WEB_URL` | *(empty → derived from `ZABBIX_API_URL`)* | Base URL of the Zabbix web frontend used for the SPNEGO SSO exchange (`index_http.php`). Only relevant when `SPNEGO_ENABLED=true`; see [authentication.md](authentication.md). Set this to a network-restricted vhost — see the security note below. |
| `ZABBIX_UI_URL` | *(empty → derived from `ZABBIX_API_URL`)* | User-facing Zabbix UI base URL, used for "open in old UI" links in the SPA (`GET /api/config`). May differ from `ZABBIX_WEB_URL` when the SSO exchange goes through a separate, IP-restricted vhost. |

## Build provenance

| Variable | Default | Effect |
|---|---|---|
| `AUZUI_VERSION` | *(empty → package version)* | Injected as a Docker build arg (see `Dockerfile`/CI). Surfaced via `GET /api/config` and `GET /health`. |
| `AUZUI_GIT_SHA` | *(empty)* | Same mechanism; `GET /api/config` returns the first 10 characters. |

## Kerberos / SPNEGO SSO (optional)

| Variable | Default | Effect |
|---|---|---|
| `SPNEGO_ENABLED` | `false` | Enables `GET /api/auth/spnego` and makes `GET /api/auth/methods` report `spnego: true`, so the SPA offers transparent Kerberos login. Requires the gateway image built with the `kerberos` extra (`gssapi`). |
| `KRB5_KTNAME` | *(empty)* | Path to the Kerberos keytab file used to validate incoming Negotiate tokens. Exported into the process environment before each SPNEGO negotiation. |

Full flow: [authentication.md](authentication.md).

## InfluxDB (optional — time-series fast path)

| Variable | Default | Effect |
|---|---|---|
| `INFLUX_URL` | *(empty)* | InfluxDB 2.x base URL. |
| `INFLUX_TOKEN` | *(empty)* | InfluxDB API token. Never exposed to the browser. |
| `INFLUX_ORG` | *(empty)* | InfluxDB organization. |
| `INFLUX_BUCKET` | `zabbix` | Bucket populated by the `effluence` export (measurements `history`/`history_uint`, tag `itemid`). |
| `INFLUX_MIN_WINDOW_SECONDS` | `60` | Minimum `aggregateWindow` size in seconds. Downsampling never uses a finer window, so every item in a multi-series query shares one time grid (whole-minute boundaries by default); a finer window scatters items sampled a few seconds apart onto non-coinciding timestamps, which renders as a blank chart for short ranges. Match this to the smallest item poll interval you actually chart. |
| `INFLUX_TIMEOUT` | `10.0` | HTTP timeout (seconds) for Influx queries. |

`INFLUX_URL`, `INFLUX_TOKEN`, and `INFLUX_ORG` must **all** be set for
`influx_enabled` to be true and `/api/ts/status` to report `enabled: true`.
See [timeseries-sources.md](timeseries-sources.md) for when this path is
worth setting up.

## Graylog (optional — log panels)

| Variable | Default | Effect |
|---|---|---|
| `GRAYLOG_URL` | *(empty)* | Single-server Graylog base URL, e.g. `https://graylog.example.de`. Legacy/simple form — see `GRAYLOG_SERVERS` below for multi-server setups. |
| `GRAYLOG_TOKEN` | *(empty)* | Read-only Graylog API token for the single-server form (no write, no user administration). |
| `GRAYLOG_SERVERS` | *(empty)* | Multiple Graylog backends as a **JSON array**, one object per server: `[{"id":"gl-a","label":"graylog-a","url":"https://a.example.com","token":"..."}, ...]`. `id` and `label` are optional (default to `gl-<index>` and the URL's hostname); `url` and `token` are required per entry — an entry missing either is skipped with a logged warning. **Takes precedence over `GRAYLOG_URL`/`GRAYLOG_TOKEN`** when non-empty; malformed JSON is logged and ignored (falls through to the legacy single-server variables, or disables Graylog if those are empty too). |
| `GRAYLOG_VERIFY_TLS` | `true` | Verify TLS certificates when calling Graylog (applies to every configured server). |
| `GRAYLOG_DEFAULT_STREAMS` | *(empty)* | CSV of stream IDs to restrict what auzui offers/searches; empty means all streams the token(s) can see. Also used as the default `filter` on searches that don't specify `stream_ids` explicitly. |
| `GRAYLOG_SOURCE_FIELD` | `source` | Graylog field name holding the sender hostname, if a pipeline uses something other than the default `source`. Used both for host-scoped log queries and the `source` filter chip. |
| `GRAYLOG_BEARER_AUTH` | `false` | Graylog API tokens normally authenticate as HTTP Basic `token:token`; set this if a proxy in front of Graylog expects an `Authorization: Bearer` header instead. Applies to every configured server. |
| `GRAYLOG_TIMEOUT` | `15.0` | HTTP timeout (seconds) per Graylog server call. |
| `LOG_DEDUP_ENABLED` | `false` | Gates cross-server log deduplication (only relevant with more than one Graylog server): a host logging to several servers at once otherwise produces the same line once per server. Also gates the frontend's "merge duplicates" toggle, exposed via `GET /api/logs/servers` → `dedup_enabled`. |
| `LOG_DEDUP_WINDOW_SECONDS` | `2.0` | Max arrival-time spread (seconds) between servers that still counts as "the same line" for dedup. Keep small so genuine periodic repeats (e.g. a cron line every 60s) survive. See [logs.md](logs.md) for the full watermark algorithm. |

`graylog_enabled` (and therefore `/api/logs/status` → `enabled: true`)
requires either a non-empty, valid `GRAYLOG_SERVERS` array, or both
`GRAYLOG_URL` and `GRAYLOG_TOKEN`. Full integration details, including the
multi-server fan-out and dedup algorithm: [logs.md](logs.md).

## Saved filter sets

| Variable | Default | Effect |
|---|---|---|
| `FILTER_SETS_PATH` | `/data/log-filter-sets.json` | JSON file backing team-wide saved log filter sets (`/api/logs/filter-sets`). The gateway container runs `read_only`, so this **must** point at a writable mount (a Docker volume or tmpfs at `/data`). If the directory is not writable, the store degrades to read-only/empty (listing works, create/update/delete return `503`) instead of crashing the gateway. |

## Timeouts and caches

| Variable | Default | Effect |
|---|---|---|
| `ZABBIX_TIMEOUT` | `15.0` | HTTP timeout (seconds) for calls to `api_jsonrpc.php`. |
| `PERMISSION_CACHE_TTL` | `300` | How long (seconds) the gateway caches "this session token is valid" / "this item is visible to this token" results. A session revoked in Zabbix is still accepted by the gateway for up to this window — lower it for tighter revocation. |
| `HOST_MAPPING_CACHE_TTL` | `600` | How long (seconds) the gateway caches a resolved host identity (used for host-scoped log source mapping). |

## Serving the frontend from the gateway

| Variable | Default | Effect |
|---|---|---|
| `AUZUI_SERVE_FRONTEND` (alias: `SERVE_FRONTEND`) | `false` | If true and `FRONTEND_DIR` is a directory, the gateway serves the built SPA itself (single container, single origin — no separate static file server needed). |
| `FRONTEND_DIR` | `/app/static` | Path to the built `frontend/dist` output, mounted or copied into the gateway's container. |

## CORS

| Variable | Default | Effect |
|---|---|---|
| `CORS_ORIGINS` | *(empty)* | CSV of allowed origins. Empty disables the CORS middleware entirely — set this when the SPA is served from a different origin than the gateway (e.g. local development, or a CDN-fronted deployment). Not needed when `AUZUI_SERVE_FRONTEND` serves the SPA from the same origin. **A literal `*` is refused**: the gateway logs a warning and leaves CORS disabled rather than honour a wildcard origin, which would otherwise turn it into an open cross-origin endpoint for any site a victim visits. Use an explicit, comma-separated origin list instead. |

## Docker (optional — container management)

| Variable | Default | Effect |
|---|---|---|
| `DOCKER_HOSTS` | *(empty)* | Docker Engines the gateway can manage, as a **JSON array** — see [`DOCKER_HOSTS` schema](#docker_hosts-schema) below. Empty disables the whole feature: `/api/docker/status` reports `enabled: false`, every `/api/docker/*` data route 404s, and the SPA hides the Docker nav entry. |
| `DOCKER_REGISTRIES` | *(empty)* | Registry credentials the update-checker authenticates against, as a JSON array: `[{"registry":"ghcr.io","username":"...","token":"..."}]`. Registries not listed here (notably Docker Hub) are queried anonymously. `username`/`token` are optional per entry. |
| `DOCKER_TIMEOUT` | `10.0` | HTTP/SSH timeout (seconds) for calls to a Docker host (docker-py client construction, API calls, `exec_ssh`). |
| `DOCKER_CACHE_TTL` | `10.0` | Cache lifetime (seconds) for the host summary (`/api/docker/hosts`) and container list (`/api/docker/containers`). |
| `DOCKER_STATS_CACHE_TTL` | `5.0` | Cache lifetime (seconds) for bulk container stats (`POST /api/docker/stats`). |
| `DOCKER_UPDATE_CHECK_TTL` | `3600.0` | Cache lifetime (seconds) for a resolved registry digest, keyed per `(registry, repo, tag)`. Kept high to stay gentle on registry rate limits (notably Docker Hub's anonymous pull quota). |
| `DOCKER_SSH_KNOWN_HOSTS` | *(empty)* | Path to a `known_hosts` file (read-only mount) used to verify every `ssh://` host's key via paramiko's `RejectPolicy` — **never** `AutoAddPolicy`. Required for any `ssh://` entry in `DOCKER_HOSTS`; connecting without it raises an error rather than silently trusting an unknown host key. |

`docker_enabled` (and therefore `/api/docker/status` → `enabled: true`)
requires at least one valid entry in `DOCKER_HOSTS`. Full schema, connection
variants, and the permission model: [Docker integration](#docker-integration)
below.

## Configuration files (TOML/YAML)

Besides environment variables, the gateway can load its settings from a
single **TOML or YAML file** — an equally supported alternative to ENV, not
a Docker-only mechanism. A config file can set **any** field documented on
this page, not just the Docker ones. This is implemented in
[`config_file.py`](../services/gateway/src/auzui_gateway/config_file.py) as
an additional `pydantic-settings` source.

### File selection

| Variable | Default | Effect |
|---|---|---|
| `AUZUI_CONFIG_FILE` | *(empty)* | Path to the config file to load. If set and the file does not exist, the gateway **fails to start** with a `RuntimeError` — an explicitly requested config file is never silently skipped. |

If `AUZUI_CONFIG_FILE` is unset, the gateway tries the following paths in
order and loads the first one that exists; if none exist, it simply falls
back to ENV/`.env`/defaults as before:

1. `/config/auzui.toml`
2. `/config/auzui.yaml`
3. `/config/auzui.yml`
4. `./auzui.toml`
5. `./auzui.yaml`
6. `./auzui.yml`

The format is picked from the file extension: `.toml` is parsed with the
Python standard library's `tomllib` (no extra dependency); `.yaml`/`.yml` is
parsed with PyYAML's `safe_load`. **PyYAML is an optional dependency** —
extra `yaml` in `services/gateway/pyproject.toml` — imported lazily only
when a YAML file is actually loaded, so a `.toml`-only deployment never
needs it installed. It **is** included in the official image (`docker` +
`yaml` extras, see the `Dockerfile`), so both formats work out of the box
there. Loading a `.yaml`/`.yml` file without the `yaml` extra installed
raises `RuntimeError: YAML config requires the 'yaml' extra: pip install
auzui-gateway[yaml]`. A syntax error in either format, or an unsupported
file extension, also raises a `RuntimeError` naming the file and the cause —
there is no silent fallback to defaults on a broken file.

### Precedence: ENV > `.env` > config file > default

```
ENV variable  >  .env file  >  config file  >  field default
```

ENV stays the highest-precedence override channel on purpose: existing
Compose/Kubernetes deployments that already set variables keep behaving
exactly as before, and a config file mounted as a per-environment default
can still be overridden per-variable without editing the file (e.g. bumping
`ZABBIX_TIMEOUT` for one environment via a single env var on top of an
otherwise shared config file).

### Schema: flat or nested, both at once

Keys may be given **flat** — the exact Settings field name — or **nested**
one level deep, where `[section]`/`section:` + a subkey are joined with `_`
into the field name (`[zabbix] api_url` → `zabbix_api_url`). This works
uniformly because almost every setting is already prefixed by its
integration. Both styles are accepted in the same file; if a flat key and a
nested key resolve to the same field, **the flat key wins**. Keys are
matched case-insensitively.

Full example covering Zabbix, InfluxDB, Graylog, and Docker — TOML:

```toml
zabbix_api_url = "https://zabbix.example.com/api_jsonrpc.php"
permission_cache_ttl = 300

[zabbix]
api_url = "https://zabbix.example.com/api_jsonrpc.php"
ui_url  = "https://zabbix.example.com"

[influx]
url = "http://influx:8086"
token = "influx-token"
org = "monitoring"

[graylog]
verify_tls = true

[[graylog.servers]]
id = "gl-a"
url = "https://graylog-a.example.com"
token = "graylog-token-a"

[docker]
timeout = 10.0
cache_ttl = 10.0
ssh_known_hosts = "/config/ssh/known_hosts"

[[docker.hosts]]
id = "prod-a"
url = "http://sockproxy-a:2375"
readonly = true

[[docker.hosts]]
id = "edge"
url = "ssh://deploy@edge.example.com"
ssh_key = "/config/ssh/edge_ed25519"
zabbix_host = "edge.example.com"
compose = true

[[docker.registries]]
registry = "ghcr.io"
username = "bot"
token = "registry-token"
```

The same configuration in YAML:

```yaml
zabbix_api_url: https://zabbix.example.com/api_jsonrpc.php
permission_cache_ttl: 300

zabbix:
  api_url: https://zabbix.example.com/api_jsonrpc.php
  ui_url: https://zabbix.example.com

influx:
  url: http://influx:8086
  token: influx-token
  org: monitoring

graylog:
  verify_tls: true
  servers:
    - id: gl-a
      url: https://graylog-a.example.com
      token: graylog-token-a

docker:
  timeout: 10.0
  cache_ttl: 10.0
  ssh_known_hosts: /config/ssh/known_hosts
  hosts:
    - id: prod-a
      url: http://sockproxy-a:2375
      readonly: true
    - id: edge
      url: ssh://deploy@edge.example.com
      ssh_key: /config/ssh/edge_ed25519
      zabbix_host: edge.example.com
      compose: true
  registries:
    - registry: ghcr.io
      username: bot
      token: registry-token
```

Runnable copies of both files: [`examples/auzui.toml`](../examples/auzui.toml)
and [`examples/auzui.yaml`](../examples/auzui.yaml).

### Structured values for JSON/CSV fields

A handful of fields are `str` on the `Settings` model because they hold a
pre-encoded JSON list (`graylog_servers`, `docker_hosts`,
`docker_registries`) or a CSV string (`cors_origins`,
`graylog_default_streams`) — see their table entries above and in
[Docker integration](#docker-integration). In a config file these may be
given as a **native list/table** instead (as in the examples above); the
config-file source re-serializes them to the exact string the field
expects (`json.dumps(...)` for the JSON fields, `",".join(...)` for the CSV
ones), so the existing `*_list` parser properties in `config.py` remain the
single place that parses that string, unchanged.

### Unknown keys and errors

- **Unknown key** (typo, or nesting deeper than one level): dropped with a
  `logger.warning` naming the key — it never prevents startup, but it also
  never silently takes effect.
- **Missing explicit `AUZUI_CONFIG_FILE`**, **broken TOML/YAML syntax**, or
  an **unsupported file extension**: all raise `RuntimeError` and the
  gateway refuses to start. A config file is either loaded correctly or the
  deployment fails loudly — never a silent partial config.
- **No file found** (no `AUZUI_CONFIG_FILE`, none of the default paths
  exist): not an error; Settings falls back to ENV/`.env`/defaults exactly
  as if the config-file feature did not exist.
- The file may be **read-only mounted** — the source only ever reads it.
- Startup logs exactly one info line, `loaded config file %s (%d
  settings)`, naming the path and the number of fields it set — **never**
  the values themselves, since a config file commonly holds secrets
  (tokens, credentials).

## Docker integration

Everything below documents `DOCKER_HOSTS`/`DOCKER_REGISTRIES` and the
resulting `/api/docker/*` surface in detail. See the table in
[Docker (optional — container management)](#docker-optional--container-management)
above for the remaining scalar settings.

### `DOCKER_HOSTS` schema

A JSON array, one object per Docker Engine the gateway should manage:

```jsonc
DOCKER_HOSTS='[
  {"id":"prod-a","label":"prod-a","url":"http://sockproxy-a:2375","readonly":true},
  {"id":"db-1","url":"tcp://10.0.0.5:2376",
   "tls_ca":"/certs/db1/ca.pem","tls_cert":"/certs/db1/cert.pem","tls_key":"/certs/db1/key.pem"},
  {"id":"edge","url":"ssh://deploy@edge.example.com","ssh_key":"/keys/id_ed25519",
   "zabbix_host":"edge.example.com","compose":true}
]'
```

| Field | Default | Effect |
|---|---|---|
| `id` | `dh-<index>` | Stable identifier used in every `/api/docker/*` URL and in `DOCKER_REGISTRIES`-independent responses. A duplicate `id` across entries drops the later entry with a logged warning. |
| `label` | `id` | Human-readable name shown in the SPA. |
| `url` | *(required)* | Connection URL — see [connection variants](#connection-variants) below. An entry without `url` is skipped with a logged warning, same shape as `GRAYLOG_SERVERS`. |
| `tls_ca` | `""` | Path to the CA certificate for TCP+mTLS hosts (read-only mount). |
| `tls_cert` | `""` | Path to the client certificate for TCP+mTLS hosts. Required together with `tls_key` if either is set; a host with only one of the two fails to connect with a clear error. |
| `tls_key` | `""` | Path to the client private key for TCP+mTLS hosts. |
| `ssh_key` | `""` | Path to the SSH private key for `ssh://` hosts (read-only mount). Optional — omit to rely on the SSH agent/default identity available to the gateway process. |
| `readonly` | `false` | When true, every write action (`POST /api/docker/containers/{host}/{cid}/action`, `POST /api/docker/stacks/{host}/{project}/action`) is rejected with `403`, regardless of the caller's Zabbix role. Set this for any host you only want visibility into. |
| `zabbix_host` | `""` | Optional Zabbix host name/id this Docker host corresponds to. When set, the SPA's container-detail Stats tab offers a deep link into that host's existing Zabbix/Influx metrics instead of (or alongside) the live Docker stats — no new time-series storage is added for Docker itself. |
| `compose` | `true` if `url` starts with `ssh://`, else `false` | Gates whether `/api/docker/stacks/{host_id}/{project}/action` (compose `pull`/`up`/`restart`) is available for this host. Compose operations run a real shell on the host (`docker compose ...` over SSH), which only an `ssh://` transport provides — TCP/socket-proxy hosts have no shell to run it in, so `compose` on those defaults to `false` and can only meaningfully be set `true` on an `ssh://` entry. |

### `DOCKER_REGISTRIES` schema

A JSON array of registry credentials the [update checker](#update-checking)
authenticates against:

```jsonc
DOCKER_REGISTRIES='[
  {"registry":"ghcr.io","username":"bot","token":"..."},
  {"registry":"registry.example.com","username":"bot","token":"..."}
]'
```

| Field | Default | Effect |
|---|---|---|
| `registry` | *(required)* | Registry hostname exactly as it appears in an image reference (e.g. `ghcr.io`, `registry.example.com`). An entry without it is skipped with a logged warning. |
| `username` | `""` | Basic-auth username exchanged for a registry Bearer token (standard Docker Registry v2 token flow). |
| `token` | `""` | Password/token for the above. Registries not listed here — notably Docker Hub (`registry-1.docker.io`) — are queried **anonymously**, which is sufficient for public images. |

### Connection variants

Each host in `DOCKER_HOSTS` is reached one of three ways, chosen by the
`url` scheme:

1. **`http://`/`https://` via a socket-proxy** — the recommended default.
   Point `url` at [`tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy)
   (or an equivalent) fronting the real `/var/run/docker.sock`, rather than
   exposing the Engine's TCP API directly. Run it with `CONTAINERS=1
   POST=0` for a **read-only** deployment — the proxy itself then rejects
   any write with `403`/`405`, which the gateway translates into a clean
   "the Docker upstream is read-only" error even if `readonly` were left
   `false` by mistake. Set `POST=1` (and the specific `*_POST` variables the
   actions you want require) only once you actually want `start`/`stop`/
   `restart`/`pull_recreate` to work through this host, and pair it with
   `readonly: false` on the corresponding `DOCKER_HOSTS` entry plus a
   Zabbix Admin/Super Admin caller (see [authorization](#authorization-model)
   below).
2. **`tcp://` with mutual TLS** — `tls_ca`/`tls_cert`/`tls_key` point at a
   CA cert, a client cert, and a client key mounted read-only into the
   gateway container. Requires the Docker Engine's TCP socket to be
   TLS-enabled (`dockerd --tlsverify ...`).
3. **`ssh://user@host`** — docker-py's own SSH transport, backed by
   paramiko; no `ssh` binary is required in the gateway image. This is the
   only variant that supports Compose operations (`compose: true`), because
   it is the only one with an actual remote shell behind it. Requires
   `DOCKER_SSH_KNOWN_HOSTS` to be set and mounted (see below) — an `ssh://`
   host configured without it refuses to connect rather than trust an
   unverified host key.

### `known_hosts` and SSH keys in the `read_only` container

The gateway container runs `read_only` (see [deployment.md](deployment.md)),
so anything an `ssh://` host needs — the `known_hosts` file
(`DOCKER_SSH_KNOWN_HOSTS`) and each host's `ssh_key` — must come from
**read-only bind mounts**, never be written by the gateway itself. Host-key
verification always uses paramiko's `RejectPolicy` against the mounted
`known_hosts` file — the gateway never falls back to `AutoAddPolicy`, so an
unrecognized or changed host key fails the connection instead of being
silently trusted. See [deployment.md](deployment.md) for the mount example.

### Update checking

`GET /api/docker/updates` compares each container's local image digest
(from `RepoDigests` in its inspect data) against the digest the registry
currently serves for the same tag, via a `HEAD` request to the registry's
v2 manifest endpoint — cheap, and gentle on rate limits (`DOCKER_UPDATE_CHECK_TTL`,
default one hour). A container whose image was never pulled from a registry
(built locally, no `RepoDigests`) reports `status: "unknown"` without any
network call.

### Authorization model

**Visibility is coarse-grained, like the Graylog caveat.** Any session
holding a valid Zabbix bearer token can list every host in `DOCKER_HOSTS`,
its containers, inspect data, logs, stats, and update status —
`/api/docker/*` has no concept of per-Zabbix-host or per-item permissions
(docker-py/the socket proxy don't map to a Zabbix object at all). Do not
put a Docker host in `DOCKER_HOSTS` that some Zabbix users should not even
know exists.

**Write actions narrow further**, on top of that coarse visibility:

- The caller's Zabbix session must resolve to role type **Admin or Super
  Admin** (`ZabbixClient.get_user_role_type`, cached for
  `PERMISSION_CACHE_TTL` seconds like other permission lookups) — plain
  Zabbix Users cannot start/stop/restart/pull-recreate a container or run a
  compose action, even against a host they can otherwise see.
- The target host must have `readonly: false`. A `readonly: true` host
  rejects every action with `403` regardless of the caller's role — this is
  the same guarantee a `CONTAINERS=1 POST=0` socket proxy already gives at
  the network layer, enforced again at the gateway so a proxy
  misconfiguration cannot silently open write access.
- Compose actions additionally require `compose: true` on the host (in
  practice, an `ssh://` host); any other host answers `404`/`403` for
  `/api/docker/stacks/{host_id}/{project}/action`.

`GET /api/docker/permissions` reports `{"can_act": bool}` so the SPA can
hide action buttons proactively — the server enforces the same rule
independently on every write request, so this is a UX affordance, not the
security boundary.

## Interactions and feature gates at a glance

- `INFLUX_URL`/`INFLUX_TOKEN`/`INFLUX_ORG` all set → `/api/ts/*` enabled,
  SPA prefers `InfluxSource` over `history.get`/`trend.get`.
- `GRAYLOG_SERVERS` (valid JSON, ≥1 usable entry) **or**
  `GRAYLOG_URL`+`GRAYLOG_TOKEN` → `/api/logs/*` enabled, log panels appear.
- `LOG_DEDUP_ENABLED=true` only has an observable effect once **more than
  one** Graylog server is actually configured and queried together.
- `SPNEGO_ENABLED=true` requires `KRB5_KTNAME` to point at a readable keytab
  and the gateway image to include the `kerberos` extra; also requires
  `ZABBIX_WEB_URL` (or the `ZABBIX_API_URL`-derived default) to reach a Zabbix
  frontend with HTTP-auth (`index_http.php`) enabled and trusted.
- `AUZUI_SERVE_FRONTEND=true` and `CORS_ORIGINS` are mutually exclusive in
  practice: same-origin serving needs no CORS middleware at all.
- `DOCKER_HOSTS` (valid JSON, ≥1 usable entry) → `/api/docker/*` enabled,
  the SPA's Docker nav entry appears. Write actions additionally require a
  Zabbix Admin/Super Admin session and a non-`readonly` host — see
  [Authorization model](#authorization-model).
- `AUZUI_CONFIG_FILE` (or a file at one of the default search paths) can set
  any variable on this page; ENV and `.env` still win over it per-field, so
  it never breaks an existing ENV-only deployment.
