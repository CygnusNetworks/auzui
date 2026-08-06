import { useCallback, useState } from "react";
import type { TimeRange } from "@auzui/timeseries";
import type { ZabbixItem } from "@auzui/zabbix-client";
import type { DashboardChart, DashboardSection as DashboardSectionData } from "../../lib/auto-dashboard";
import { isNumericItem } from "../../lib/latest-items";
import { formatUnitValue } from "../../lib/format-units";
import { ChartCard } from "./ChartCard";
import { LazyMount } from "./LazyMount";
import { useLocale, useT } from "../../lib/i18n";

/** First N charts of a section mount immediately (no viewport gate) so the above-the-fold view doesn't flicker in. */
const EAGER_CHART_COUNT = 4;

/**
 * One einklappbare Sektion des Auto-Dashboards. Alle Charts der Sektion
 * werden gemountet und initial angezeigt — es gibt keine "Mehr anzeigen"-
 * Beschränkung mehr, wer filtern will, benutzt die Filter-Eingabe der Page.
 *
 * Ist die Sektion zu, wird die Chart-Grid gar nicht erst gerendert — die
 * darunterliegenden useTimeseries-Hooks in ChartCard existieren dann nicht,
 * es laufen also keine Queries für eingeklappte Sektionen.
 *
 * Jede Karte steckt zusätzlich in `LazyMount`: statt aller Charts auf einmal
 * mounted nur, was in (oder nahe) den Viewport scrollt — siehe LazyMount.tsx
 * für die Messwerte, die das nötig gemacht haben (199 gleichzeitige Queries
 * auf einem LLD-lastigen Host haben den Browser und das Backend überlastet).
 *
 * Charts ohne Datenpunkte im gewählten Zeitraum melden sich per
 * onEmptyChange; die Karte bleibt dabei gemountet und wird nur per CSS
 * (`hidden`) ausgeblendet — NICHT aus dem Grid entfernt. Dadurch kann eine
 * Karte, sobald doch Daten eintreffen (Live-Tick, Influx-Recovery,
 * Range-Wechsel), sich wieder als nicht-leer melden und sichtbar werden; das
 * frühere Unmount-der-leeren-Karte hat sie für immer versteckt. Sind ALLE
 * Charts der Sektion gemountet UND gemeldet (leer oder konstant sind auch
 * "gemeldet"), UND ausnahmslos alle davon leer, kollabiert die ganze Sektion
 * zu einem schmalen Hinweis-Balken mit Toggle statt der vollen Box. Solange
 * noch nicht gemountete (und damit stumme, da unsichtbar für LazyMount)
 * Karten existieren, bleibt die Sektion offen — sonst würde eine Sektion,
 * deren erste paar Karten zufällig leer sind, fälschlich kollabieren, bevor
 * die restlichen Karten überhaupt eine Chance hatten sich zu melden.
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
  const [showEmpty, setShowEmpty] = useState(false);
  const [emptyIds, setEmptyIds] = useState<Set<string>>(() => new Set());
  const [constantIds, setConstantIds] = useState<Set<string>>(() => new Set());

  const handleEmptyChange = useCallback((chartId: string, empty: boolean) => {
    setEmptyIds((prev) => {
      if (prev.has(chartId) === empty) return prev;
      const next = new Set(prev);
      if (empty) next.add(chartId);
      else next.delete(chartId);
      return next;
    });
  }, []);

  const handleConstantChange = useCallback((chartId: string, constant: boolean) => {
    setConstantIds((prev) => {
      if (prev.has(chartId) === constant) return prev;
      const next = new Set(prev);
      if (constant) next.add(chartId);
      else next.delete(chartId);
      return next;
    });
  }, []);

  // All charts of the section are mounted (eventually) — no overflow cutoff
  // anymore, LazyMount just defers *when* each one mounts.
  const mountedCharts = section.charts;

  const emptyCount = mountedCharts.reduce((n, c) => n + (emptyIds.has(c.id) ? 1 : 0), 0);
  // A chart has "reported" once ChartCard mounted and its query settled,
  // marking it either empty or constant (chart ids only ever end up in one
  // of the two sets, so a plain size sum is a safe count of distinct
  // reporters). LazyMount keeps not-yet-visible charts unmounted, so they
  // never report — collapsing the section before every chart has reported
  // would silently hide charts nobody has looked at yet. Only once every
  // chart has reported, and every one of them turned out empty, does the
  // section collapse.
  const allReported = emptyIds.size + constantIds.size === section.charts.length && section.charts.length > 0;
  const allEmpty = allReported && emptyCount === mountedCharts.length;
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
          <FactsBar charts={mountedCharts.filter((c) => constantIds.has(c.id))} />
          <div className="grid grid-cols-2 gap-3 max-[1100px]:grid-cols-1">
            {mountedCharts.map((chart, index) => {
              // Kept mounted so it keeps its query alive and can re-report
              // non-empty / non-constant; `hidden` (display:none) just drops it
              // from the grid. Constant charts are always hidden here — they
              // surface in the FactsBar instead — but stay mounted so a range
              // change can flip them back to a real graph.
              const hide = (emptyIds.has(chart.id) && !showEmpty) || constantIds.has(chart.id);
              return (
                <div key={chart.id} className={hide ? "hidden" : undefined}>
                  <LazyMount eager={index < EAGER_CHART_COUNT}>
                    <ChartCard
                      chart={chart}
                      range={range}
                      onBrush={onBrush}
                      onEmptyChange={handleEmptyChange}
                      onConstantChange={handleConstantChange}
                    />
                  </LazyMount>
                </div>
              );
            })}
          </div>
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

/**
 * Compact facts strip for charts whose series turned out flat (constant) in
 * the selected range — rendered in place of the useless flatline graphs, like
 * the Latest-Data "Fakten" rubric: item name, current value (formatUnitValue),
 * and a "konstant" marker. Each constant multi-series chart contributes one
 * row per series item.
 */
function FactsBar({ charts }: { charts: DashboardChart[] }) {
  const t = useT();
  const { locale } = useLocale();
  if (charts.length === 0) return null;

  const facts = charts.flatMap((chart) =>
    chart.items.map((item, i) => ({
      key: `${chart.id}:${item.itemid}`,
      label: chart.items.length > 1 ? `${chart.title} · ${chart.seriesLabels[i] ?? item.name}` : item.name,
      value: factValue(item, locale),
    })),
  );

  return (
    <div className="mb-3 rounded-md border border-line-soft bg-surface-2 px-3 py-2">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
        {t("hostDetail.dashboard.facts")}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 max-[700px]:grid-cols-1">
        {facts.map((f) => (
          <div key={f.key} className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="truncate text-ink-2">{f.label}</span>
            <span className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="font-mono text-ink">{f.value}</span>
              <span className="font-mono text-[9.5px] uppercase text-ink-muted">
                {t("hostDetail.dashboard.factMarker")}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function factValue(item: ZabbixItem, locale: ReturnType<typeof useLocale>["locale"]): string {
  if (item.lastvalue === undefined || item.lastvalue === "") return "–";
  return isNumericItem(item) ? formatUnitValue(Number(item.lastvalue), item.units, 1, locale) : item.lastvalue;
}
