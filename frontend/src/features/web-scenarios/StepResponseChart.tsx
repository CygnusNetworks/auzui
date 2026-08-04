import { useMemo } from "react";
import { bucketStepHistory } from "../../lib/web-scenarios";
import { resolveSeriesColor } from "../../lib/series-colors";
import type { StepHistorySeries } from "./use-web-scenarios";

const WIDTH = 380;
const HEIGHT = 56;
const PAD = 3;

/** Stacked area chart of per-step response time, so a slow single step is visible rather than buried in a sum. */
export function StepResponseChart({
  stepHistory,
  from,
  to,
}: {
  stepHistory: StepHistorySeries[];
  from: number;
  to: number;
}) {
  const buckets = useMemo(() => bucketStepHistory(stepHistory, from, to, 14), [stepHistory, from, to]);

  const hasData = buckets.some((b) => b.values.some((v) => v > 0));
  if (stepHistory.length === 0 || !hasData) return null;

  const n = buckets.length;
  const maxTotal = Math.max(
    ...buckets.map((b) => b.values.reduce((a, v) => a + v, 0)),
    0.001,
  );
  const x = (i: number) => PAD + i * ((WIDTH - PAD * 2) / Math.max(1, n - 1));
  const y = (v: number) => PAD + (1 - v / maxTotal) * (HEIGHT - PAD * 2);

  let bottom = new Array(n).fill(0);
  const bands = stepHistory.map((series, si) => {
    const top = buckets.map((b, i) => bottom[i] + b.values[si]!);
    const topPath = top.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const bottomPath = bottom
      .map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .reverse()
      .join(" L");
    const color = resolveSeriesColor(si);
    const path = (
      <path key={series.itemid} d={`${topPath} L${bottomPath} Z`} fill={color} opacity={0.88} />
    );
    bottom = top;
    return path;
  });

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} preserveAspectRatio="none">
      {bands}
    </svg>
  );
}
