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
  /** Latest suppression end (unix seconds); undefined = indefinite/unknown. */
  suppressUntil?: number;
  tags: ZabbixItemTag[];
  hostId?: string;
  hostName?: string;
  triggerExpression?: string;
  /** Trigger allows manual problem closing (event.acknowledge action 1). */
  manualClose?: boolean;
  /** First item on the trigger — candidate for the sparkline, if numeric. */
  itemId?: string;
  itemValueType?: "0" | "3";
  /** Current value of the trigger's item, as returned by trigger.get's expanded item (Zabbix's raw string form — parse before comparing). */
  itemLastValue?: string;
  /** Unix seconds of the item's last poll. */
  itemLastClock?: string;
  /** Zabbix `units` string for the item (e.g. "°C", "%", "" for a bare number). */
  itemUnits?: string;
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
      suppressUntil: latestSuppressUntil(p.suppression_data),
      // "__"-Tags sind interne Marker von Alert-Integrationen
      // (z. B. __message_ts_#zabbix) — nicht anzeigen.
      tags: (p.tags ?? []).filter((t) => !t.tag.startsWith("__")),
      hostId: host?.hostid,
      hostName: host?.host,
      triggerExpression: trigger?.expression,
      manualClose: trigger?.manual_close === "1",
      itemId: numericItem?.itemid,
      itemValueType: numericItem?.value_type as "0" | "3" | undefined,
      itemLastValue: numericItem?.lastvalue,
      itemLastClock: numericItem?.lastclock,
      itemUnits: numericItem?.units,
    };
  });
}

/** Latest finite suppression end; undefined if none or all indefinite ("0"). */
function latestSuppressUntil(
  data: ZabbixProblem["suppression_data"],
): number | undefined {
  const untils = (data ?? [])
    .map((s) => Number(s.suppress_until ?? 0))
    .filter((n) => n > 0);
  return untils.length > 0 ? Math.max(...untils) : undefined;
}

/** "14:30" (same day) or "01.08., 14:30" — for the "suppressed until" chip. */
export function formatSuppressUntil(
  untilSeconds: number,
  locale: Locale = "de",
  nowSeconds: number = Date.now() / 1000,
): string {
  const intl = locale === "de" ? "de-DE" : "en-GB";
  const until = new Date(untilSeconds * 1000);
  const now = new Date(nowSeconds * 1000);
  const sameDay = until.toDateString() === now.toDateString();
  const time = until.toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const date = until.toLocaleDateString(intl, { day: "2-digit", month: "2-digit" });
  return `${date}, ${time}`;
}

export type ThresholdOp = ">" | ">=" | "<" | "<=";

const COMPARISON_OPERATOR_PATTERN = />=|<=|>|</g;

/**
 * Extracts a comparison operator + numeric threshold from a SIMPLE,
 * single-condition trigger expression (e.g. "avg(/host/key,#4)>60").
 * Returns undefined for compound expressions (and/or, more than one
 * comparison) or a non-purely-numeric right-hand side (e.g. Zabbix size
 * suffixes like "1G") — in both cases "over/under threshold" isn't
 * well-defined enough for a color to be trustworthy.
 */
export function parseThreshold(
  expression: string | undefined,
): { op: ThresholdOp; value: number } | undefined {
  if (!expression) return undefined;
  if (/\b(and|or)\b/i.test(expression)) return undefined;

  const matches = expression.match(COMPARISON_OPERATOR_PATTERN);
  if (!matches || matches.length !== 1) return undefined;

  const op = matches[0] as ThresholdOp;
  const right = expression.slice(expression.indexOf(op) + op.length).trim();
  if (!/^-?\d+(\.\d+)?$/.test(right)) return undefined;

  return { op, value: Number(right) };
}

export interface ProblemFilter {
  /** Empty/undefined = no severity filter (show all). */
  severities?: Set<Severity> | Severity[];
  unackOnly?: boolean;
  /** Restrict to a single host, matched by its technical name (⌘K "jump to host's problems"). */
  host?: string;
  /**
   * Show suppressed problems as well. Default (false) hides them client-side —
   * mirroring the `suppressed: false` server filter — so an optimistic suppress
   * removes the row immediately (one clean exit animation) instead of waiting
   * for the next refetch to drop it.
   */
  showSuppressed?: boolean;
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
    if (!filter.showSuppressed && p.suppressed) return false;
    if (filter.host && p.hostName !== filter.host) return false;
    return true;
  });
}

/**
 * Why a problem is not in the visible list, split by cause. `shown` plus all
 * `hidden*` buckets always sum to `total` — each hidden problem is attributed
 * to exactly one cause, in the precedence order below.
 */
export interface VisibilityBreakdown {
  total: number;
  shown: number;
  hiddenBySeverity: number;
  hiddenByHost: number;
  hiddenByAck: number;
  hiddenBySuppressed: number;
  hiddenTotal: number;
  /** Hidden-by-ack per severity lane — feeds the per-lane hint. */
  ackHiddenBySeverity: Record<Severity, number>;
}

/**
 * Decomposes `filterProblems` into "shown" plus one bucket per reason, so the
 * UI can state *why* rows are missing and offer the matching way back.
 *
 * Precedence is explicit filters first (severity, host), then problem state
 * (acknowledged, suppressed): a problem the user filtered out by severity is
 * reported as severity-filtered even when it also happens to be acknowledged —
 * otherwise narrowing the severity would inflate the "acknowledged" bucket with
 * problems the user never meant to see.
 *
 * Caveat: suppressed problems are not fetched at all while `showSuppressed` is
 * off (see useProblems), so `hiddenBySuppressed` only counts the ones already
 * in hand — e.g. during the optimistic window right after suppressing a row.
 */
export function visibilityBreakdown(
  problems: EnrichedProblem[],
  filter: ProblemFilter,
): VisibilityBreakdown {
  const sevSet = filter.severities
    ? filter.severities instanceof Set
      ? filter.severities
      : new Set(filter.severities)
    : undefined;
  const severityActive = sevSet !== undefined && sevSet.size > 0;

  const result: VisibilityBreakdown = {
    total: problems.length,
    shown: 0,
    hiddenBySeverity: 0,
    hiddenByHost: 0,
    hiddenByAck: 0,
    hiddenBySuppressed: 0,
    hiddenTotal: 0,
    ackHiddenBySeverity: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 },
  };

  for (const p of problems) {
    if (severityActive && !sevSet.has(p.severity)) result.hiddenBySeverity++;
    else if (filter.host && p.hostName !== filter.host) result.hiddenByHost++;
    else if (filter.unackOnly && p.acknowledged) {
      result.hiddenByAck++;
      result.ackHiddenBySeverity[p.severity]++;
    } else if (!filter.showSuppressed && p.suppressed) result.hiddenBySuppressed++;
    else result.shown++;
  }
  result.hiddenTotal = result.total - result.shown;
  return result;
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
