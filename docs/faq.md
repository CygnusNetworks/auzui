# FAQ

### Do I need to replace or reconfigure my existing Zabbix installation?

No. auzui runs **next to** the existing Zabbix web UI and talks to it purely
through its documented JSON-RPC API (`api_jsonrpc.php`). Configuration,
administration, templates, and users all stay in the classic Zabbix UI — see
the [clean-room statement](../README.md#clean-room-statement). No Zabbix
server-side configuration is required beyond having the JSON-RPC endpoint
reachable and a user account to log in with.

### Why don't I see any charts / why are charts slow?

Charts always work through the Zabbix API path (`history.get`/`trend.get`)
by default — no configuration needed. If they're missing entirely, check
`GET /health` on the gateway for `"influx": false` (expected without
`INFLUX_URL`/`INFLUX_TOKEN`/`INFLUX_ORG` set) and confirm the frontend can
reach `api_jsonrpc.php` at all. For long ranges and dense dashboards,
consider configuring the optional InfluxDB source — see
[timeseries-sources.md](timeseries-sources.md).

### Why is the Logs panel missing / empty?

The `/logs` route and every host-detail log tab are hidden entirely unless
`auzui-gateway` has Graylog configured (`GRAYLOG_URL`+`GRAYLOG_TOKEN`, or
`GRAYLOG_SERVERS`) — check `GET /api/logs/status` for `enabled: false`. If
logs are enabled but a specific host shows nothing, the gateway may not be
able to derive a matching Graylog `source` for that host (technical name,
visible name, interface DNS/IP — see [logs.md](logs.md#host-scoped-log-queries)),
or `GRAYLOG_DEFAULT_STREAMS` may be scoped too narrowly to include the
stream that host's logs actually land in.

### What Zabbix version do I need?

Zabbix ≥ 6.4, since auzui relies on the Bearer-token session model for its
JSON-RPC calls. Older versions using only cookie-based sessions are not
supported.

### What permissions do I need in Zabbix?

Whatever your Zabbix user already has. auzui enforces **no additional
permission model** of its own for Problems/Hosts/Latest Data/dashboards — it
is a thin client over the same JSON-RPC methods the classic UI uses, so
visibility follows your existing Zabbix user/host-group permissions exactly.
The one place this differs is Graylog log search, which is **not** scoped by
Zabbix host permissions — see
[authentication.md — authorization model](authentication.md#authorization-model)
for the full breakdown by endpoint.

### Is auzui a Grafana replacement?

No — different job. Grafana is a general-purpose dashboarding/visualization
tool you configure panel-by-panel against many possible data sources. auzui
is a purpose-built **monitoring workflow UI for Zabbix specifically**
(Problems triage, host deep-dives, topology, metric browsing) that derives
its dashboards automatically from what Zabbix already knows — no manual
panel configuration. If you want general-purpose, source-agnostic
dashboards, keep using Grafana alongside auzui; they solve different
problems.

### Does auzui store any data of its own?

Only two small, optional pieces of local state on the gateway: the saved
log filter sets (`FILTER_SETS_PATH`, a JSON file) and short-lived in-memory
permission/session caches (`PERMISSION_CACHE_TTL`,
`HOST_MAPPING_CACHE_TTL`). Everything else — problems, hosts, items,
history, dashboards — is read live from Zabbix (and optionally InfluxDB/
Graylog) on every request; there is no auzui database.

### Where is my session token stored, and is that safe?

In the browser's `sessionStorage` (not `localStorage`, not a cookie) — it
does not survive closing the tab and is never sent automatically to other
origins. See [authentication.md — session storage](authentication.md#session-storage-in-the-frontend)
for the full reasoning and why the reverse-proxy CSP hardening in
[deployment.md](deployment.md) matters here.

### Which browsers are supported?

Any current evergreen browser (Chrome/Edge, Firefox, Safari) with ES2020+
and native Kerberos/SPNEGO handshake support in the network stack if you use
SPNEGO SSO. auzui is a modern Vite/React 19 SPA with no legacy-browser
build target.

### Can I run auzui without `auzui-gateway` at all?

Yes. Without the gateway (or with it running but Influx/Graylog left
unconfigured), the SPA talks straight to `api_jsonrpc.php` and every core
monitoring workflow — Problems, Hosts, Latest Data, Explorer, Topology,
Metrics, Web Scenarios, command palette — works normally. You lose only the InfluxDB fast
path and Graylog log panels, and (if you were relying on it)
`AUZUI_SERVE_FRONTEND`'s single-container serving. See
[getting-started.md](getting-started.md#what-works-without-auzui-gateway).

### How do I follow the project's direction?

[PLAN.md](../PLAN.md) is the living design specification; releases are
tagged (`v*`) and each tag publishes a multi-arch image to
[ghcr.io/cygnusnetworks/auzui](https://github.com/cygnusnetworks/auzui/pkgs/container/auzui).
