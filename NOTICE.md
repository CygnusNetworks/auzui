# auzui — Licensing Notice

**auzui** ("A Usable Zabbix UI") is an **independent, clean-room
reimplementation** of a monitoring front end that talks to a Zabbix
installation over its documented **JSON-RPC API** (`api_jsonrpc.php`). It
contains **no Zabbix source code** of any kind — not copied, not adapted,
not vendored. auzui was built purely against the public API contract
(request/response shapes of `host.get`, `item.get`, `problem.get`,
`history.get`, `trend.get`, `trigger.get`, `user.login`, …) as documented by
Zabbix and observed via a live instance's API responses. The existing
Zabbix web UI (PHP) is treated as an opaque, already-installed backend
service — auzui runs next to it, not on top of it or forked from it.

## Licence overview

| Component | Licence |
|---|---|
| auzui as a whole (frontend, packages, gateway, docs, tooling) | **AGPL-3.0-only** — see [LICENSE](./LICENSE) |

There are currently no dual-licensed or third-party-licensed subtrees in
this repository (no Zabbix code is vendored, so no GPL exception carve-out
is needed the way tiqora needs one for Znuny/OTRS schema fixtures).

## Optional third-party integrations

auzui can optionally talk to InfluxDB (via an `effluence`-exported bucket)
and to Graylog through `services/gateway`. Both integrations are
feature-gated and off by default:

- **InfluxDB**: auzui only *reads* time-series data that a separately
  operated `effluence` export pipeline has already written to InfluxDB. No
  InfluxDB or effluence code is included in this repository.
- **Graylog**: auzui only *reads* streams and search results through
  Graylog's REST API using a read-only service token. No Graylog code is
  included in this repository.

## Trademarks

"Zabbix" is a registered trademark of **Zabbix LLC / SIA Zabbix**. auzui is
not affiliated with, endorsed by, or sponsored by Zabbix LLC/SIA. The name
is used solely to describe factual interoperability with the Zabbix JSON-RPC
API.

"Graylog" is a trademark of **Graylog, Inc.**; "InfluxDB" is a trademark of
**InfluxData, Inc.** auzui is not affiliated with, endorsed by, or sponsored
by either company. Both names are used solely to describe factual,
optional interoperability.

---

Copyright © 2026 Cygnus Networks GmbH. This notice is informational; in
case of conflict, the licence text referenced above is authoritative.
