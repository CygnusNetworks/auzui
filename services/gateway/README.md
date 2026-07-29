# auzui-gateway

Small FastAPI service in front of the optional auzui data paths:

- `/api/ts/*` — InfluxDB (effluence schema) time-series queries with
  server-side `aggregateWindow` downsampling. The Influx token stays here;
  the caller's Zabbix session token is used to verify `item.get` permission
  for every requested item.
- `/api/logs/*` — Graylog streams + searches (read-only). The Graylog token
  stays here; host-scoped searches verify `host.get` permission and resolve
  the Zabbix host → syslog `source` mapping automatically.
- Optionally serves the built SPA (`AUZUI_SERVE_FRONTEND=1`).

Both integrations are feature-gated: without URL+token configured, the
status endpoints report `enabled: false` and the SPA hides the surfaces.

See `docs/deployment.md` in the repo root for configuration.
