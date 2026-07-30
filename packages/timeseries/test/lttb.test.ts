import { describe, expect, it } from "vitest";
import { lttb, type Point } from "../src/lttb";

function mkSeries(n: number, f: (i: number) => number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ t: i, v: f(i) }));
}

describe("lttb", () => {
  it("returns input unchanged when threshold >= length", () => {
    const pts = mkSeries(10, (i) => i);
    expect(lttb(pts, 10)).toEqual(pts);
    expect(lttb(pts, 50)).toEqual(pts);
  });

  it("returns input unchanged for threshold < 3", () => {
    const pts = mkSeries(10, (i) => i);
    expect(lttb(pts, 2)).toEqual(pts);
  });

  it("downsamples to exactly threshold points, keeping endpoints", () => {
    const pts = mkSeries(5000, (i) => Math.sin(i / 50));
    const out = lttb(pts, 200);
    expect(out).toHaveLength(200);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("preserves an extreme spike", () => {
    const pts = mkSeries(10_000, (i) => (i === 4321 ? 1000 : 1));
    const out = lttb(pts, 100);
    expect(out.some((p) => p.v === 1000)).toBe(true);
  });

  it("keeps timestamps strictly increasing", () => {
    const pts = mkSeries(3000, (i) => Math.cos(i / 10) * i);
    const out = lttb(pts, 150);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.t).toBeGreaterThan(out[i - 1]!.t);
    }
  });

  // Short-range edge cases: a 15m window over a 1m-polled item yields only
  // ~15 raw points, far under any point budget — LTTB must pass them through
  // untouched rather than dropping or duplicating any (a blank/short chart
  // must never be caused by the downsampler).
  it("passes a handful of points through unchanged (n < threshold)", () => {
    const pts = mkSeries(15, (i) => i * 2);
    const out = lttb(pts, 800);
    expect(out).toEqual(pts);
    expect(out).not.toBe(pts); // returns a copy, not the same reference
  });

  it("returns an empty array for empty input", () => {
    expect(lttb([], 800)).toEqual([]);
  });

  it("keeps a single point", () => {
    const pts = mkSeries(1, () => 42);
    expect(lttb(pts, 800)).toEqual(pts);
  });

  it("passes through when threshold equals length exactly", () => {
    const pts = mkSeries(10, (i) => i);
    expect(lttb(pts, 10)).toEqual(pts);
  });
});
