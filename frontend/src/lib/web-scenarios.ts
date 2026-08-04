import type { ZabbixHttpStep, ZabbixHttpTest, ZabbixItem } from "@auzui/zabbix-client";

const DAY_SECONDS = 86_400;

/**
 * Zabbix auto-creates one item per web-scenario signal, keyed by the
 * scenario's (and, for steps, the step's) *name* — not by id. See
 * https://www.zabbix.com/documentation (Web monitoring): "Failed step of
 * scenario", "Last error message", "Response time for step", "Response
 * code for step".
 */
export function webTestKey(kind: "fail" | "error", scenarioName: string): string {
  return `web.test.${kind}[${scenarioName}]`;
}

/**
 * Step items are keyed by the step's *name*, not its number, and the
 * response-time key carries a trailing `resp` parameter:
 * `web.test.time[Scenario,Step,resp]` / `web.test.rspcode[Scenario,Step]`.
 */
export function webTestStepKey(kind: "time" | "rspcode", scenarioName: string, stepName: string): string {
  return kind === "time"
    ? `web.test.time[${scenarioName},${stepName},resp]`
    : `web.test.rspcode[${scenarioName},${stepName}]`;
}

export interface WebScenarioStep {
  step: ZabbixHttpStep;
  responseTimeItem?: ZabbixItem;
  responseCodeItem?: ZabbixItem;
}

export type WebScenarioStatus = "ok" | "degraded" | "failed" | "disabled";

export interface EnrichedWebScenario {
  httptest: ZabbixHttpTest;
  hostId: string;
  hostName: string;
  enabled: boolean;
  steps: WebScenarioStep[];
  failItem?: ZabbixItem;
  errorItem?: ZabbixItem;
  /** 0 = no failure; otherwise the 1-based step number that failed, per web.test.fail. */
  failedStepNo: number;
  lastError?: string;
  status: WebScenarioStatus;
}

/**
 * A step counts as approaching its timeout — and the scenario as
 * "degraded" — once its last response time reaches this fraction of the
 * step's configured timeout. Zabbix has no native degraded state; this is
 * auzui's own early-warning heuristic.
 */
export const DEGRADED_TIMEOUT_FRACTION = 0.7;

function deriveStatus(params: {
  enabled: boolean;
  failedStepNo: number;
  steps: { timeoutSeconds: number; responseSeconds: number | undefined }[];
}): WebScenarioStatus {
  if (!params.enabled) return "disabled";
  if (params.failedStepNo > 0) return "failed";
  const degraded = params.steps.some(
    (s) =>
      s.responseSeconds !== undefined &&
      s.timeoutSeconds > 0 &&
      s.responseSeconds >= s.timeoutSeconds * DEGRADED_TIMEOUT_FRACTION,
  );
  return degraded ? "degraded" : "ok";
}

/**
 * Joins httptest.get rows (with selectSteps) against an item.get result
 * (search key_: "web.test.") to attach each scenario's live status items.
 * Pure — no network access.
 */
export function enrichWebScenarios(
  httptests: ZabbixHttpTest[],
  items: ZabbixItem[],
): EnrichedWebScenario[] {
  const itemsByHost = new Map<string, ZabbixItem[]>();
  for (const item of items) {
    const list = itemsByHost.get(item.hostid);
    if (list) list.push(item);
    else itemsByHost.set(item.hostid, [item]);
  }

  return httptests.map((httptest) => {
    const hostItems = itemsByHost.get(httptest.hostid) ?? [];
    const itemByKey = new Map(hostItems.map((it) => [it.key_, it]));

    const failItem = itemByKey.get(webTestKey("fail", httptest.name));
    const errorItem = itemByKey.get(webTestKey("error", httptest.name));
    const failedStepNo = Number(failItem?.lastvalue ?? 0) || 0;
    const host = httptest.hosts?.[0];

    const steps: WebScenarioStep[] = (httptest.steps ?? [])
      .slice()
      .sort((a, b) => Number(a.no) - Number(b.no))
      .map((step) => ({
        step,
        responseTimeItem: itemByKey.get(webTestStepKey("time", httptest.name, step.name)),
        responseCodeItem: itemByKey.get(webTestStepKey("rspcode", httptest.name, step.name)),
      }));

    const enabled = httptest.status === "0";
    const status = deriveStatus({
      enabled,
      failedStepNo,
      steps: steps.map((s) => ({
        timeoutSeconds: Number(s.step.timeout) || 0,
        responseSeconds: s.responseTimeItem?.lastvalue !== undefined
          ? Number(s.responseTimeItem.lastvalue)
          : undefined,
      })),
    });

    return {
      httptest,
      hostId: httptest.hostid,
      hostName: host?.name || host?.host || httptest.hostid,
      enabled,
      steps,
      failItem,
      errorItem,
      failedStepNo,
      lastError: errorItem?.lastvalue || undefined,
      status,
    };
  });
}

/** Total of the scenario's step response times (seconds), for the list sparkline/sort. */
export function totalResponseSeconds(scenario: EnrichedWebScenario): number {
  return scenario.steps.reduce(
    (sum, s) => sum + (s.responseTimeItem?.lastvalue ? Number(s.responseTimeItem.lastvalue) : 0),
    0,
  );
}

/** Percentage of history points (web.test.fail) that were 0 — pure aggregation, feeds useWebScenarioHistory. */
export function computeAvailability(failHistory: { value: string }[]): number | undefined {
  if (failHistory.length === 0) return undefined;
  const ok = failHistory.filter((p) => Number(p.value) === 0).length;
  return (ok / failHistory.length) * 100;
}

