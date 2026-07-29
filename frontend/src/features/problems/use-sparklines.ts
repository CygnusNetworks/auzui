import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ZabbixApiSource, rangeFromPreset, type Series } from "@auzui/timeseries";
import { zabbixApi } from "../../lib/auth/store";
import type { EnrichedProblem } from "../../lib/problems";
import { classifyConstancy } from "../../lib/constant-items";

const source = new ZabbixApiSource(zabbixApi);

/**
 * Pure decision whether a trigger-item sparkline carries any signal worth
 * drawing. Suppressed when (a) the item is not numeric (value_type not 0/3 —
 * e.g. a text "Health check missing" item), (b) the series is too short to
 * form a line, or (c) the loaded series is constant (min == max, a flat line).
 * Reuses classifyConstancy so the "constant" definition matches Latest Data.
 */
export function shouldShowSparkline(
  valueType: "0" | "3" | undefined,
  series: Series | undefined,
): boolean {
  if (valueType !== "0" && valueType !== "3") return false;
  if (!series || series.points.length < 2) return false;
  const constancy = classifyConstancy(
    { value_type: valueType, lastvalue: "", prevvalue: undefined },
    series.points,
  );
  return constancy.kind !== "constant";
}

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
