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
