import type { ZabbixItem } from "@auzui/zabbix-client";
import type { Point } from "@auzui/timeseries";
import { isNumericItem } from "./latest-items";

export type Constancy =
  | { kind: "constant" }
  | { kind: "changed-once"; newValue: string; changedAt: number }
  | { kind: "variable" };

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
 * lastvalue === prevvalue (or prevvalue absent, meaning Zabbix has only ever
 * recorded one value) counts as constant. This is the only signal available
 * for text/log/char items (value_type 1/2/4) — a history.get comparison
 * would be too expensive per PLAN.md, and is also used as the numeric
 * item's classification until its series has actually been loaded.
 */
function classifyByPrevValue(item: Pick<ZabbixItem, "lastvalue" | "prevvalue">): Constancy {
  if (item.lastvalue === undefined || item.lastvalue === "") return { kind: "variable" };
  if (item.prevvalue === undefined || item.prevvalue === item.lastvalue) return { kind: "constant" };
  return { kind: "variable" };
}

/**
 * Classifies an item's constancy for the "📌 Fakten (konstant)" section.
 * Pass the item's loaded series (if any, e.g. from the numeric chart it's
 * bound into) for the precise min/max + single-change-point check; without
 * one, falls back to the cheap lastvalue/prevvalue comparison from item.get.
 */
export function classifyConstancy(
  item: Pick<ZabbixItem, "value_type" | "lastvalue" | "prevvalue">,
  series?: readonly Point[],
): Constancy {
  if (isNumericItem(item) && series && series.length > 0) {
    return classifyNumericSeries(series);
  }
  return classifyByPrevValue(item);
}
