# Authentication

auzui has no user database or session store of its own. Every session is a
**Zabbix session token**, obtained one of two ways, kept in the browser, and
sent as a Bearer token on every request. This page covers both login flows,
how the frontend stores and uses the session, and the gateway's
authorization model for the data it proxies. Source of truth:
[`frontend/src/lib/auth/`](../frontend/src/lib/auth/) and
[`services/gateway/src/auzui_gateway/{spnego,zabbix}.py`](../services/gateway/src/auzui_gateway/).

## Password login

1. The user submits username/password on the login form
   (`frontend/src/routes/LoginPage.tsx`).
2. The frontend calls Zabbix's JSON-RPC `user.login` directly against
   `/api_jsonrpc.php` (proxied by the dev server / reverse proxy — see
   [deployment.md](deployment.md)), **not** through `auzui-gateway` — the
   gateway is not in the password-login path at all.
3. The returned session ID is stored as the Bearer token (see "Session
   storage" below) and used directly as the Zabbix API authentication token
   for all subsequent JSON-RPC calls and as the `Authorization: Bearer
   <token>` header on every `auzui-gateway` request.

There is no separate auzui account or password: whatever Zabbix accepts for
`user.login`, auzui accepts.

## SPNEGO / Kerberos SSO

Enabled by setting `SPNEGO_ENABLED=true` on `auzui-gateway` (see
[configuration.md](configuration.md#kerberos--spnego-sso-optional)). The
frontend attempts it transparently on load
(`frontend/src/lib/auth/sso.ts`, `attemptSso()`), falling back to the
password form on any failure — it never rejects, only resolves to `null`.

Flow:

1. **Discovery**: `GET /api/auth/methods` (no auth) → `{ password: true,
   spnego: <SPNEGO_ENABLED> }`. If `spnego` is false, auzui never attempts
   SSO and goes straight to the password form.
2. **First leg**: `GET /api/auth/spnego` with `credentials: "include"`
   (so the browser can attach its Kerberos ticket via `WWW-Authenticate:
   Negotiate` handling). Without an `Authorization: Negotiate ...` header
   yet, the gateway replies `401` with `WWW-Authenticate: Negotiate` to
   trigger the browser's native SPNEGO handshake.
3. **Negotiate**: the browser (already Kerberos-authenticated against the
   domain, e.g. via a Windows/macOS login or `kinit`) retries with
   `Authorization: Negotiate <base64 GSS token>`. The gateway decodes it and
   calls `SpnegoService.accept()`, which runs `gssapi`'s `SecurityContext`
   against the keytab (`KRB5_KTNAME`) in a thread executor (`gssapi` is a
   sync C-extension). A completed context yields the full Kerberos principal
   (`user@REALM` or `user/instance@REALM`); `principal_to_login()` strips the
   realm and instance down to the Zabbix login name.
4. **Session mint**: the gateway calls Zabbix's `index_http.php` (the
   frontend's HTTP-auth entry point) with HTTP Basic `username:x` — **the
   password is ignored**, Zabbix trusts whatever username the web server
   asserts. The gateway then round-trips the resulting `zbx_session` cookie
   through `user.get` to confirm it is live, and returns `{ token,
   username }` as JSON.
5. The frontend adopts the token exactly like a password login
   (`useAuthStore.loginWithSso`).

**Deliberate non-retry**: on a validation failure the gateway returns a
plain `401` **without** re-sending the `WWW-Authenticate: Negotiate`
challenge — sending it again would loop the browser into repeating the same
failing handshake indefinitely.

**Security-critical isolation requirement**: because `index_http.php` trusts
the caller's asserted username outright, it **must not be reachable from
untrusted networks** — anyone who can reach it directly can mint a session
for *any* username. Restrict it to the gateway's source IP or an internal
network segment; point `ZABBIX_WEB_URL` at that restricted vhost while
`ZABBIX_UI_URL` can point at the normal user-facing one. Full write-up:
[deployment.md — SPNEGO SSO: isolate index_http.php](deployment.md#spnego-sso-isolate-index_httpphp).

### Explicit re-login and suppression

- A tab that already tried SSO once (`auzui-sso-attempted` in
  `sessionStorage`) won't retry automatically on re-render — avoids hammering
  the KDC/gateway on every route change.
- Clicking a "log in with Kerberos" button explicitly (`force: true`) bypasses
  both the attempted-guard and the suppression flag.
- Explicit logout sets `auzui-sso-suppressed`, so auzui won't silently
  re-authenticate the user right back in on the next page load — suppression
  clears on a hard reload or an explicit forced SSO attempt.

## Session storage in the frontend

`frontend/src/lib/auth/store.ts` (`useAuthStore`, a Zustand store) is the
single source of truth for the current session:

- The session token and username are persisted in `sessionStorage`
  (`auzui-session-token`, `auzui-session-username`) — **not** `localStorage`,
  so a session does not silently outlive the browser tab, and **not** a
  cookie, so it isn't sent automatically to the Zabbix API origin (avoiding
  CSRF-style exposure) — every request carries it explicitly as
  `Authorization: Bearer <token>`.
- On module load, a stored token (if any) is immediately applied to the
  shared `ZabbixClient` instance, so a page reload keeps the session without
  a re-login round-trip.
- `logout()` best-effort-calls Zabbix's `user.logout` and clears local state
  regardless of whether that call succeeds.
- `handleSessionExpired()` is called by query/mutation error handling when
  the API rejects the token (expired/revoked session) — it clears storage
  and surfaces a "session expired" message, routing the user back to login.

Because the Bearer token sits in `sessionStorage`, the reverse-proxy-level
Content-Security-Policy hardening in
[deployment.md](deployment.md#nginx-reverse-proxy-pattern) (in particular
disallowing inline scripts) is the primary defense against token
exfiltration via injected script — treat it as load-bearing, not optional.

## Authorization model

auzui never holds its own permission model — every data path re-checks the
caller's Zabbix session against the Zabbix API, at three different
granularities:

| Path | Granularity | Mechanism |
|---|---|---|
| `api_jsonrpc.php` (Problems, Hosts, Latest Data, dashboards, CRUD) | Whatever Zabbix's own JSON-RPC methods already enforce | Direct — no auzui-gateway involved |
| `POST /api/ts/query` (InfluxDB) | **Per-item** | `ZabbixClient.check_items_visible()` calls `item.get` with the caller's token before ever querying Influx — Influx access can never exceed what Zabbix already grants for those `itemid`s. Cached per token+item for `PERMISSION_CACHE_TTL` seconds. |
| `POST /api/logs/host/{hostid}` | **Per-host** | `ZabbixClient.get_host_identity()` calls `host.get` with the caller's token; a host invisible to the session yields `403`. The resulting host aliases (technical name, visible name, interface DNS/IP) become the Graylog `source` query. |
| `GET /api/logs/streams`, `POST /api/logs/search` | **Coarse-grained** — any live session | Only `validate_session()` (a live-session check, not a permission check) gates these. **Any authenticated Zabbix user can free-text search every Graylog stream the gateway is configured to see** — Graylog streams are not mapped to Zabbix host permissions. Operators **must** scope `GRAYLOG_DEFAULT_STREAMS` to streams every auzui user is allowed to read. See [deployment.md — Log access is coarse-grained](deployment.md#log-access-is-coarse-grained) for the full security note. |

Two consequences worth internalizing:

- The per-item and per-host paths are as strict as Zabbix's own
  permissions — auzui cannot open a hole wider than Zabbix already has.
- The free-text log search path is **not** host- or item-scoped by design
  (Graylog has no concept of Zabbix host permissions to check against); it
  is scoped only by which streams/servers the gateway's Graylog token(s) can
  see and which streams `GRAYLOG_DEFAULT_STREAMS` allows. Treat Graylog
  stream selection as the actual access-control boundary for logs, not
  Zabbix login.

See also: [configuration.md](configuration.md) for every relevant env var,
and [logs.md](logs.md) for how the host-scoped query and free-text search
paths differ mechanically.
