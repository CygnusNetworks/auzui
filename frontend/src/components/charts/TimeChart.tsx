import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { formatAxisTick, formatUnitValue } from "../../lib/format-units";
import { useLocale, type Locale } from "../../lib/i18n";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Locale-aware x-axis (date) tick labels. uPlot gives tick values in Unix
 * seconds plus the chosen tick spacing (`foundIncr`, also seconds); spacing of
 * a day or more → a date label, otherwise a time-of-day label.
 *
 * Only `de` overrides here — `en` keeps uPlot's built-in English defaults
 * (axis gets no `values`, so this returns undefined for `en`).
 */
function xAxisTimeValues(
  locale: Locale,
): ((self: uPlot, splits: number[], axisIdx: number, foundSpace: number, foundIncr: number) => string[]) | undefined {
  if (locale !== "de") return undefined;
  return (_self, splits, _axisIdx, _foundSpace, foundIncr) =>
    splits.map((sec) => {
      const d = new Date(sec * 1000);
      // ≥ 1 day between ticks → show the date (dd.MM.), else 24h time (HH:mm).
      return foundIncr >= 86_400
        ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.`
        : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    });
}

export interface TimeChartSeries {
  label: string;
  /** [unixSeconds, value][] — null/undefined value renders as a gap. */
  points: [number, number | null][];
  color?: string;
}

export interface TimeChartThreshold {
  value: number;
  label?: string;
  /** Maps to the severity design tokens; defaults to "warn". */
  severity?: "high" | "avg" | "warn" | "info" | "ok";
}

export interface TimeChartProps {
  series: TimeChartSeries[];
  unit?: string;
  height?: number;
  thresholds?: TimeChartThreshold[];
  /** Drag-to-select on the plot calls this with the selection as Unix seconds instead of auto-zooming. */
  onBrush?: (fromSec: number, toSec: number) => void;
  /**
   * Optional uPlot cursor-sync group key. When set, this chart joins the named
   * sync group so a crosshair in one chart mirrors across all charts sharing
   * the key (used by the metrics Panel-Stack). Omitted → no sync, identical
   * behaviour as before.
   */
  syncKey?: string;
}

const CHART_COLOR_VARS = ["--color-chart-1", "--color-chart-2", "--color-chart-3", "--color-chart-4"];

const THRESHOLD_COLOR_VAR: Record<NonNullable<TimeChartThreshold["severity"]>, string> = {
  high: "--color-sev-high",
  avg: "--color-sev-avg",
  warn: "--color-sev-warn",
  info: "--color-sev-info",
  ok: "--color-sev-ok",
};

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * uPlot's y-axis defaults to a fixed 50px width, which clips longer tick
 * labels (e.g. formatAxisTick's "12.3 Mbps") instead of growing to fit them.
 * Measures the widest rendered label each cycle and sizes the axis to match,
 * per uPlot's own dynamic-size-axis pattern.
 */
function dynamicAxisSize(self: uPlot, values: string[] | null, axisIdx: number, cycleNum: number): number {
  const axis = self.axes[axisIdx]!;
  if (cycleNum > 1) return (axis as unknown as { _size: number })._size ?? 50;

  let axisSize = (axis.ticks?.size ?? 0) + (axis.gap ?? 0);
  const longestVal = (values ?? []).reduce((acc, val) => (val.length > acc.length ? val : acc), "");
  if (longestVal !== "") {
    self.ctx.font = Array.isArray(axis.font) ? axis.font[0] : axis.font;
    axisSize += self.ctx.measureText(longestVal).width / devicePixelRatio;
  }
  return Math.ceil(axisSize);
}

/** Merges per-series [t,v] pairs onto one shared, sorted x-axis (uPlot requires aligned columns). */
function toUplotData(series: TimeChartSeries[]): uPlot.AlignedData {
  const allTimes = new Set<number>();
  for (const s of series) for (const [t] of s.points) allTimes.add(t);
  const xs = [...allTimes].sort((a, b) => a - b);
  const ys = series.map((s) => {
    const byTime = new Map(s.points);
    return xs.map((t) => byTime.get(t) ?? null);
  });
  return [xs, ...ys] as uPlot.AlignedData;
}

function drawThresholds(thresholds: TimeChartThreshold[]) {
  return (u: uPlot) => {
    const ctx = u.ctx;
    ctx.save();
    for (const t of thresholds) {
      const y = u.valToPos(t.value, "y", true);
      if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) continue;
      ctx.strokeStyle = cssVar(THRESHOLD_COLOR_VAR[t.severity ?? "warn"]);
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(u.bbox.left, y);
      ctx.lineTo(u.bbox.left + u.bbox.width, y);
      ctx.stroke();
    }
    ctx.restore();
  };
}

/**
 * uPlot wrapper for one or more time series. Only rebuilds the uPlot
 * instance when the chart's *structure* changes (series labels/colors, unit,
 * height, thresholds, presence of onBrush, or the dark/light theme) — a pure
 * data update (e.g. the 30s live-refresh tick) instead calls uPlot's
 * `setData` in place so the chart never unmounts/flashes a placeholder.
 */
export function TimeChart({ series, unit, height = 220, thresholds = [], onBrush, syncKey }: TimeChartProps) {
  const { locale } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const onBrushRef = useRef(onBrush);
  onBrushRef.current = onBrush;
  const [, forceRerender] = useState(0);

  // Re-render on .dark class toggles (ThemeToggle flips this on <html>) so the effect below re-reads CSS vars.
  useEffect(() => {
    const observer = new MutationObserver(() => forceRerender((n) => n + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Structural signature — only changes here should trigger a full uPlot
  // rebuild. New/changed data points alone (same labels/colors/etc.) must
  // NOT appear here, so a live refetch goes through the setData effect below.
  const structuralKey = JSON.stringify({
    labels: series.map((s) => s.label),
    colors: series.map((s) => s.color),
    unit,
    height,
    thresholds,
    hasOnBrush: !!onBrush,
    syncKey,
    // Axis tick formatters (x date + y number) close over `locale`, so a
    // language switch must trigger a full rebuild, not just a setData update.
    locale,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ink2 = cssVar("--color-ink-2");
    const lineSoft = cssVar("--color-line-soft");

    const uSeries: uPlot.Series[] = [
      {},
      ...series.map((s, i) => ({
        label: s.label,
        stroke: s.color ?? cssVar(CHART_COLOR_VARS[i % CHART_COLOR_VARS.length]!),
        width: 1.6,
        points: { show: false },
        // toUplotData merges every series onto a union x-axis, so any series
        // whose (downsampled) timestamps don't coincide with the others' gets
        // nulls at their x-positions. With point markers off, an isolated
        // value between two nulls draws nothing — a whole series could vanish.
        // spanGaps connects across those union-axis holes so the line stays
        // visible. The gateway aligns same-cadence items to a shared grid
        // (influx_min_window_seconds), so this only bridges genuine
        // per-series gaps (e.g. mixed poll intervals in one chart).
        spanGaps: true,
        // The legend prints the value under the cursor; without this it shows
        // uPlot's raw number (e.g. "1258291200"). Route it through the same
        // unit formatter the y-axis uses so it reads "1.2 GiB" / "12.3 Mbps".
        value: (_u: uPlot, v: number | null) => (v == null ? "–" : formatUnitValue(v, unit, 1, locale)),
      })),
    ];

    const opts: uPlot.Options = {
      width: container.clientWidth || 600,
      height,
      series: uSeries,
      cursor: {
        drag: { x: true, y: false, setScale: false },
        // Group crosshairs across panels that share the key. `match` keeps the
        // sync limited to the x-axis so panels with different y-units don't try
        // to align vertically. Omitted key → uPlot leaves cursor.sync undefined.
        ...(syncKey ? { sync: { key: syncKey, setSeries: false } } : {}),
      },
      hooks: {
        draw: thresholds.length > 0 ? [drawThresholds(thresholds)] : [],
        setSelect: onBrush
          ? [
              (u) => {
                if (u.select.width < 2) return;
                const from = u.posToVal(u.select.left, "x");
                const to = u.posToVal(u.select.left + u.select.width, "x");
                onBrushRef.current?.(Math.round(from), Math.round(to));
                u.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false);
              },
            ]
          : [],
      },
      axes: [
        {
          stroke: ink2,
          grid: { stroke: lineSoft },
          ticks: { stroke: lineSoft },
          values: xAxisTimeValues(locale),
        },
        {
          stroke: ink2,
          grid: { stroke: lineSoft },
          ticks: { stroke: lineSoft },
          values: (_u, vals) => vals.map((v) => formatAxisTick(v, unit, locale)),
          size: dynamicAxisSize,
        },
      ],
      legend: { show: series.length > 1 },
    };

    const plot = new uPlot(opts, toUplotData(series), container);
    plotRef.current = plot;

    // Debounce via rAF — a container resize (e.g. sidebar toggle, window drag)
    // can fire many ResizeObserver callbacks per frame; coalesce to one setSize.
    let rafId: number | undefined;
    const resizeObserver = new ResizeObserver(() => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        plot.setSize({ width: container.clientWidth || 600, height });
      });
    });
    resizeObserver.observe(container);

    return () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      plotRef.current = null;
      plot.destroy();
    };
    // Deps intentionally just [structuralKey] — rebuild only on structural changes, see comment above.
  }, [structuralKey]);

  // Pure data update: same chart structure, new/changed points (e.g. a live
  // refetch) — update the existing uPlot instance in place.
  useEffect(() => {
    plotRef.current?.setData(toUplotData(series));
  }, [series]);

  return <div ref={containerRef} className="w-full" />;
}
