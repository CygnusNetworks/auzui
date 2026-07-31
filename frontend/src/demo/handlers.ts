/**
 * Pure request resolvers for the demo build. `start.ts` wires these into a
 * `globalThis.fetch` shim; kept separate (and framework-free — no MSW) so the
 * dispatch logic itself stays simple to read and doesn't add a runtime
 * dependency to the normal build.
 */
import type { ZabbixMaintenance, ZabbixTimeperiod, ZabbixTrigger } from "@auzui/zabbix-client";
import {
  DEMO_NOW,
  DEMO_TOKEN,
  DEMO_USERNAME,
  demoFilterSets,
  demoHostGroups,
  demoHosts,
  demoItems,
  demoLogMessages,
  demoLogServers,
  demoLogStreams,
  demoMaintenances,
  demoProblems,
  demoProxies,
  demoTriggers,
  generateHistory,
  type DemoFilterSet,
} from "./mockData";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

function jsonRpcResult(id: number, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

// ---------------------------------------------------------------------------
// item.get / host.get style filter helpers
// ---------------------------------------------------------------------------

function asStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String);
  return undefined;
}

/** Zabbix's `searchWildcardsEnabled` wraps contains-style terms as `*value*`; `*` has no
 * literal meaning for our substring match, so drop it before comparing. */
function stripWildcards(term: string): string {
  return term.replace(/\*/g, "");
}

function matchesSearchField(value: string | undefined, term: string | undefined): boolean {
  if (!term) return true;
  if (!value) return false;
  return value.toLowerCase().includes(stripWildcards(term).toLowerCase());
}

function filterHosts(params: Record<string, unknown>) {
  let hosts = demoHosts;
  const hostids = asStringArray(params.hostids);
  if (hostids) hosts = hosts.filter((h) => hostids.includes(h.hostid));
  const groupids = asStringArray(params.groupids);
  if (groupids) hosts = hosts.filter((h) => h.hostgroups?.some((g) => groupids.includes(g.groupid)));
  const search = params.search as Record<string, string> | undefined;
  if (search?.host || search?.name) {
    hosts = hosts.filter(
      (h) => matchesSearchField(h.host, search.host) || matchesSearchField(h.name, search.name),
    );
  }
  const filter = params.filter as Record<string, unknown> | undefined;
  if (filter?.maintenance_status !== undefined) {
    const want = String(filter.maintenance_status);
    hosts = hosts.filter((h) => (h.maintenance_status ?? "0") === want);
  }
  return hosts;
}

function filterItems(params: Record<string, unknown>) {
  let items = demoItems;
  const hostids = asStringArray(params.hostids);
  if (hostids) items = items.filter((it) => hostids.includes(it.hostid));
  const search = params.search as Record<string, string> | undefined;
  const keyTerm = search?.key_;
  if (keyTerm) items = items.filter((it) => matchesSearchField(it.key_, keyTerm));
  const nameTerm = search?.name;
  if (nameTerm) items = items.filter((it) => matchesSearchField(it.name, nameTerm));
  const filter = params.filter as Record<string, unknown> | undefined;
  const valueTypes = asStringArray(filter?.value_type);
  if (valueTypes) items = items.filter((it) => valueTypes.includes(it.value_type));
  const tags = params.tags as { tag: string; value?: string }[] | undefined;
  if (tags && tags.length > 0) {
    items = items.filter((it) => tags.every((t) => it.tags?.some((x) => x.tag === t.tag && (!t.value || x.value === t.value))));
  }
  return items.map((it) => ({
    ...it,
    hosts: [pickHostRef(it.hostid)].filter(Boolean),
  }));
}

function pickHostRef(hostid: string) {
  const h = demoHosts.find((x) => x.hostid === hostid);
  return h ? { hostid: h.hostid, host: h.host, name: h.name } : undefined;
}

function filterTriggers(params: Record<string, unknown>): ZabbixTrigger[] {
  let triggers = demoTriggers;
  const triggerids = asStringArray(params.triggerids);
  if (triggerids) triggers = triggers.filter((t) => triggerids.includes(t.triggerid));
  const hostids = asStringArray(params.hostids);
  if (hostids) triggers = triggers.filter((t) => t.hosts?.some((h) => hostids.includes(h.hostid)));
  return triggers;
}

