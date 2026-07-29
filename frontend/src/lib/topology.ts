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
    if (!host.proxyid) continue;
    const list = hostsByProxy.get(host.proxyid);
    if (list) list.push(host.hostid);
    else hostsByProxy.set(host.proxyid, [host.hostid]);
  }
  for (const [proxyid, hostidList] of hostsByProxy) {
    if (hostidList.length < 2) continue;
    const proxyNodeId = `proxy:${proxyid}`;
    nodes.set(proxyNodeId, { id: proxyNodeId, label: `Proxy ${proxyid}`, kind: "proxy" });
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