/** trend.get value_avg for a 0/1-valued item is the failed-fraction of that bucket; availability is its complement. */
export function availabilityFromTrendAvg(valueAvg: string): number {
  const failedFraction = Math.min(1, Math.max(0, Number(valueAvg)));
  return (1 - failedFraction) * 100;
}

export interface DailyAvailability {
  /** Unix seconds, start of day (UTC). */
  day: number;
  availability: number;
}

/**
 * Zabbix's trend table is bucketed per *hour*, not per day — a 14-day
 * window returns up to 336 rows. Groups them into one bar per day, each
 * row's failed-fraction weighted by its `num` (sample count), so a hollow
 * hour doesn't count as heavily as a busy one. Pure.
 */
export function aggregateDailyAvailability(
  trendPoints: { clock: string; value_avg: string; num: string }[],
): DailyAvailability[] {
  const byDay = new Map<number, { weightedFailed: number; totalWeight: number }>();
  for (const p of trendPoints) {
    const day = Math.floor(Number(p.clock) / DAY_SECONDS) * DAY_SECONDS;
    const weight = Math.max(0, Number(p.num)) || 1;
    const failedFraction = Math.min(1, Math.max(0, Number(p.value_avg)));
    const bucket = byDay.get(day) ?? { weightedFailed: 0, totalWeight: 0 };
    bucket.weightedFailed += failedFraction * weight;
    bucket.totalWeight += weight;
    byDay.set(day, bucket);
  }
  return [...byDay.entries()]
    .map(([day, { weightedFailed, totalWeight }]) => ({
      day,
      availability: (1 - weightedFailed / totalWeight) * 100,
    }))
    .sort((a, b) => a.day - b.day);
}

export function matchesScenarioSearch(scenario: EnrichedWebScenario, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (scenario.httptest.name.toLowerCase().includes(q)) return true;
  if (scenario.hostName.toLowerCase().includes(q)) return true;
  return scenario.steps.some((s) => s.step.url.toLowerCase().includes(q));
}

export type WebScenarioSortKey = "name" | "status";

const STATUS_RANK: Record<WebScenarioStatus, number> = { failed: 0, degraded: 1, ok: 2, disabled: 3 };

export function sortWebScenarios(
  scenarios: EnrichedWebScenario[],
  key: WebScenarioSortKey,
): EnrichedWebScenario[] {
  const copy = [...scenarios];
  if (key === "name") {
    copy.sort((a, b) => a.httptest.name.localeCompare(b.httptest.name));
    return copy;
  }
  copy.sort((a, b) => {
    const ra = STATUS_RANK[a.status];
    const rb = STATUS_RANK[b.status];
    if (ra !== rb) return ra - rb;
    return a.httptest.name.localeCompare(b.httptest.name);
  });
  return copy;
}

export interface WebScenarioHostGroup {
  hostId: string;
  hostName: string;
  scenarios: EnrichedWebScenario[];
  /** Worst status in the group — drives the header dot and the group order. */
  worstStatus: WebScenarioStatus;
  counts: Record<WebScenarioStatus, number>;
}

/**
 * Groups scenarios by their host. Hosts with a failing scenario come first
 * (same rank as the row sort), then alphabetically; within a group the rows
 * keep the order they were passed in. Pure.
 */
export function groupScenariosByHost(scenarios: EnrichedWebScenario[]): WebScenarioHostGroup[] {
  const byHost = new Map<string, EnrichedWebScenario[]>();
  for (const s of scenarios) {
    const list = byHost.get(s.hostId);
    if (list) list.push(s);
    else byHost.set(s.hostId, [s]);
  }

  return [...byHost.values()]
    .map((group) => {
      const worstStatus = group.reduce<WebScenarioStatus>(
        (worst, s) => (STATUS_RANK[s.status] < STATUS_RANK[worst] ? s.status : worst),
        "disabled",
      );
      return {
        hostId: group[0]!.hostId,
        hostName: group[0]!.hostName,
        scenarios: group,
        worstStatus,
        counts: countByStatus(group),
      };
    })
    .sort((a, b) => {
      const ra = STATUS_RANK[a.worstStatus];
      const rb = STATUS_RANK[b.worstStatus];
      if (ra !== rb) return ra - rb;
      return a.hostName.localeCompare(b.hostName);
    });
}

export function countByStatus(scenarios: EnrichedWebScenario[]): Record<WebScenarioStatus, number> {
  const counts: Record<WebScenarioStatus, number> = { ok: 0, degraded: 0, failed: 0, disabled: 0 };
  for (const s of scenarios) counts[s.status]++;
  return counts;
}

export interface StackedBucket {
  clockStart: number;
  /** Average seconds per step in this bucket, aligned by index to the input series. */
  values: number[];
}

/**
 * Buckets several steps' raw (clock, value) history into a shared set of
 * evenly-sized time windows, averaging within each — so per-step series with
 * independent sample clocks can still be stacked in one chart. Pure.
 */
export function bucketStepHistory(
  stepSeries: { points: { clock: number; value: number }[] }[],
  from: number,
  to: number,
  bucketCount = 12,
): StackedBucket[] {
  const bucketSize = (to - from) / bucketCount || 1;
  const sums = Array.from({ length: bucketCount }, () => stepSeries.map(() => 0));
  const counts = Array.from({ length: bucketCount }, () => stepSeries.map(() => 0));

  stepSeries.forEach((series, si) => {
    for (const p of series.points) {
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((p.clock - from) / bucketSize)));
      sums[idx]![si]! += p.value;
      counts[idx]![si]! += 1;
    }
  });

  return sums.map((stepSums, bi) => ({
    clockStart: from + bi * bucketSize,
    values: stepSums.map((sum, si) => (counts[bi]![si]! > 0 ? sum / counts[bi]![si]! : 0)),
  }));
}
