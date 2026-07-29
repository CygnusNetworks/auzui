import type { ZabbixItemTag, ZabbixProblem, ZabbixTrigger } from "@auzui/zabbix-client";
import { severityFromWire, type Severity } from "./severity";
import type { Locale } from "./i18n";
import { de } from "../locales/de";
import { en } from "../locales/en";

const AGE_CATALOG: Record<Locale, typeof de.problems.age> = {
  de: de.problems.age,
  en: en.problems.age,
};

/** A problem.get row joined with its trigger's host + expression. */
export interface EnrichedProblem {
  eventid: string;
  objectid: string;
  name: string;
  severity: Severity;
  /** Unix seconds. */
  clock: number;
  acknowledged: boolean;
  /** Currently suppressed (maintenance or manual event.acknowledge suppress). */
  suppressed?: boolean;
  tags: ZabbixItemTag[];
  hostId?: string;
  hostName?: string;
  triggerExpression?: string;
  /** First item on the trigger — candidate for the sparkline, if numeric. */
  itemId?: string;
  itemValueType?: "0" | "3";
}

/**
 * Joins problem.get rows (objectid = triggerid) with trigger.get rows
 * (selectHosts + selectItems + expandExpression) to attach host identity and
 * the trigger expression to each problem. Pure — no network access.
 */
export function joinProblemsWithTriggers(
  problems: ZabbixProblem[],
  triggers: ZabbixTrigger[],
): EnrichedProblem[] {
  const triggerById = new Map(triggers.map((t) => [t.triggerid, t]));
  return problems.map((p) => {
    const trigger = triggerById.get(p.objectid);
    const host = trigger?.hosts?.[0];
    const item = trigger?.items?.[0];
    const numericItem =
      item && (item.value_type === "0" || item.value_type === "3") ? item : undefined;
    return {
      eventid: p.eventid,
      objectid: p.objectid,
      name: p.name,
      severity: severityFromWire(p.severity),
      clock: Number(p.clock),
      acknowledged: p.acknowledged === "1",
      suppressed: p.suppressed === "1",
      // "__"-Tags sind interne Marker von Alert-Integrationen
      // (z. B. __message_ts_#zabbix) — nicht anzeigen.
      tags: (p.tags ?? []).filter((t) => !t.tag.startsWith("__")),
      hostId: host?.hostid,
      hostName: host?.host,
      triggerExpression: trigger?.expression,
      itemId: numericItem?.itemid,
      itemValueType: numericItem?.value_type as "0" | "3" | undefined,
    };
  });
}

export interface ProblemFilter {
  /** Empty/undefined = no severity filter (show all). */
  severities?: Set<Severity> | Severity[];
  unackOnly?: boolean;
  /** Restrict to a single host, matched by its technical name (⌘K "jump to host's problems"). */
  host?: string;
}

/** Pure filter used by both the URL search-params layer and tests. */
export function filterProblems(
  problems: EnrichedProblem[],
  filter: ProblemFilter,
): EnrichedProblem[] {
  const sevSet = filter.severities
    ? filter.severities instanceof Set
      ? filter.severities
      : new Set(filter.severities)
    : undefined;
  return problems.filter((p) => {
    if (sevSet && sevSet.size > 0 && !sevSet.has(p.severity)) return false;
    if (filter.unackOnly && p.acknowledged) return false;
    if (filter.host && p.hostName !== filter.host) return false;
    return true;
  });
}

/** Counts per severity, for the filter-chip badges. Always includes all 6. */
export function countBySeverity(problems: EnrichedProblem[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 };
  for (const p of problems) counts[p.severity]++;
  return counts;
}

/** Groups problems into severity lanes, dropping empty lanes, hottest first. */
export function groupIntoLanes(
  problems: EnrichedProblem[],
  order: readonly Severity[],
): { severity: Severity; problems: EnrichedProblem[] }[] {
  return order
    .map((severity) => ({
      severity,
      problems: problems.filter((p) => p.severity === severity),
    }))
    .filter((lane) => lane.problems.length > 0);
}

export function formatAge(
  clockSeconds: number,
  nowSeconds: number = Date.now() / 1000,
  locale: Locale = "de",
): string {
  const t = AGE_CATALOG[locale];
  const seconds = Math.max(0, Math.floor(nowSeconds - clockSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rem = minutes % 60;
    return rem ? t.hoursMinutes(hours, rem) : t.hoursOnly(hours);
  }
  const days = Math.floor(hours / 24);
  return t.days(days);
}
