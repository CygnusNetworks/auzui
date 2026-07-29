import type { Point } from "@auzui/timeseries";

/** Minimal SVG sparkline — mirrors the mock's `spark()` helper. */
export function Sparkline({
  points,
  width = 200,
  height = 28,
  color = "var(--color-chart-1)",
  fill = true,
}: {
  points: Point[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  if (points.length < 2) return null;
  const pad = 2;
  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (points.length - 1);
  const y = (v: number) => height - pad - ((v - min) / range) * (height - 2 * pad);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const last = points[points.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {fill && (
        <path
          d={`${path} L${(width - pad).toFixed(1)},${height - 1} L${pad},${height - 1} Z`}
          fill={color}
          opacity={0.13}
        />
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      <circle cx={x(points.length - 1)} cy={y(last.v)} r={2.4} fill={color} />
    </svg>
  );
}
