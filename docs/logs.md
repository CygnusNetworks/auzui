# Logs (Graylog integration)

auzui's log panels are an optional feature backed by
[Graylog](https://graylog.org/)'s REST API, proxied and enriched by
`auzui-gateway`. Entirely feature-gated — without `GRAYLOG_URL`/
`GRAYLOG_TOKEN` (or `GRAYLOG_SERVERS`) configured, `/api/logs/status` reports
`enabled: false` and the SPA hides the `/logs` route and every host-detail
log tab. Source of truth:
[`services/gateway/src/auzui_gateway/graylog.py`](../services/gateway/src/auzui_gateway/graylog.py)
and [`frontend/src/features/logs/`](../frontend/src/features/logs/).

See also [authentication.md — authorization model](authentication.md#authorization-model)
for how log access differs from the per-item/per-host paths, and
[configuration.md](configuration.md#graylog-optional--log-panels) for every
Graylog-related environment variable.

## Multi-server fan-out

A single gateway can query **multiple independent Graylog servers** at once
(`GRAYLOG_SERVERS`, a JSON array — see
[configuration.md](configuration.md#graylog-optional--log-panels) for the
exact shape). `GraylogService` fans every request out to the selected
servers in parallel (`asyncio.gather`) and merges the results:

- `GET /api/logs/servers` returns `[{id, label}]` for every configured
  server (never tokens or URLs) plus `dedup_enabled` — the SPA uses this to
  offer a server picker.
- `GET /api/logs/streams` and `POST /api/logs/search`/`/host/{id}` accept an
  optional `servers: string[]` to restrict which servers are queried;
  omitted or referencing only unknown ids falls back to **all** configured
  servers.
- One server being unreachable **does not fail the whole request** — its
  error is collected into an `errors: [{server_id, error}]` array in the
  response and the other servers' results still come back. Only when
  *every* selected server fails does the endpoint raise a `502`.
- Merged results are sorted by timestamp descending and capped to `limit`;
  `total` is the **sum** of each server's reported total, so pagination
  across servers is approximate (an upper bound), while deep offsets stay
  monotonic.

## Cross-server deduplication (watermark approach)

When a host ships the same syslog line to more than one Graylog server at
once (e.g. redundant collectors), it comes back once per server with a
few-millisecond arrival-time spread. `LOG_DEDUP_ENABLED=true` collapses these
into a single row — but only when **more than one server is actually being
queried together** (`dedupe_active = log_dedup_enabled and dedupe and
len(clients) > 1`); with a single server it's a no-op.

**Content identity** (`_dedupe_key`) is `(source, application_name,
facility_num, level, message)` — independent of arrival time and which
server delivered it. Two messages merge only if they share this key **and**
come from *different* servers within `LOG_DEDUP_WINDOW_SECONDS` of each
other (default 2.0s). Deliberately **not** merged:

- repeats from the *same* server (those are genuine duplicate log lines, not
  a fan-out artifact);
- repeats outside the window (e.g. an identical cron line every 60s) — the
  window is kept small precisely so genuine periodic repeats survive.

### Why a watermark, not just "the newest N per server, then dedup"

A naive "fetch `limit` rows per server, merge, dedup" breaks on dense bursts:
if two servers each return their own newest `limit` rows, but tie-break
differently at the boundary (sub-millisecond timestamp differences), a
message's counterpart on the other server can fall just outside that
server's page — so it never gets the chance to merge, and shows up
un-deduplicated.

The gateway instead computes a **watermark**: for any server whose fetch was
*truncated* (returned exactly the requested `fetch_limit` rows), its oldest
returned timestamp is a per-server *cutoff* — everything strictly newer than
`max(cutoffs) + LOG_DEDUP_WINDOW_SECONDS` is guaranteed to be present on
every server that was actually truncated, and therefore safe to dedup
without risking a missed cross-server counterpart. Only messages at or above
this watermark are deduplicated and counted toward the page; if that isn't
enough to fill `offset + limit`, the fetch window doubles
(`DEDUP_FETCH_PAD` headroom, capped at `MAX_DEDUP_FETCH = 2000`) and the
gateway retries. If the cap is hit before the page fills, it falls back to a
best-effort dedup over everything fetched so far rather than blocking
indefinitely — a few un-merged edge rows beat an arbitrarily truncated page.

## Filter chips and Lucene escaping

Log rows offer clickable include/exclude filters on `source`, `facility`,
and `application_name` (`LogFilterModel` in `app.py`). The gateway combines
these with the caller's free-text query into one Lucene query string
(`apply_filters` in `graylog.py`):

- Same-field filters group with `OR`; different fields combine with `AND`.
- Exclude filters become `NOT (...)` around the whole OR-group, so "exclude
  A, exclude B" reads as "neither A nor B" rather than "not both A and B".
- Every filter value is escaped for safe embedding in a Lucene quoted phrase
  (`escape_lucene_value`): backslash and the closing double-quote are the
  only characters that can break out of a `field:"<value>"` phrase, so
  escaping just those two keeps the value human-readable in the query bar
  while preventing query injection.

## Host-scoped log queries

`POST /api/logs/host/{hostid}` resolves a Zabbix host into a Graylog
`source` query (`build_host_query`) using, in priority order: the host's
technical name, its visible name (if different), then every interface's DNS
name, then every interface's IP — OR'd together against
`GRAYLOG_SOURCE_FIELD` (default `source`). Zabbix host visibility gates this
endpoint via `host.get` with the caller's token (see
[authentication.md](authentication.md#authorization-model)).

An optional `extra_query` (additional Lucene fragment from the UI) is
combined as `(<host aliases>) AND (<extra_query>)`. Because the host clause
is the actual scope boundary, `extra_query` is validated for balanced
parentheses first (`parens_balanced`) — an unbalanced prefix like `) OR (*`
could otherwise close the wrapper early and `OR` the host filter away
entirely, letting the query see logs from any host.

## Saved filter sets

The logs toolbar's full filter state (include/exclude chips, stream/server
selection, max level) can be saved as a named, team-wide **filter set**
(`services/gateway/src/auzui_gateway/filter_sets.py`), persisted as a single
JSON file at `FILTER_SETS_PATH` (default `/data/log-filter-sets.json` — must
be a writable mount, see [configuration.md](configuration.md#saved-filter-sets)).

- Every set has an `owner` (the Zabbix username behind the session token,
  via `user.checkAuthentication`/`user.get`) and a `shared` flag.
- `GET /api/logs/filter-sets` returns the caller's own sets **plus every
  shared set regardless of owner** — there is no per-set ACL beyond
  owner-vs-shared.
- Only the owner may `PUT`/`DELETE` a set (`403` otherwise) — shared sets are
  still edit-locked to their creator.
- Writes are atomic (temp file + `os.replace`) under an `asyncio.Lock`, so a
  crash mid-write never truncates the store; a non-writable mount degrades
  the store to read-only (listing keeps working, mutations return `503`)
  instead of crashing the gateway.
