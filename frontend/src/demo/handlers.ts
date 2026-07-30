/**
 * Pure request resolvers for the demo build. `start.ts` wires these into a
 * `globalThis.fetch` shim; kept separate (and framework-free — no MSW) so the
 * dispatch logic itself stays simple to read and doesn't add a runtime
 * dependency to the normal build.
 */
import type { ZabbixTrigger } from "@auzui/zabbix-client";
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
    case "event.acknowledge": {
      const eventids = asStringArray(params.eventids) ?? [];
      for (const p of demoProblems) if (eventids.includes(p.eventid)) p.acknowledged = "1";
      return { eventids };
    }
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
      return { maintenanceids: [`900${Math.floor(Math.random() * 1000)}`] };
    case "maintenance.delete":
      return { maintenanceids: params };
    case "discoveryrule.get":
      return [];
    default:
      return [];
  }
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
        acknowledges:
          p.acknowledged === "1"
            ? [
                {
                  acknowledgeid: `ack-${p.eventid}`,
                  userid: "1",
                  eventid: p.eventid,
                  clock: String(Number(p.clock) + 120),
                  message: "Investigating.",
                  action: "2",
                },
              ]
            : [],
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
