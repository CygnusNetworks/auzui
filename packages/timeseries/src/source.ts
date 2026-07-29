import type { Point } from "./lttb";

export interface TimeRange {
  /** Unix seconds. */
  from: number;
  /** Unix seconds. */
  to: number;
}

export interface SeriesRequestItem {
  itemid: string;
  /** Zabbix value_type — selects the history table (0 float, 3 uint). */
  valueType: 0 | 3;
}

export interface QueryOptions {
  /** Target number of points per series (chart pixel budget). Default 800. */
  points?: number;
  /** Aggregation for server-side downsampling paths. Default "last". */
  fn?: "last" | "mean" | "min" | "max";
  signal?: AbortSignal;
}

export interface Series {
  itemid: string;
  points: Point[];
  /** Where the data actually came from (UI shows this). */
  source: "history" | "trend" | "influx";
}

/**
 * Abstraction over the two time-series paths described in PLAN.md:
 * ZabbixApiSource (always available; history.get for short ranges, trend.get
 * beyond) and InfluxSource (optional, via auzui-gateway; server-side
 * aggregateWindow, fast for any range).
 */
export interface TimeseriesSource {
  readonly kind: "zabbix-api" | "influx";
  query(items: SeriesRequestItem[], range: TimeRange, opts?: QueryOptions): Promise<Series[]>;
}
