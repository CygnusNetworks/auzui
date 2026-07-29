import { useMemo } from "react";
import type { ZabbixItem } from "@auzui/zabbix-client";
import type { TimeRange } from "@auzui/timeseries";
import { TimeChart, type TimeChartSeries } from "../../components/charts/TimeChart";
import { formatUnitValue } from "../../lib/format-units";
import { useTimeseries } from "../../lib/use-timeseries";
import type { DashboardChart } from "../../lib/auto-dashboard";

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
}: {
  chart: DashboardChart;
  range: TimeRange;
  onBrush: (fromSec: number, toSec: number) => void;
}) {
  const isCounter = chart.viz === "counter";

  const requestItems = useMemo(
    () => chart.items.map((i) => ({ itemid: i.itemid, valueType: Number(i.value_type) as 0 | 3 })),
    [chart.items],
  );

  const { seriesByItem, isLoading } = useTimeseries(requestItems, range, {
    points: CHART_POINTS,
    enabled: !isCounter,
  });

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
      {isLoading && series.every((s) => s.points.length === 0) ? (
        <div className="flex h-[220px] items-center justify-center text-[12px] text-ink-2">Lade…</div>
      ) : (
        <TimeChart series={series} unit={unit} thresholds={chart.thresholds} onBrush={onBrush} />
      )}
    </div>
  );
}

function CounterCard({ item, title }: { item: ZabbixItem; title: string }) {
  const value = item.lastvalue !== undefined ? Number(item.lastvalue) : undefined;
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-1.5 truncate text-[12.5px] font-semibold text-ink">{title}</div>
      <div className="font-mono text-lg text-ink">
        {value !== undefined ? formatUnitValue(value, item.units) : "–"}
      </div>
    </div>
  );
}
