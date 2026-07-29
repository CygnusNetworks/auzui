import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { formatAxisTick } from "../../lib/format-units";

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
export function TimeChart({ series, unit, height = 220, thresholds = [], onBrush }: TimeChartProps) {
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
      })),
    ];

    const opts: uPlot.Options = {
      width: container.clientWidth || 600,
      height,
      series: uSeries,
      cursor: {
        drag: { x: true, y: false, setScale: false },
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
        { stroke: ink2, grid: { stroke: lineSoft }, ticks: { stroke: lineSoft } },
        {
          stroke: ink2,
          grid: { stroke: lineSoft },
          ticks: { stroke: lineSoft },
          values: (_u, vals) => vals.map((v) => formatAxisTick(v, unit)),
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
