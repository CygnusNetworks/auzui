import type { ZabbixHost, ZabbixTrigger } from "@auzui/zabbix-client";
import type { Severity } from "./severity";
import { severityFromWire } from "./severity";

/** Per-host problem summary shown as the Probleme badge in HostsPage. */
export interface HostProblemSummary {
  count: number;
  maxSeverity: Severity;
}

export interface HostProblemLike {
  objectid: string;
  severity: string;
}

/**
 * Aggregates problem.get rows (suppressed:false) into per-host counts, joined
 * via trigger.get (monitored:true, selectHosts hostid) — mirrors
 * joinProblemsWithTriggers in lib/problems.ts but keyed by host instead of by
 * problem, and deliberately does NOT reuse useProblems (that hook filters to
 * unacknowledged-by-default via the Problems page URL state).
 */
export function aggregateHostProblems(
  problems: HostProblemLike[],
  triggers: Pick<ZabbixTrigger, "triggerid" | "hosts">[],
): Map<string, HostProblemSummary> {
  const hostIdsByTrigger = new Map<string, string[]>();
  for (const t of triggers) {
    hostIdsByTrigger.set(t.triggerid, (t.hosts ?? []).map((h) => h.hostid));
  }

  const result = new Map<string, HostProblemSummary>();
  for (const p of problems) {
    const hostIds = hostIdsByTrigger.get(p.objectid);
    if (!hostIds) continue;
    const severity = severityFromWire(p.severity);
    for (const hostId of hostIds) {
      const existing = result.get(hostId);
      if (existing) {
        existing.count += 1;
        if (severity > existing.maxSeverity) existing.maxSeverity = severity;
      } else {
        result.set(hostId, { count: 1, maxSeverity: severity });
      }
    }
  }
  return result;
}

/** Client-side search across host.name / host.host / interface IPs+DNS. */
export function matchesHostSearch(host: ZabbixHost, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (host.name?.toLowerCase().includes(q)) return true;
  if (host.host?.toLowerCase().includes(q)) return true;
  return (host.interfaces ?? []).some(
    (i) => i.ip?.toLowerCase().includes(q) || i.dns?.toLowerCase().includes(q),
  );
}

export type HostSortKey = "name" | "severity";

/** Sorts by name (locale-aware) or by worst active problem first (no problems last). */
export function sortHosts(
  hosts: ZabbixHost[],
  key: HostSortKey,
  problemsByHost: Map<string, HostProblemSummary>,
): ZabbixHost[] {
  const copy = [...hosts];
  if (key === "name") {
    copy.sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host));
    return copy;
  }
  copy.sort((a, b) => {
    const sa = problemsByHost.get(a.hostid)?.maxSeverity ?? -1;
    const sb = problemsByHost.get(b.hostid)?.maxSeverity ?? -1;
    if (sa !== sb) return sb - sa;
    return (a.name || a.host).localeCompare(b.name || b.host);
  });
  return copy;
}
