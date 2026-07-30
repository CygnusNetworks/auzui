import { useMemo } from "react";
import type { ZabbixItem } from "@auzui/zabbix-client";
import type { Series } from "@auzui/timeseries";
import { TimeChartPanel } from "../../components/charts/TimeChartPanel";
import { resolveSeriesColor } from "../../lib/series-colors";
import { useT } from "../../lib/i18n";
import { groupSeriesByUnit } from "./panels";

/** Gemeinsame uPlot-Cursor-Sync-Gruppe: ein Crosshair spiegelt über alle Panels. */
const SYNC_KEY = "auzui-metrics-panels";

/**
 * Multi-Panel-Graph-Bereich (Vorschlag D): Serien werden nach Einheit
 * gruppiert (ein Panel je Einheit), untereinander gestapelt, mit gemeinsamer
 * Zeitachse und synchronem Crosshair (cursor.sync). Der Entfernen-Button eines
 * Panels nimmt dessen Serien aus der Auswahl. Brush-Zoom setzt den gemeinsamen
 * Range (onBrush).
 */
export function PanelStack({
  items,
  seriesByItem,
  colorIndexById,
  isLoading,
  isFetching,
  slow,
  onRetry,
  onBrush,
  onRemovePanel,
}: {
  items: ZabbixItem[];
  seriesByItem: Map<string, Series>;
  colorIndexById: Map<string, number>;
  isLoading: boolean;
  isFetching: boolean;
  slow: boolean;
  onRetry: () => void;
  onBrush: (from: number, to: number) => void;
  onRemovePanel: (itemIds: string[]) => void;
}) {
  const t = useT();
  const groups = useMemo(() => groupSeriesByUnit(items, (i) => i.units), [items]);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const groupItemIds = group.series.map((i) => i.itemid);
        // Raw unit (may keep a "!" prefix) drives the y-axis formatter; the
        // stripped group.unit only names the panel.
        const rawUnit = group.series[0]?.units || undefined;
        const chartSeries = group.series.map((item) => {
          const hostName = item.hosts?.[0]?.name ?? item.hosts?.[0]?.host ?? "";
          const series = seriesByItem.get(item.itemid);
          return {
            label: `${hostName}: ${item.name}`,
            color: resolveSeriesColor(colorIndexById.get(item.itemid) ?? 0),
            points: (series?.points ?? []).map((p) => [p.t, p.v] as [number, number | null]),
          };
        });
        return (
          <div key={group.unit || "__none__"} className="rounded-md border border-line-soft bg-surface-2/40 p-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-muted">
                {group.unit || t("metrics.panels.noUnit")}
              </span>
              <span className="font-mono text-[10px] text-ink-muted">
                {t("metrics.panels.seriesCount", group.series.length)}
              </span>
              <button
                type="button"
                onClick={() => onRemovePanel(groupItemIds)}
                className="ml-auto rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-2 hover:border-accent/60"
                aria-label={t("metrics.panels.removePanel", group.unit || t("metrics.panels.noUnit"))}
              >
                {t("metrics.panels.remove")}
              </button>
            </div>
            <TimeChartPanel
              series={chartSeries}
              unit={rawUnit}
              height={180}
              syncKey={SYNC_KEY}
              onBrush={onBrush}
              isLoading={isLoading}
              isFetching={isFetching}
              slow={slow}
              onRetry={onRetry}
            />
          </div>
        );
      })}
    </div>
  );
}
