import type { ZabbixApi } from "@auzui/zabbix-client";
import { lttb, type Point } from "./lttb";
import type {
  QueryOptions,
  Series,
  SeriesRequestItem,
  TimeRange,
  TimeseriesSource,
} from "./source";

export interface ZabbixApiSourceOptions {
  /**
   * Ranges up to this many seconds go to history.get; anything longer uses
   * trend.get (hourly aggregates). PLAN.md: keep this conservative — outside
   * the warm history window history.get can be very slow on large instances.
   * If trend.get comes back empty but history.get has data (Zabbix 8.0 with
   * ClickHouse history keeps no trends), the source falls back to history.get
   * for long ranges too.
   */
  historyMaxRangeSeconds?: number;
}

const DEFAULT_HISTORY_MAX_RANGE = 6 * 3600;

/**
 * Default source: Zabbix JSON-RPC only. Client-side LTTB downsampling to the
 * requested point budget. Long ranges prefer trend.get; once it is seen to
 * return nothing where history.get has data, trends are assumed unavailable
 * and later long-range queries go straight to history.get.
 */
export class ZabbixApiSource implements TimeseriesSource {
  readonly kind = "zabbix-api" as const;
  private readonly historyMaxRange: number;
  private trendsUnavailable = false;

  constructor(
    private readonly api: ZabbixApi,
    opts: ZabbixApiSourceOptions = {},
  ) {
    this.historyMaxRange = opts.historyMaxRangeSeconds ?? DEFAULT_HISTORY_MAX_RANGE;
  }

  async query(
    items: SeriesRequestItem[],
    range: TimeRange,
    opts: QueryOptions = {},
  ): Promise<Series[]> {
    const points = opts.points ?? 800;
    const useTrends = !this.trendsUnavailable && range.to - range.from > this.historyMaxRange;
    return Promise.all(
      items.map((item) =>
        useTrends ? this.queryTrend(item, range, points) : this.queryHistory(item, range, points),
      ),
    );
  }

  private async queryHistory(
    item: SeriesRequestItem,
    range: TimeRange,
    points: number,
  ): Promise<Series> {
    const rows = await this.api.historyGet({
      itemids: [item.itemid],
      history: item.valueType,
      time_from: range.from,
      time_till: range.to,
      sortfield: "clock",
      sortorder: "ASC",
    });
    const raw: Point[] = rows.map((r) => ({ t: Number(r.clock), v: Number(r.value) }));
    return { itemid: item.itemid, points: lttb(raw, points), source: "history" };
  }

  private async queryTrend(
    item: SeriesRequestItem,
    range: TimeRange,
    points: number,
  ): Promise<Series> {
    const rows = await this.api.trendGet({
      itemids: [item.itemid],
      time_from: range.from,
      time_till: range.to,
    });
    const raw: Point[] = rows
      .map((r) => ({ t: Number(r.clock), v: Number(r.value_avg) }))
      .sort((a, b) => a.t - b.t);
    if (raw.length === 0) {
      const fallback = await this.queryHistory(item, range, points);
      if (fallback.points.length > 0) this.trendsUnavailable = true;
      return fallback;
    }
    return { itemid: item.itemid, points: lttb(raw, points), source: "trend" };
  }
}
