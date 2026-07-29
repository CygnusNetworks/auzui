import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
    queryFn: ({ signal }) => source.query(items, range, { points, fn, signal }),
    enabled: enabled && items.length > 0,
    staleTime: 30_000,
  });

  return useMemo(() => {
    const map = new Map<string, Series>();
    for (const s of query.data ?? []) map.set(s.itemid, s);
    return {
      seriesByItem: map,
      isLoading: query.isLoading,
      isError: query.isError,
      error: query.error,
      source: source.kind,
    };
  }, [query.data, query.isLoading, query.isError, query.error, source.kind]);
}
