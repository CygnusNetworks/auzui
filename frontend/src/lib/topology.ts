import type { ZabbixHost, ZabbixMap } from "@auzui/zabbix-client";
import type { HostProblemSummary } from "./hosts";
import type { Severity } from "./severity";

/**
 * Auto-Topologie-Datenmodell (PLAN.md Phase 2 A / Entwurf 2, Abschnitt F).
 * Reine Funktionen, kein Netzwerkzugriff. Kanten tragen ihre Evidenz-Ebene
 * sichtbar (Legende/Layer-Toggles in der TopologyPage):
 *
 *  - "explicit": aus vorhandenen Zabbix-Maps (map.get selements+links) —
 *    Konfidenz 1. Trigger-Dependencies bewusst weggelassen (zu teuer, siehe
 *    PLAN.md).
 *  - "l3": gemeinsame /24-Subnetze aus host.get selectInterfaces — als
 *    Host↔Subnetz-Hub-Kanten, NICHT als vollvermaschte Host↔Host-Paare
 *    (sonst n² Kanten). Konfidenz mittel.
 *  - "logical": gemeinsamer Proxy — Host↔Proxy-Gruppenknoten (wir können
 *    Proxies hier nicht in Hosts auflösen, siehe PLAN.md "sonst
 *    Proxy-Gruppenknoten"). Gemeinsames Template wird bewusst NICHT als Kante
 *    modelliert (zu dicht). Konfidenz mittel.
 *
 * LLDP-Ebene und Ereignis-Korrelation sind hier bewusst nicht implementiert
 * (spätere Spikes, siehe PLAN.md) — die Legende erwähnt sie deshalb nicht.
 */

export type TopologyNodeKind = "host" | "subnet" | "proxy";
export type TopologyEdgeLevel = "explicit" | "l3" | "logical";

export interface TopologyNode {
  id: string;
  label: string;
  kind: TopologyNodeKind;
  hostid?: string;
  /** Undefined = kein aktives Problem (bzw. kein Host-Knoten). */
  severity?: Severity;
  /** First hostgroup id (host nodes only) — used to seed the force-layout so a group's hosts start out clustered. */
  groupKey?: string;
}