function filterProblems(params: Record<string, unknown>) {
  let problems = demoProblems;
  const hostids = asStringArray(params.hostids);
  if (hostids) {
    const triggerIdsForHosts = new Set(
      demoTriggers.filter((t) => t.hosts?.some((h) => hostids.includes(h.hostid))).map((t) => t.triggerid),
    );
    problems = problems.filter((p) => triggerIdsForHosts.has(p.objectid));
  }
  const eventids = asStringArray(params.eventids);
  if (eventids) problems = problems.filter((p) => eventids.includes(p.eventid));
  if (params.suppressed === false) problems = problems.filter((p) => p.suppressed !== "1");
  return problems;
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatch
// ---------------------------------------------------------------------------

function resolveRpcMethod(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case "user.login":
      return DEMO_TOKEN;
    case "user.logout":
      return true;
    case "apiinfo.version":
      return "7.0.0";
    case "host.get":
      return filterHosts(params);
    case "hostgroup.get": {
      const search = params.search as Record<string, string> | undefined;
      if (search?.name) return demoHostGroups.filter((g) => matchesSearchField(g.name, search.name));
      return demoHostGroups;
    }
    case "item.get":
      return filterItems(params);
    case "problem.get":
      return filterProblems(params);
    case "trigger.get":
      return filterTriggers(params);
    case "event.get":
      return resolveEventGet(params);
    case "event.acknowledge":
      return resolveEventAcknowledge(params);
    case "history.get":
    case "trend.get":
      return resolveTimeseries(params);
    case "map.get":
      return [];
    case "proxy.get":
      return demoProxies;
    case "maintenance.get":
      return demoMaintenances;
    case "maintenance.create":
      return resolveMaintenanceCreate(params);
    case "maintenance.update":
      return resolveMaintenanceUpdate(params);
    case "maintenance.delete": {
      const ids = asStringArray(params) ?? asStringArray(params.maintenanceids) ?? [];
      for (let i = demoMaintenances.length - 1; i >= 0; i--) {
        if (ids.includes(demoMaintenances[i]!.maintenanceid)) demoMaintenances.splice(i, 1);
      }
      return { maintenanceids: ids };
    }
    case "discoveryrule.get":
      return [];
    default:
      return [];
  }
}

/**
 * Acknowledge entries recorded by event.acknowledge during the demo session,
 * so the detail panel's timeline reflects what the user actually did. Seeded
 * lazily with a static "Investigating." entry for problems that start out
 * acknowledged in the mock data.
 */
const demoAcknowledges = new Map<string, Record<string, string>[]>();
let demoAckSequence = 0;

function ackEntriesFor(eventid: string, acknowledged: boolean): Record<string, string>[] {
  const recorded = demoAcknowledges.get(eventid);
  if (recorded) return recorded;
  if (!acknowledged) return [];
  const problem = demoProblems.find((p) => p.eventid === eventid);
  return [
    {
      acknowledgeid: `ack-${eventid}`,
      userid: "1",
      eventid,
      clock: String(Number(problem?.clock ?? DEMO_NOW) + 120),
      message: "Investigating.",
      action: "2",
    },
  ];
}

function resolveEventAcknowledge(params: Record<string, unknown>) {
  const eventids = asStringArray(params.eventids) ?? [];
  const action = Number(params.action ?? 0);
  const message = typeof params.message === "string" ? params.message : "";
  const severity = params.severity !== undefined ? String(params.severity) : undefined;
  const suppressUntil = params.suppress_until !== undefined ? String(params.suppress_until) : "0";

  for (const p of demoProblems) {
    if (!eventids.includes(p.eventid)) continue;
    // Seed-Einträge VOR dem Umsetzen der Flags ermitteln, sonst bekämen frisch
    // bestätigte Probleme den statischen "Investigating."-Eintrag untergeschoben.
    const entries = ackEntriesFor(p.eventid, p.acknowledged === "1");
    if (action & 2) p.acknowledged = "1";
    if (action & 16) p.acknowledged = "0";
    if (action & 32) {
      p.suppressed = "1";
      p.suppression_data = [{ suppress_until: suppressUntil }];
    }
    if (action & 64) {
      p.suppressed = "0";
      p.suppression_data = [];
    }
    const entry: Record<string, string> = {
      acknowledgeid: `ack-${p.eventid}-${demoAckSequence++}`,
      userid: "1",
      eventid: p.eventid,
      clock: String(Math.floor(Date.now() / 1000)),
      message,
      action: String(action),
    };
    if (action & 8 && severity !== undefined) {
      entry.old_severity = p.severity;
      entry.new_severity = severity;
      p.severity = severity as typeof p.severity;
    }
    if (action & 32) entry.suppress_until = suppressUntil;
    demoAcknowledges.set(p.eventid, [...entries, entry]);
  }
  // Manuelles Schließen löst das Problem — aus der Liste entfernen.
  if (action & 1) {
    for (let i = demoProblems.length - 1; i >= 0; i--) {
      if (eventids.includes(demoProblems[i]!.eventid)) demoProblems.splice(i, 1);
    }
  }
  return { eventids };
}

