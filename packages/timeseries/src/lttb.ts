export interface Point {
  /** Unix timestamp in seconds (fractional allowed). */
  t: number;
  v: number;
}

/**
 * Largest-Triangle-Three-Buckets downsampling (Steinarsson 2013).
 * Preserves visual shape (peaks/valleys) far better than naive nth-point
 * sampling. Returns the input unchanged when it already fits `threshold`.
 */
export function lttb(points: readonly Point[], threshold: number): Point[] {
  const n = points.length;
  if (threshold >= n || threshold < 3) return [...points];

  const sampled: Point[] = new Array(threshold);
  const bucketSize = (n - 2) / (threshold - 2);

  sampled[0] = points[0]!;
  let a = 0;

  for (let i = 0; i < threshold - 2; i++) {
    const bucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n - 1);

    // Average of the *next* bucket forms the third triangle corner.
    let avgT = 0;
    let avgV = 0;
    const avgLen = bucketEnd - bucketStart;
    for (let j = bucketStart; j < bucketEnd; j++) {
      avgT += points[j]!.t;
      avgV += points[j]!.v;
    }
    avgT /= avgLen || 1;
    avgV /= avgLen || 1;

    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n - 1);

    const pa = points[a]!;
    let maxArea = -1;
    let maxIdx = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const p = points[j]!;
      const area = Math.abs(
        (pa.t - avgT) * (p.v - pa.v) - (pa.t - p.t) * (avgV - pa.v),
      );
      if (area > maxArea) {
        maxArea = area;
        maxIdx = j;
      }
    }

    sampled[i + 1] = points[maxIdx]!;
    a = maxIdx;
  }

  sampled[threshold - 1] = points[n - 1]!;
  return sampled;
}
