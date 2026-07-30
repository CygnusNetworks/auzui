# auzui documentation

**Product site & live demo:** [cygnusnetworks.github.io/auzui](https://cygnusnetworks.github.io/auzui/)
([interactive demo](https://cygnusnetworks.github.io/auzui/demo/)).

## Getting started

| Document | Content |
|---|---|
| [getting-started.md](getting-started.md) | Prerequisites, `docker compose` quickstart, first steps in the UI, what works without the gateway |
| [architecture.md](architecture.md) | Components, data flow, the `TimeseriesSource`/`LogSource` abstractions |
| [development.md](development.md) | Repo layout, local setup (pnpm + uv), lint/test/build commands, demo mode |

## Configuration and operations

| Document | Content |
|---|---|
| [configuration.md](configuration.md) | Full reference of every `auzui-gateway` environment variable |
| [deployment.md](deployment.md) | nginx reverse-proxy pattern, TLS/security headers, security notes |
| [authentication.md](authentication.md) | Password login, SPNEGO/Kerberos SSO, session handling, authorization model |

## Feature deep-dives

| Document | Content |
|---|---|
| [timeseries-sources.md](timeseries-sources.md) | Zabbix API vs. InfluxDB source selection, effluence schema, Flux query reference |
| [logs.md](logs.md) | Graylog integration: multi-server fan-out, cross-server dedup, filter chips, saved filter sets |

## Reference

| Document | Content |
|---|---|
| [faq.md](faq.md) | Common questions: why no graphs/logs, relation to the Zabbix UI and Grafana, permissions, browser support |

Root-level documents outside `docs/`: [README.md](../README.md) (project overview), [PLAN.md](../PLAN.md)
(original design plan), [NOTICE.md](../NOTICE.md) (clean-room statement and trademarks), [LICENSE](../LICENSE)
(AGPL-3.0-only).