/** Rebuilds a ZabbixMaintenance row (string wire fields) from create/update params. */
function maintenanceFromParams(
  params: Record<string, unknown>,
  maintenanceid: string,
): ZabbixMaintenance {
  const hosts = (params.hosts as { hostid: string | number }[] | undefined)?.map((h) => {
    const full = demoHosts.find((d) => d.hostid === String(h.hostid));
    return {
      hostid: String(h.hostid),
      host: full?.host ?? String(h.hostid),
      name: full?.name ?? full?.host ?? String(h.hostid),
    };
  });
  const hostgroups = (params.groups as { groupid: string | number }[] | undefined)?.map(
    (g) =>
      demoHostGroups.find((d) => d.groupid === String(g.groupid)) ?? {
        groupid: String(g.groupid),
        name: `group ${String(g.groupid)}`,
      },
  );
  const timeperiods = ((params.timeperiods as Record<string, unknown>[] | undefined) ?? []).map(
    (tp) => {
      const out: Record<string, string> = {};
      const keys = [
        "timeperiod_type",
        "period",
        "every",
        "dayofweek",
        "start_time",
        "start_date",
        "month",
        "day",
      ];
      for (const k of keys) if (tp[k] !== undefined) out[k] = String(tp[k]);
      return out as unknown as ZabbixTimeperiod;
    },
  );
  return {
    maintenanceid,
    name: String(params.name ?? ""),
    active_since: String(params.active_since ?? 0),
    active_till: String(params.active_till ?? 0),
    maintenance_type: String(params.maintenance_type ?? "0") === "1" ? "1" : "0",
    description: String(params.description ?? ""),
    ...(hosts ? { hosts } : {}),
    ...(hostgroups ? { hostgroups } : {}),
    timeperiods,
  };
}

let demoMaintenanceSequence = 90100;

function resolveMaintenanceCreate(params: Record<string, unknown>) {
  const maintenanceid = String(demoMaintenanceSequence++);
  demoMaintenances.push(maintenanceFromParams(params, maintenanceid));
  return { maintenanceids: [maintenanceid] };
}

function resolveMaintenanceUpdate(params: Record<string, unknown>) {
  const maintenanceid = String(params.maintenanceid);
  const index = demoMaintenances.findIndex((m) => m.maintenanceid === maintenanceid);
  if (index >= 0) demoMaintenances[index] = maintenanceFromParams(params, maintenanceid);
  return { maintenanceids: [maintenanceid] };
}

function resolveEventGet(params: Record<string, unknown>) {
  const eventids = asStringArray(params.eventids) ?? [];
  return demoProblems
    .filter((p) => eventids.includes(p.eventid))
    .map((p) => {
      const trigger = demoTriggers.find((t) => t.triggerid === p.objectid);
      return {
        eventid: p.eventid,
        source: "0",
        object: "0",
        objectid: p.objectid,
        clock: p.clock,
        value: "1",
        severity: p.severity,
        name: p.name,
        hosts: trigger?.hosts ?? [],
        acknowledges: ackEntriesFor(p.eventid, p.acknowledged === "1"),
      };
    });
}

function resolveTimeseries(params: Record<string, unknown>) {
  const itemids = asStringArray(params.itemids) ?? [];
  const from = Number(params.time_from ?? DEMO_NOW - 3600);
  const till = Number(params.time_till ?? DEMO_NOW);
  const out: unknown[] = [];
  for (const itemid of itemids) {
    const points = generateHistory(itemid, from, till, 150);
    for (const p of points) {
      out.push({
        itemid,
        clock: String(p.clock),
        value: p.value.toFixed(4),
        num: "1",
        value_min: (p.value * 0.9).toFixed(4),
        value_avg: p.value.toFixed(4),
        value_max: (p.value * 1.1).toFixed(4),
      });
    }
  }
  return out;
}

async function handleJsonRpc(request: Request): Promise<Response> {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonResponse({ jsonrpc: "2.0", id: 0, error: { code: -32700, message: "Parse error" } });
  }
  const result = resolveRpcMethod(body.method, body.params ?? {});
  return jsonResponse(jsonRpcResult(body.id, result));
}