export interface TopologyEdge {
  source: string;
  target: string;
  level: TopologyEdgeLevel;
  /** 0..1 — wächst mit Evidenz (hier statisch je Ebene, siehe PLAN.md-Tabelle). */
  confidence: number;
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

const CONFIDENCE: Record<TopologyEdgeLevel, number> = {
  explicit: 1,
  l3: 0.6,
  logical: 0.5,
};

function hostNodeId(hostid: string): string {
  return `host:${hostid}`;
}

/**
 * Zabbix reports "no proxy" as proxyid "0" (not null) — that id resolves to no
 * proxy in proxy.get, so it must never become a "Proxy 0" cluster/node.
 */
const NO_PROXY_ID = "0";

/** True when the id is a usable Zabbix reference (set, non-empty, not the "none" sentinel "0"). */
function isRealId(id: string | undefined): id is string {
  return !!id && id !== NO_PROXY_ID;
}

/** True when the host is monitored via a single named proxy. */
function hasRealProxy(proxyid: string | undefined): proxyid is string {
  return isRealId(proxyid);
}

/**
 * Where a host's data collection is anchored. Zabbix ≥7.0 has three cases and
 * only the first two are visible in `proxyid`: a proxy-group host carries
 * `monitored_by: "2"` with `proxyid: "0"` and its group in `proxy_groupid`, so
 * keying on `proxyid` alone silently files all of them under "no proxy".
 */
export type HostCollectionAnchor =
  | { kind: "proxy"; id: string }
  | { kind: "proxygroup"; id: string }
  | { kind: "direct" };

export function collectionAnchorOf(host: ZabbixHost): HostCollectionAnchor {
  // monitored_by is authoritative when present; fall back to the id fields so
  // this still behaves on pre-7.0 payloads (and on output filters that omit it).
  if (host.monitored_by === "2" || (host.monitored_by === undefined && isRealId(host.proxy_groupid))) {
    if (isRealId(host.proxy_groupid)) return { kind: "proxygroup", id: host.proxy_groupid };
    return { kind: "direct" };
  }
  if (hasRealProxy(host.proxyid)) return { kind: "proxy", id: host.proxyid };
  return { kind: "direct" };
}

/** Synthetic cluster id for the "directly monitored (no proxy)" bucket in the Proxies tab. */
export const DIRECT_PROXY_CLUSTER_ID = "proxy:__direct__";

/**
 * Resolves the common Zabbix host macros a map selement/link label may still
 * carry (map.get does NOT expand them, so labels arrive as literal
 * "{HOST.NAME}", "{HOST.IP}", …). Replaces the known macros against the loaded
 * host data; unknown "{…}" macros are dropped and the whitespace/blank lines
 * they leave behind are collapsed. Pure — unit-tested in topology.test.ts.
 */
export function resolveMapLabel(label: string, host: ZabbixHost | undefined): string {
  if (!label) return "";
  const iface = host?.interfaces?.[0];
  const replaced = label.replace(/\{[^{}]+\}/g, (macro) => {
    switch (macro) {
      case "{HOST.NAME}":
      case "{HOSTNAME}":
        return host?.name ?? "";
      case "{HOST.HOST}":
        return host?.host ?? "";
      case "{HOST.IP}":
      case "{IPADDRESS}":
        return iface?.ip ?? "";
      case "{HOST.DNS}":
        return iface?.dns ?? "";
      case "{HOST.CONN}":
        if (!iface) return "";
        return iface.useip === "1" ? iface.ip : iface.dns;
      default:
        return ""; // unknown macro — drop it
    }
  });
  // Collapse the whitespace/blank lines removed macros leave behind.
  return replaced
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** First three octets ("/24 heuristic") — undefined for non-IPv4 addresses. */
function subnetKeyFor(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const m = IPV4_RE.exec(ip);
  if (!m) return undefined;
  return `${m[1]}.${m[2]}.${m[3]}.0/24`;
}

/** Picks one representative IPv4 address per host (first interface that has one). */
function primarySubnetKey(host: ZabbixHost): string | undefined {
  for (const iface of host.interfaces ?? []) {
    const key = subnetKeyFor(iface.ip);
    if (key) return key;
  }
  return undefined;
}

function edgeKey(a: string, b: string, level: TopologyEdgeLevel): string {
  return a < b ? `${level}:${a}|${b}` : `${level}:${b}|${a}`;
}

/**
 * Builds the topology graph from hosts + existing Zabbix maps.
 * `problemsByHost` is the output of aggregateHostProblems (lib/hosts.ts) —
 * reused rather than recomputed here.
 */
export function buildTopology(
  hosts: ZabbixHost[],
  maps: ZabbixMap[],
  problemsByHost: Map<string, HostProblemSummary>,
  proxyNameById: Map<string, string> = new Map(),
): TopologyGraph {
  const nodes = new Map<string, TopologyNode>();
  const edges = new Map<string, TopologyEdge>();
  const hostIds = new Set(hosts.map((h) => h.hostid));

  for (const host of hosts) {
    nodes.set(hostNodeId(host.hostid), {
      id: hostNodeId(host.hostid),
      label: host.name || host.host,
      kind: "host",
      hostid: host.hostid,
      severity: problemsByHost.get(host.hostid)?.maxSeverity,
      groupKey: host.hostgroups?.[0]?.groupid,
    });
  }

  // --- explicit: map.get selements + links --------------------------------
  for (const map of maps) {
    const hostIdBySelement = new Map<string, string>();
    for (const el of map.selements ?? []) {
      if (el.elementtype !== "0") continue; // only "host" elements
      const hostid = el.elements?.[0]?.hostid;
      if (hostid && hostIds.has(hostid)) hostIdBySelement.set(el.selementid, hostid);
    }
    for (const link of map.links ?? []) {
      const h1 = hostIdBySelement.get(link.selementid1);
      const h2 = hostIdBySelement.get(link.selementid2);
      if (!h1 || !h2 || h1 === h2) continue;
      const a = hostNodeId(h1);
      const b = hostNodeId(h2);
      const key = edgeKey(a, b, "explicit");
      if (!edges.has(key)) edges.set(key, { source: a, target: b, level: "explicit", confidence: CONFIDENCE.explicit });
    }
  }

  // --- l3: shared /24 subnets, as host<->subnet-hub edges -----------------
  const hostsBySubnet = new Map<string, string[]>();
  for (const host of hosts) {
    const key = primarySubnetKey(host);
    if (!key) continue;
    const list = hostsBySubnet.get(key);
    if (list) list.push(host.hostid);
    else hostsBySubnet.set(key, [host.hostid]);
  }
  for (const [subnetKey, hostidList] of hostsBySubnet) {
    if (hostidList.length < 2) continue; // no hub for a lone host — avoids clutter
    const subnetNodeId = `subnet:${subnetKey}`;
    nodes.set(subnetNodeId, { id: subnetNodeId, label: subnetKey, kind: "subnet" });
    for (const hostid of hostidList) {
      const a = hostNodeId(hostid);
      const key = edgeKey(a, subnetNodeId, "l3");
      if (!edges.has(key)) edges.set(key, { source: a, target: subnetNodeId, level: "l3", confidence: CONFIDENCE.l3 });
    }
  }

  // --- logical: shared proxy, as host<->proxy-group edges ------------------
  const hostsByProxy = new Map<string, string[]>();
  for (const host of hosts) {
    if (!hasRealProxy(host.proxyid)) continue; // proxyid "0"/undefined = no proxy
    const list = hostsByProxy.get(host.proxyid);
    if (list) list.push(host.hostid);
    else hostsByProxy.set(host.proxyid, [host.hostid]);
  }
  for (const [proxyid, hostidList] of hostsByProxy) {
    if (hostidList.length < 2) continue;
    const proxyNodeId = `proxy:${proxyid}`;
    nodes.set(proxyNodeId, { id: proxyNodeId, label: proxyNameById.get(proxyid) ?? `Proxy ${proxyid}`, kind: "proxy" });
    for (const hostid of hostidList) {
      const a = hostNodeId(hostid);
      const key = edgeKey(a, proxyNodeId, "logical");
      if (!edges.has(key)) {
        edges.set(key, { source: a, target: proxyNodeId, level: "logical", confidence: CONFIDENCE.logical });
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/**
 * Redesign "Entwurf 3 — Cluster + Fokus" (siehe PLAN.md-Umsetzung): statt
 * einer gemischten Kraftlayout-Ansicht drei getrennte Tabs (Zabbix-Maps /
 * L3-Subnetze / Proxies), links eine sortierte Cluster-Liste, rechts ein
 * deterministisches Radial-Layout des gewählten Clusters (siehe
 * lib/radial-layout.ts). Alles unten ist reine Ableitung, kein
 * Netzwerkzugriff — Tests in lib/__tests__/topology.test.ts.
 */

export type ClusterKind = "subnet" | "proxy" | "proxygroup" | "map";

export interface ClusterHostRef {
  hostid: string;
  label: string;
  severity: Severity | undefined;
  /** Active problem count (for the stage tooltip: "N aktive Probleme"). */
  problemCount: number;
  /** First interface IP, if any (stage tooltip). */
  ip: string | undefined;
}

export interface ClusterSummary {
  id: string;
  kind: ClusterKind;
  /** Hub label — subnet CIDR, proxy name, or map name. */
  name: string;
  hosts: ClusterHostRef[];
  /** Worst severity among the cluster's hosts, undefined if all OK/none active. */
  severity: Severity | undefined;
}

function worstSeverityOf(severities: (Severity | undefined)[]): Severity | undefined {
  let worst: Severity | undefined;
  for (const s of severities) if (s !== undefined && (worst === undefined || s > worst)) worst = s;
  return worst;
}

function hostRef(host: ZabbixHost, problemsByHost: Map<string, HostProblemSummary>): ClusterHostRef {
  const summary = problemsByHost.get(host.hostid);
  return {
    hostid: host.hostid,
    label: host.name || host.host,
    severity: summary?.maxSeverity,
    problemCount: summary?.count ?? 0,
    ip: host.interfaces?.[0]?.ip,
  };
}

/** L3-Subnetze-Tab: eine /24-Heuristik-Gruppe je gemeinsamem Subnetz (auch Einzelhosts — anders als das Graph-Hub-Node, das >=2 Hosts verlangt, ist die Cluster-Liste eine vollständige Übersicht). */
export function deriveSubnetClusters(
  hosts: ZabbixHost[],
  problemsByHost: Map<string, HostProblemSummary>,
): ClusterSummary[] {
  const bySubnet = new Map<string, ZabbixHost[]>();
  for (const host of hosts) {
    const key = primarySubnetKey(host);
    if (!key) continue;
    const list = bySubnet.get(key);
    if (list) list.push(host);
    else bySubnet.set(key, [host]);
  }
  const clusters: ClusterSummary[] = [];
  for (const [subnetKey, members] of bySubnet) {
    const hostRefs = members.map((h) => hostRef(h, problemsByHost));
    clusters.push({
      id: `subnet:${subnetKey}`,
      kind: "subnet",
      name: subnetKey,
      hosts: hostRefs,
      severity: worstSeverityOf(hostRefs.map((h) => h.severity)),
    });
  }
  return clusters;
}

/**
 * Proxies-Tab: eine Gruppe je Proxy *und* je Proxy-Gruppe (Zabbix ≥7.0),
 * Klarnamen aus `proxyNameById`/`proxyGroupNameById` (proxy.get /
 * proxygroup.get, siehe use-topology.ts), Fallback "Proxy <id>". Hosts ohne
 * beides landen NICHT als "Proxy 0" (die id löst in proxy.get nichts auf),
 * sondern gebündelt im Cluster `directClusterName` (i18n).
 */
export function deriveProxyClusters(
  hosts: ZabbixHost[],
  problemsByHost: Map<string, HostProblemSummary>,
  proxyNameById: Map<string, string>,
  directClusterName: string,
  proxyGroupNameById: Map<string, string> = new Map(),
): ClusterSummary[] {
  const byProxy = new Map<string, ZabbixHost[]>();
  const byProxyGroup = new Map<string, ZabbixHost[]>();
  const direct: ZabbixHost[] = [];
  for (const host of hosts) {
    const anchor = collectionAnchorOf(host);
    if (anchor.kind === "direct") {
      direct.push(host);
      continue;
    }
    const bucket = anchor.kind === "proxy" ? byProxy : byProxyGroup;
    const list = bucket.get(anchor.id);
    if (list) list.push(host);
    else bucket.set(anchor.id, [host]);
  }
  const clusters: ClusterSummary[] = [];
  for (const [proxyid, members] of byProxy) {
    const hostRefs = members.map((h) => hostRef(h, problemsByHost));
    clusters.push({
      id: `proxy:${proxyid}`,
      kind: "proxy",
      name: proxyNameById.get(proxyid) ?? `Proxy ${proxyid}`,
      hosts: hostRefs,
      severity: worstSeverityOf(hostRefs.map((h) => h.severity)),
    });
  }
  for (const [groupid, members] of byProxyGroup) {
    const hostRefs = members.map((h) => hostRef(h, problemsByHost));
    clusters.push({
      id: `proxygroup:${groupid}`,
      kind: "proxygroup",
      name: proxyGroupNameById.get(groupid) ?? `Proxy group ${groupid}`,
      hosts: hostRefs,
      severity: worstSeverityOf(hostRefs.map((h) => h.severity)),
    });
  }
  if (direct.length > 0) {
    const hostRefs = direct.map((h) => hostRef(h, problemsByHost));
    clusters.push({
      id: DIRECT_PROXY_CLUSTER_ID,
      kind: "proxy",
      name: directClusterName,
      hosts: hostRefs,
      severity: worstSeverityOf(hostRefs.map((h) => h.severity)),
    });
  }
  return clusters;
}

/** Zabbix-Maps-Tab: eine Gruppe je vorhandener Map (map.get), Hosts aus den host-Selements aufgelöst. */
export function deriveMapClusters(
  maps: ZabbixMap[],
  hostByHostId: Map<string, ZabbixHost>,
  problemsByHost: Map<string, HostProblemSummary>,
): ClusterSummary[] {
  const clusters: ClusterSummary[] = [];
  for (const map of maps) {
    const seen = new Set<string>();
    const hostRefs: ClusterHostRef[] = [];
    for (const el of map.selements ?? []) {
      if (el.elementtype !== "0") continue;
      const hostid = el.elements?.[0]?.hostid;
      if (!hostid || seen.has(hostid)) continue;
      const host = hostByHostId.get(hostid);
      if (!host) continue;
      seen.add(hostid);
      hostRefs.push(hostRef(host, problemsByHost));
    }
    clusters.push({
      id: `map:${map.sysmapid}`,
      kind: "map",
      name: map.name,
      hosts: hostRefs,
      severity: worstSeverityOf(hostRefs.map((h) => h.severity)),
    });
  }
  return clusters;
}

/** Sortierung der Cluster-Liste: schlimmste Severity zuerst (undefined = kein Problem, sortiert ans Ende), dann Name (locale-aware). */
export function sortClustersBySeverity(clusters: ClusterSummary[]): ClusterSummary[] {
  return [...clusters].sort((a, b) => {
    const sa = a.severity ?? -1;
    const sb = b.severity ?? -1;
    if (sa !== sb) return sb - sa;
    return a.name.localeCompare(b.name);
  });
}

/** Case-insensitive Substring-Suche über Cluster-Namen UND ihre Host-Namen (für "Suchfeld filtert Cluster UND springt bei Host-Treffern zum Cluster des Hosts", PLAN.md). */
export function clusterMatchesQuery(cluster: ClusterSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (cluster.name.toLowerCase().includes(q)) return true;
  return cluster.hosts.some((h) => h.label.toLowerCase().includes(q));
}

/** First cluster (by list order) whose hosts include a name match — used to jump the focus stage to a host found via free-text search. */
export function findClusterForHostQuery(clusters: ClusterSummary[], query: string): ClusterSummary | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return clusters.find((c) => c.hosts.some((h) => h.label.toLowerCase().includes(q)));
}
