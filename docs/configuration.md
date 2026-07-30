# Configuration reference

Full reference of every `auzui-gateway` environment variable. The gateway
reads its settings from process environment variables (or a `.env` file next
to it — see `.env.example` at the repo root); the source of truth is
[`services/gateway/src/auzui_gateway/config.py`](../services/gateway/src/auzui_gateway/config.py).
Names are case-insensitive.

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
See [timeseries-sources.md](timeseries-sources.md) for measured latency and
when this path is worth setting up.

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