// ---------------------------------------------------------------------------
// Gateway (/api/*) dispatch
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function paginate<T>(items: T[], limit: number, offset: number): T[] {
  return items.slice(offset, offset + limit);
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function searchResult(messages: unknown[], total: number) {
  return { messages, total, errors: [] };
}

let nextFilterSetId = 100;

async function handleGateway(request: Request, pathname: string): Promise<Response> {
  const method = request.method;
  const url = new URL(request.url);

  if (pathname === "/api/auth/methods") return jsonResponse({ password: true, spnego: false });
  if (pathname === "/api/config") {
    return jsonResponse({ zabbix_ui_url: "https://zabbix.demo.internal", version: "demo", commit: "0000000000" });
  }
  if (pathname === "/api/ts/status") return jsonResponse({ enabled: false });
  if (pathname === "/api/logs/status") return jsonResponse({ enabled: true });
  if (pathname === "/api/logs/servers") return jsonResponse({ servers: demoLogServers, dedup_enabled: false });
  if (pathname === "/api/logs/streams") return jsonResponse({ streams: demoLogStreams });

  if (pathname === "/api/logs/search" && method === "POST") {
    const body = await readJsonBody(request);
    const limit = Number(body.limit ?? 100);
    const offset = Number(body.offset ?? 0);
    return jsonResponse(searchResult(paginate(demoLogMessages, limit, offset), demoLogMessages.length));
  }

  const hostLogsMatch = pathname.match(/^\/api\/logs\/host\/([^/]+)$/);
  if (hostLogsMatch && method === "POST") {
    const hostid = hostLogsMatch[1]!;
    const host = demoHosts.find((h) => h.hostid === hostid);
    const body = await readJsonBody(request);
    const limit = Number(body.limit ?? 100);
    const offset = Number(body.offset ?? 0);
    const scoped = host ? demoLogMessages.filter((m) => m.source === host.host) : demoLogMessages;
    const result = searchResult(paginate(scoped, limit, offset), scoped.length) as Record<string, unknown>;
    result.matched_sources = host ? [host.host, `${host.host}.demo.internal`] : [];
    return jsonResponse(result);
  }

  if (pathname === "/api/logs/filter-sets") {
    if (method === "GET") return jsonResponse({ filter_sets: demoFilterSets });
    if (method === "POST") {
      const body = (await readJsonBody(request)) as Partial<DemoFilterSet>;
      const created: DemoFilterSet = {
        id: `fs-${nextFilterSetId++}`,
        name: body.name ?? "Untitled",
        owner: DEMO_USERNAME,
        shared: Boolean(body.shared),
        filters: (body.filters as DemoFilterSet["filters"]) ?? {
          include: [],
          exclude: [],
          streams: null,
          servers: null,
          level: null,
        },
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
      demoFilterSets.push(created);
      return jsonResponse(created);
    }
  }

  const filterSetMatch = pathname.match(/^\/api\/logs\/filter-sets\/([^/]+)$/);
  if (filterSetMatch) {
    const id = filterSetMatch[1]!;
    if (method === "PUT") {
      const body = (await readJsonBody(request)) as Partial<DemoFilterSet>;
      const existing = demoFilterSets.find((f) => f.id === id);
      if (existing) {
        existing.name = body.name ?? existing.name;
        existing.shared = Boolean(body.shared);
        if (body.filters) existing.filters = body.filters as DemoFilterSet["filters"];
        existing.updated = new Date().toISOString();
        return jsonResponse(existing);
      }
      return jsonResponse({ detail: "not found" }, 404);
    }
    if (method === "DELETE") {
      const idx = demoFilterSets.findIndex((f) => f.id === id);
      if (idx >= 0) demoFilterSets.splice(idx, 1);
      return jsonResponse({ deleted: true });
    }
  }

  if (pathname === "/api/ts/query" && method === "POST") {
    const body = await readJsonBody(request);
    const itemids = asStringArray(body.itemids) ?? [];
    const from = Number(body.start ?? DEMO_NOW - 3600);
    const till = Number(body.end ?? DEMO_NOW);
    const series = itemids.map((itemid) => ({
      itemid,
      points: generateHistory(itemid, from, till, Number(body.points ?? 300)).map((p) => [p.clock, p.value]),
    }));
    return jsonResponse({ series });
  }

  // Unmatched /api/* path — return an empty-ish body rather than erroring the whole page.
  void url;
  return jsonResponse(method === "GET" ? [] : {});
}

export { handleJsonRpc, handleGateway };
