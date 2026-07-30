import type { ZabbixItem } from "@auzui/zabbix-client";
import type { Point } from "@auzui/timeseries";
import { isNumericItem, isTextItem } from "./latest-items";

export type Constancy =
  | { kind: "constant" }
  | { kind: "changed-once"; newValue: string; changedAt: number }
  | { kind: "variable" };

/** The viewed time range, used for the text-item age heuristic (see classifyConstancy). */
export interface ConstancyRange {
  /** Reference "now" in epoch seconds — the end of the currently viewed range. */
  now: number;
  /** Length of the currently viewed range in seconds. */
  rangeSeconds: number;
}

/**
 * Numeric constancy over a loaded series: constant when min==max across all
 * points; "changed-once" when there is exactly one value transition (the
 * Fakten list then shows old→new + the transition's timestamp); otherwise
 * variable. Requires the series to already be loaded (e.g. via
 * useTimeseries for the section the item is showing in) — this function
 * does no fetching itself.
 */
function classifyNumericSeries(points: readonly Point[]): Constancy {
  if (points.length === 0) return { kind: "variable" };

  let min = points[0]!.v;
  let max = points[0]!.v;
  let changes = 0;
  let lastValue = points[0]!.v;
  let changeIndex = -1;
  for (let i = 1; i < points.length; i++) {
    const v = points[i]!.v;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v !== lastValue) {
      changes++;
      changeIndex = i;
      lastValue = v;
    }
  }

  if (min === max) return { kind: "constant" };
  if (changes === 1 && changeIndex >= 0) {
    return { kind: "changed-once", newValue: String(points[changeIndex]!.v), changedAt: points[changeIndex]!.t };
  }
  return { kind: "variable" };
}

/**
 * Cheap constancy check straight from item.get fields (no history fetch):
 * lastvalue === prevvalue (or no previous value at all) counts as constant.
 * This is the only signal available for text/log/char items (value_type
 * 1/2/4) — a history.get comparison would be too expensive per PLAN.md — and
 * is also used as the numeric item's classification until its series has
 * actually been loaded.
 *
 * Two robustness fixes over the naive `prevvalue === undefined` check:
 *   1. Zabbix reports `prevvalue` as an EMPTY STRING (not undefined) when only
 *      one history value has ever been stored (typical for rarely-polled
 *      config-style items). Treat "" the same as absent → constant. Without
 *      this, `"" !== "65534"` wrongly classified such items as variable and
 *      kept them out of the Fakten rubric.
 *   2. Age heuristic for text items only (value_type 1/2/4), which have no
 *      numeric series to inspect: if the last value arrived (item.lastclock)
 *      MORE than half the viewed range ago, the value has not changed for the
 *      bulk of the visible window, so treat it as constant even when a stale
 *      prevvalue happens to differ. Half (not the full range) is used so a
 *      value that flipped just before the window opened still reads constant.
 *      Purely range-driven, hence fully reversible when the range widens.
 */
function classifyByPrevValue(
  item: Pick<ZabbixItem, "value_type" | "lastvalue" | "prevvalue" | "lastclock">,
  range?: ConstancyRange,
): Constancy {
  if (item.lastvalue === undefined || item.lastvalue === "") return { kind: "variable" };
  const noPrev = item.prevvalue === undefined || item.prevvalue === "";
  if (noPrev || item.prevvalue === item.lastvalue) return { kind: "constant" };

  if (range && isTextItem(item) && item.lastclock !== undefined && item.lastclock !== "") {
    const ageSeconds = range.now - Number(item.lastclock);
    if (Number.isFinite(ageSeconds) && ageSeconds > range.rangeSeconds / 2) {
      return { kind: "constant" };
    }
  }
  return { kind: "variable" };
}

/**
 * Classifies an item's constancy for the "📌 Fakten (konstant)" section.
 * Pass the item's loaded series (if any, e.g. from the numeric chart it's
 * bound into) for the precise min/max + single-change-point check; without
 * one, falls back to the cheap lastvalue/prevvalue comparison from item.get.
 * `range` enables the text-item age heuristic (see classifyByPrevValue) and,
 * because it is derived from the currently viewed range, makes the
 * classification reactive/reversible when the user changes that range.
 */
export function classifyConstancy(
  item: Pick<ZabbixItem, "value_type" | "lastvalue" | "prevvalue" | "lastclock">,
  series?: readonly Point[],
  range?: ConstancyRange,
): Constancy {
  if (isNumericItem(item) && series && series.length > 0) {
    return classifyNumericSeries(series);
  }
  return classifyByPrevValue(item, range);
}
