import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ZabbixApiSource, rangeFromPreset, type Series } from "@auzui/timeseries";
import { zabbixApi } from "../../lib/auth/store";
import type { EnrichedProblem } from "../../lib/problems";

const source = new ZabbixApiSource(zabbixApi);

/**
 * Batches history.get for the "cards" view's trigger-item sparklines — one
 * request per distinct numeric item, last ~30 points over a 1h window.
 * Cached with a high staleTime: sparklines are decoration, not the source of
 * truth (that's the problem row itself), so they don't need to track the 30s
 * problems poll 1:1.
 */
export function useSparklines(problems: EnrichedProblem[]): Map<string, Series> {
  const items = useMemo(() => {
    const seen = new Map<string, 0 | 3>();
    for (const p of problems) {
      if (p.itemId && p.itemValueType && !seen.has(p.itemId)) {
        seen.set(p.itemId, Number(p.itemValueType) as 0 | 3);
      }
    }
    return [...seen.entries()].map(([itemid, valueType]) => ({ itemid, valueType }));
  }, [problems]);

  const itemIds = useMemo(() => items.map((i) => i.itemid).sort(), [items]);

  const query = useQuery({
    queryKey: ["problem-sparklines", itemIds],
    queryFn: () => source.query(items, rangeFromPreset("1h"), { points: 30 }),
    enabled: items.length > 0,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const map = new Map<string, Series>();
    for (const s of query.data ?? []) map.set(s.itemid, s);
    return map;
  }, [query.data]);
}
