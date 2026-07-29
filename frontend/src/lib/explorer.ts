/**
 * Infrastructure Explorer (PLAN.md Phase 2 / Entwurf 1) — reine Helfer, kein
 * Netzwerkzugriff. Ebene 1 (Hostgruppen-Kacheln) rollt die per-Host-Aggregation
 * aus lib/hosts.ts (aggregateHostProblems) auf Gruppenebene hoch; Ebene 2
 * (Host-Kacheln) nutzt bei Farbe="Auslastung" einen einfachen 5-Stufen-Bucket
 * auf den CPU-%-Lastwert, gemappt auf das vorhandene --color-chart-1-Token
 * (kein Hardcoding einer eigenen Farbskala).
 */
import type { HostProblemSummary } from "./hosts";
import type { Severity } from "./severity";

export interface HostGroupLike {
  hostid: string;
  hostgroups?: { groupid: string }[];
}

export interface GroupProblemSummary {
  hostCount: number;
  problemCount: number;
  /** -1 = keine aktiven Probleme in dieser Gruppe. */
  maxSeverity: Severity | -1;
}

/**
 * Rollt aggregateHostProblems (lib/hosts.ts) von Host- auf Gruppenebene hoch —
 * ein Host kann in mehreren Gruppen liegen und zählt dort jeweils mit.
 */
export function aggregateGroupProblems(
  hosts: HostGroupLike[],
  problemsByHost: Map<string, HostProblemSummary>,
): Map<string, GroupProblemSummary> {
  const result = new Map<string, GroupProblemSummary>();
  for (const host of hosts) {
    const summary = problemsByHost.get(host.hostid);
    for (const g of host.hostgroups ?? []) {
      const existing = result.get(g.groupid) ?? { hostCount: 0, problemCount: 0, maxSeverity: -1 };
      existing.hostCount += 1;
      if (summary) {
        existing.problemCount += summary.count;
        if (summary.maxSeverity > existing.maxSeverity) existing.maxSeverity = summary.maxSeverity;
      }
      result.set(g.groupid, existing);
    }
  }
  return result;
}

export type UtilBucket = 0 | 1 | 2 | 3 | 4;

/** Einfacher 5-Stufen-Bucket über den CPU-Auslastungsprozentsatz. */
export function utilBucket(pct: number): UtilBucket {
  if (!Number.isFinite(pct) || pct < 20) return 0;
  if (pct < 40) return 1;
  if (pct < 60) return 2;
  if (pct < 80) return 3;
  return 4;
}

const BUCKET_MIX_PERCENT: Record<UtilBucket, number> = { 0: 15, 1: 32, 2: 50, 3: 68, 4: 88 };

/**
 * CSS color-mix() für die Host-Kachel im Modus "Auslastung" — mischt das
 * vorhandene --color-chart-1-Token mit --color-surface-3 in 5 Stufen, statt
 * eine eigene Farbskala fest zu verdrahten.
 */
export function utilColorMix(pct: number): string {
  return `color-mix(in oklab, var(--color-chart-1) ${BUCKET_MIX_PERCENT[utilBucket(pct)]}%, var(--color-surface-3))`;
}
