import type { Point } from "@auzui/timeseries";
import { classifyConstancy } from "../../lib/constant-items";

/**
 * Whether a chart's loaded data is entirely flat — every (non-empty) series is
 * constant (min == max) and at least one series has points. Such a chart is a
 * useless flatline ("logged-in users: 0", "agent availability: 1") and is
 * shown as a *fact* (name + value) instead of a graph. Reuses the Latest-Data
 * `classifyConstancy` so both surfaces judge constancy identically.
 *
 * This is a state SEPARATE from "empty": a constant chart HAS data, so
 * isChartEmpty stays false. And because it is recomputed from the currently
 * loaded series on every render (not latched), a range change that makes a
 * previously flat series vary flips it straight back to a graph — no one-way
 * trap like the old empty-card unmount bug.
 */
export function isSeriesConstant(seriesPoints: readonly (readonly Point[])[]): boolean {
  const nonEmpty = seriesPoints.filter((pts) => pts.length > 0);
  if (nonEmpty.length === 0) return false;
  return nonEmpty.every((pts) => classifyConstancy({ value_type: "0" }, pts).kind === "constant");
}

export interface ChartEmptyInput {
  /** Counter/"uptime" cards render a single last value — a time series (and thus "no data points in range") never applies. */
  isCounter: boolean;
  /**
   * The timeseries query has settled in a success state. In React Query terms
   * this is `isSuccess` — which is also true for keepPreviousData placeholder
   * data, so a card that previously had points stays "has data" across a key
   * switch instead of blinking to empty.
   */
  isSuccess: boolean;
  /** At least one requested item returned ≥1 point for the range. */
  hasData: boolean;
}

/**
 * A chart counts as "empty" (→ hidden by the section) ONLY once its query has
 * genuinely succeeded and returned zero points.
 *
 * Deliberately conservative: any loading, fetching or error state yields
 * `false` (not-yet-empty). That is what stops the two failure modes behind the
 * "almost all graphs disappear" regression:
 *  - a transient race during a `placeholderData: keepPreviousData` key switch
 *    (source zabbix→influx swap on mount, live-tick range bumps) where the old
 *    `!isLoading` test flipped to "empty" before real data arrived, and
 *  - an errored query on the Influx path (where `slow` was false), which the
 *    old test also mis-read as "empty" and hid the chart forever.
 */
export function isChartEmpty(input: ChartEmptyInput): boolean {
  return !input.isCounter && input.isSuccess && !input.hasData;
}
