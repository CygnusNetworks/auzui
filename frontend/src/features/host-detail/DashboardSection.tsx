import { useState } from "react";
import type { TimeRange } from "@auzui/timeseries";
import type { DashboardSection as DashboardSectionData } from "../../lib/auto-dashboard";
import { MAX_CHARTS_PER_SECTION } from "../../lib/auto-dashboard";
import { ChartCard } from "./ChartCard";

/**
 * One einklappbare Sektion des Auto-Dashboards. Charts jenseits von
 * MAX_CHARTS_PER_SECTION bleiben hinter "N weitere anzeigen" versteckt.
 * Ist die Sektion zu, wird die Chart-Grid gar nicht erst gerendert — die
 * darunterliegenden useTimeseries-Hooks in ChartCard existieren dann nicht,
 * es laufen also keine Queries für eingeklappte Sektionen.
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
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const visibleCharts = showAll ? section.charts : section.charts.slice(0, MAX_CHARTS_PER_SECTION);
  const hiddenCount = section.charts.length - visibleCharts.length;

  return (
    <div className="rounded-lg border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-line-soft px-3.5 py-2.5 text-left"
      >
        <span className="font-mono text-[11px] text-ink-muted">{open ? "▾" : "▸"}</span>
        <span className="text-sm font-semibold capitalize text-ink">{section.section}</span>
        <span className="ml-auto font-mono text-[11px] text-ink-muted">{section.charts.length} Charts</span>
      </button>

      {open && (
        <div className="p-3.5">
          <div className="grid grid-cols-2 gap-3 max-[1100px]:grid-cols-1">
            {visibleCharts.map((chart) => (
              <ChartCard key={chart.id} chart={chart} range={range} onBrush={onBrush} />
            ))}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
            >
              {hiddenCount} weitere anzeigen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
