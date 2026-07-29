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
 * onEmptyChange; die Karte bleibt dabei gemountet und wird nur per CSS
 * (`hidden`) ausgeblendet — NICHT aus dem Grid entfernt. Dadurch kann eine
 * Karte, sobald doch Daten eintreffen (Live-Tick, Influx-Recovery,
 * Range-Wechsel), sich wieder als nicht-leer melden und sichtbar werden; das
 * frühere Unmount-der-leeren-Karte hat sie für immer versteckt. Sind ALLE
 * gemounteten Charts leer, kollabiert die ganze Sektion zu einem schmalen
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

  // Mounted set is position-based (never depends on emptiness) so a chart
  // flipping empty/non-empty does not change WHICH cards are mounted — the
  // empties just get CSS-hidden in place. Overflow charts past
  // MAX_CHARTS_PER_SECTION stay unmounted (no queries) until "show more".
  const mountedCharts = showAll ? section.charts : section.charts.slice(0, MAX_CHARTS_PER_SECTION);
  const hiddenOverflowCount = section.charts.length - mountedCharts.length;

  const emptyCount = mountedCharts.reduce((n, c) => n + (emptyIds.has(c.id) ? 1 : 0), 0);
  // Only collapse the whole section when every mounted chart is empty AND
  // nothing is hidden behind "show more" (otherwise there may be data past the
  // overflow cutoff we haven't queried yet).
  const allEmpty = mountedCharts.length > 0 && hiddenOverflowCount === 0 && emptyCount === mountedCharts.length;
  const sectionCollapsed = allEmpty && !showEmpty;

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
            {mountedCharts.map((chart) => {
              // Kept mounted so it keeps its query alive and can re-report
              // non-empty; `hidden` (display:none) just drops it from the grid.
              const hide = emptyIds.has(chart.id) && !showEmpty;
              return (
                <div key={chart.id} className={hide ? "hidden" : undefined}>
                  <ChartCard chart={chart} range={range} onBrush={onBrush} onEmptyChange={handleEmptyChange} />
                </div>
              );
            })}
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
