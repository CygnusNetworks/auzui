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
 * uPlot wrapper for one or more time series. Rebuilds the chart when data,
 * options, or the dark/light theme change (theme flips are rare — a full
 * rebuild reading fresh CSS variables is simpler and correct, more important
 * than micro-optimizing chart churn here).
 */
export function TimeChart({ series, unit, height = 220, thresholds = [], onBrush }: TimeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, forceRerender] = useState(0);

  // Re-render on .dark class toggles (ThemeToggle flips this on <html>) so the effect below re-reads CSS vars.
  useEffect(() => {
    const observer = new MutationObserver(() => forceRerender((n) => n + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

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
                onBrush(Math.round(from), Math.round(to));
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

    const resizeObserver = new ResizeObserver(() => {
      plot.setSize({ width: container.clientWidth || 600, height });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      plot.destroy();
    };
  }, [series, unit, height, thresholds, onBrush]);

  return <div ref={containerRef} className="w-full" />;
}
