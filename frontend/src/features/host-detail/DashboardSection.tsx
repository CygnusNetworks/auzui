import { useCallback, useState } from "react";
import type { TimeRange } from "@auzui/timeseries";
import type { DashboardSection as DashboardSectionData } from "../../lib/auto-dashboard";
import { MAX_CHARTS_PER_SECTION } from "../../lib/auto-dashboard";
import { ChartCard } from "./ChartCard";
import { useT } from "../../lib/i18n";

/**
 * One einklappbare Sektion des Auto-Dashboards. Charts jenseits von
 * MAX_CHARTS_PER_SECTION bleiben hinter "N weitere anzeigen" versteckt.
 * Ist die Sektion zu, wird die Chart-Grid gar nicht erst gerendert — die
 * darunterliegenden useTimeseries-Hooks in ChartCard existieren dann nicht,
 * es laufen also keine Queries für eingeklappte Sektionen.
 *
 * Charts ohne Datenpunkte im gewählten Zeitraum melden sich per
 * onEmptyChange ab (ChartCard rendert dann selbst `null`); sind ALLE Charts
 * einer Sektion leer, kollabiert die ganze Sektion zu einem schmalen
 * Hinweis-Balken mit Toggle statt der vollen Box.
 */
export function DashboardSection({
  section,
  range,
  onBrush,
}: {
  section: DashboardSectionData;
  range: TimeRange;
  onBrush: (fromSec: number, toSec: number) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [emptyIds, setEmptyIds] = useState<Set<string>>(() => new Set());

  const handleEmptyChange = useCallback((chartId: string, empty: boolean) => {
    setEmptyIds((prev) => {
      if (prev.has(chartId) === empty) return prev;
      const next = new Set(prev);
      if (empty) next.add(chartId);
      else next.delete(chartId);
      return next;
    });
  }, []);

  const nonEmptyCharts = section.charts.filter((c) => !emptyIds.has(c.id));
  const emptyCount = section.charts.length - nonEmptyCharts.length;
  const allEmpty = section.charts.length > 0 && emptyCount === section.charts.length;
  const sectionCollapsed = allEmpty && !showEmpty;

  const displayCharts = showEmpty ? section.charts : nonEmptyCharts;
  const visibleCharts = showAll ? displayCharts : displayCharts.slice(0, MAX_CHARTS_PER_SECTION);
  const hiddenOverflowCount = displayCharts.length - visibleCharts.length;

  if (sectionCollapsed) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line-soft bg-surface px-3.5 py-2">
        <span className="text-sm font-semibold capitalize text-ink-muted">{section.section}</span>
        <span className="font-mono text-[11px] text-ink-muted">
          {t("hostDetail.dashboard.hiddenNoData", emptyCount)}
        </span>
        <button
          type="button"
          onClick={() => setShowEmpty(true)}
          className="ml-auto rounded-md border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-2"
        >
          {t("hostDetail.dashboard.show")}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-line-soft px-3.5 py-2.5 text-left"
      >
        <span className="font-mono text-[11px] text-ink-muted">{open ? "▾" : "▸"}</span>
        <span className="text-sm font-semibold capitalize text-ink">{section.section}</span>
        <span className="ml-auto font-mono text-[11px] text-ink-muted">
          {t("hostDetail.dashboard.chartsCount", section.charts.length)}
        </span>
      </button>

      {open && (
        <div className="p-3.5">
          <div className="grid grid-cols-2 gap-3 max-[1100px]:grid-cols-1">
            {visibleCharts.map((chart) => (
              <ChartCard key={chart.id} chart={chart} range={range} onBrush={onBrush} onEmptyChange={handleEmptyChange} />
            ))}
          </div>
          {hiddenOverflowCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
            >
              {t("hostDetail.dashboard.showMore", hiddenOverflowCount)}
            </button>
          )}
          {emptyCount > 0 && (
            <div className="mt-2.5 flex items-center gap-2 font-mono text-[10.5px] text-ink-muted">
              <span>{t("hostDetail.dashboard.hiddenNoData", emptyCount)}</span>
              <button type="button" onClick={() => setShowEmpty((v) => !v)} className="underline underline-offset-2">
                {showEmpty ? t("hostDetail.dashboard.hide") : t("hostDetail.dashboard.show")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
