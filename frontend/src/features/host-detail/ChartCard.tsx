import { useEffect, useMemo } from "react";
import type { ZabbixItem } from "@auzui/zabbix-client";
import type { TimeRange } from "@auzui/timeseries";
import type { TimeChartSeries } from "../../components/charts/TimeChart";
import { TimeChartPanel } from "../../components/charts/TimeChartPanel";
import { formatUnitValue } from "../../lib/format-units";
import { useTimeseries } from "../../lib/use-timeseries";
import type { DashboardChart } from "../../lib/auto-dashboard";
import { useLocale } from "../../lib/i18n";
import { isChartEmpty, isSeriesConstant } from "./chart-empty";

const CHART_POINTS = 300;

/**
 * Renders one auto-dashboard chart. `uptime`-classified items ("counter"
 * viz) skip the time series entirely — a counter's history isn't
 * meaningful, the last value is. Everything else (area/line/capacity) is a
 * TimeChart with the item's thresholds drawn as dashed lines.
 */
export function ChartCard({
  chart,
  range,
  onBrush,
  onEmptyChange,
  onConstantChange,
}: {
  chart: DashboardChart;
  range: TimeRange;
  onBrush: (fromSec: number, toSec: number) => void;
  /** Reports whether this chart has no data points for `range` once loading has settled, so the section can hide it. */
  onEmptyChange?: (chartId: string, empty: boolean) => void;
  /** Reports whether this chart's data is entirely flat once loaded, so the section can show it as a fact instead. */
  onConstantChange?: (chartId: string, constant: boolean) => void;
}) {
  const isCounter = chart.viz === "counter";

  const requestItems = useMemo(
    () => chart.items.map((i) => ({ itemid: i.itemid, valueType: Number(i.value_type) as 0 | 3 })),
    [chart.items],
  );

  const { seriesByItem, isLoading, isFetching, isSuccess, slow, refetch } = useTimeseries(requestItems, range, {
    points: CHART_POINTS,
    enabled: !isCounter,
  });

  const hasData = chart.items.some((item) => (seriesByItem.get(item.itemid)?.points.length ?? 0) > 0);
  // A card only counts as empty once its query has genuinely succeeded with
  // zero points (see chart-empty.ts). It reports both directions: it can
  // re-announce "not empty" as soon as data arrives, because the section keeps
  // it mounted (hidden via CSS) rather than unmounting hidden cards.
  const isEmpty = isChartEmpty({ isCounter, isSuccess, hasData });
  // A flat chart (all series constant) is not empty — it becomes a "fact".
  // Recomputed from the current series every render, so a range change that
  // reveals variation flips it back to a graph (no latched one-way state).
  const isConstant =
    !isCounter &&
    isSuccess &&
    isSeriesConstant(chart.items.map((item) => seriesByItem.get(item.itemid)?.points ?? []));

  useEffect(() => {
    onEmptyChange?.(chart.id, isEmpty);
  }, [chart.id, isEmpty, onEmptyChange]);

  useEffect(() => {
    onConstantChange?.(chart.id, isConstant);
  }, [chart.id, isConstant, onConstantChange]);

  if (isCounter) {
    return <CounterCard item={chart.items[0]!} title={chart.title} />;
  }

  const series: TimeChartSeries[] = chart.items.map((item, i) => ({
    label: chart.seriesLabels[i] ?? item.name,
    points: (seriesByItem.get(item.itemid)?.points ?? []).map(
      (p): [number, number | null] => [p.t, p.v],
    ),
  }));

  const unit = chart.items[0]?.units;

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-[12.5px] font-semibold text-ink">{chart.title}</span>
        {unit && <span className="font-mono text-[10.5px] text-ink-muted">{unit}</span>}
      </div>
      <TimeChartPanel
        series={series}
        unit={unit}
        thresholds={chart.thresholds}
        onBrush={onBrush}
        isLoading={isLoading}
        isFetching={isFetching}
        slow={slow}
        onRetry={() => void refetch()}
      />
    </div>
  );
}

function CounterCard({ item, title }: { item: ZabbixItem; title: string }) {
  const { locale } = useLocale();
  const value = item.lastvalue !== undefined ? Number(item.lastvalue) : undefined;
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-1.5 truncate text-[12.5px] font-semibold text-ink">{title}</div>
      <div className="font-mono text-lg text-ink">
        {value !== undefined ? formatUnitValue(value, item.units, 1, locale) : "–"}
      </div>
    </div>
  );
}
