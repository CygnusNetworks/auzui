import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  InfluxSource,
  ZabbixApiSource,
  type QueryOptions,
  type Series,
  type SeriesRequestItem,
  type TimeRange,
} from "@auzui/timeseries";
import { zabbixApi, useAuthStore } from "./auth/store";

const zabbixSource = new ZabbixApiSource(zabbixApi);

/**
 * PLAN.md M3 Degradations-Polish: without Influx, history.get can take ~50s
 * or time out outright on large instances/cold history (see PLAN.md
 * "Messung"). A query stuck past this budget is treated the same as a
 * failure — callers get `slow: true` and stop showing an endless spinner.
 */
export const QUERY_TIMEOUT_MS = 30_000;

class TimeseriesTimeoutError extends Error {
  constructor() {
    super("Zeitreihen-Abfrage hat das Zeitlimit überschritten");
    this.name = "TimeseriesTimeoutError";
  }
}

/** Exported for callers (e.g. web-scenarios) that query history.get/trend.get directly instead of through ZabbixApiSource. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeseriesTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Whether the auzui-gateway has InfluxDB (effluence) configured — queried
 * once and cached for the app's lifetime (staleTime: Infinity); a redeploy
 * with a newly configured gateway just needs a page reload, same as
 * useAppConfig.
 */
function useInfluxEnabled() {
  return useQuery({
    queryKey: ["ts-gateway-status"],
    queryFn: () => InfluxSource.status(),
    staleTime: Infinity,
    retry: 1,
  });
}

/**
 * General-purpose timeseries hook: picks InfluxSource when the gateway
 * advertises it, else falls back to ZabbixApiSource (history.get/trend.get).
 * Distinct from useSparklines (features/problems) — that hook is
 * purpose-built for the problems cards' tiny always-zabbix-api sparklines
 * and intentionally stays untouched.
 */
export function useTimeseries(
  items: SeriesRequestItem[],
  range: TimeRange,
  opts: QueryOptions & { enabled?: boolean } = {},
) {
  const token = useAuthStore((s) => s.token);
  const { data: influxEnabled } = useInfluxEnabled();

  const source = useMemo(
    () =>
      influxEnabled
        ? new InfluxSource({ getToken: () => token ?? undefined })
        : zabbixSource,
    [influxEnabled, token],
  );

  const itemIds = useMemo(() => items.map((i) => i.itemid).sort(), [items]);
  const { enabled = true, points, fn } = opts;

  const query = useQuery({
    queryKey: ["timeseries", source.kind, itemIds, range.from, range.to, points, fn],
    queryFn: ({ signal }) => withTimeout(source.query(items, range, { points, fn, signal }), QUERY_TIMEOUT_MS),
    enabled: enabled && items.length > 0,
    staleTime: 30_000,
    retry: false,
    // Live-Modus bumpt range.from/to alle 30s, was sonst einen neuen
    // queryKey erzeugt und den Chart kurz auf isLoading/undefined zurückwirft
    // ("Reload"-Sprung) — keepPreviousData hält den alten Graphen sichtbar,
    // bis die neuen Punkte da sind.
    placeholderData: keepPreviousData,
  });

  // "Influx disabled" == running on ZabbixApiSource — the only path with the
  // slow/cold-history failure mode described in PLAN.md. On a timeout or any
  // other failure while on that path, surface `slow: true` so the chart's
  // container can show a retry hint instead of spinning forever.
  const slow = query.isError && source.kind === "zabbix-api";

  return useMemo(() => {
    const map = new Map<string, Series>();
    for (const s of query.data ?? []) map.set(s.itemid, s);
    return {
      seriesByItem: map,
      isLoading: query.isLoading,
      /** True while a background refetch (e.g. the 30s live tick) is in flight and previous data is still shown. */
      isFetching: query.isFetching,
      /** True once the query has settled successfully (incl. keepPreviousData placeholder) — used to decide "genuinely empty". */
      isSuccess: query.isSuccess,
      isError: query.isError,
      error: query.error,
      slow,
      refetch: query.refetch,
      source: source.kind,
    };
  }, [
    query.data,
    query.isLoading,
    query.isFetching,
    query.isSuccess,
    query.isError,
    query.error,
    slow,
    query.refetch,
    source.kind,
  ]);
}
