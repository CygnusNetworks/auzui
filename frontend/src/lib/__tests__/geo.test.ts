import { describe, expect, it } from "vitest";
import {
  clusterByCoordinate,
  computeBounds,
  fitViewBox,
  lerp,
  lerpViewBox,
  projectEquirectangular,
  zoomAtCursor,
} from "../geo";

describe("projectEquirectangular", () => {
  it("maps lon to x and negates lat to y (north up in SVG y-down space)", () => {
    expect(projectEquirectangular(52, 13)).toEqual({ x: 13, y: -52 });
    expect(projectEquirectangular(-33, -70)).toEqual({ x: -70, y: 33 });
  });
});

describe("computeBounds", () => {
  it("returns undefined for an empty set", () => {
    expect(computeBounds([])).toBeUndefined();
  });

  it("computes min/max over x and y", () => {
    const b = computeBounds([
      { x: 1, y: 5 },
      { x: -2, y: 9 },
      { x: 4, y: -1 },
    ]);
    expect(b).toEqual({ minX: -2, maxX: 4, minY: -1, maxY: 9 });
  });
});

describe("fitViewBox", () => {
  it("centers the viewBox on the bounds with padding on each side", () => {
    const vb = fitViewBox({ minX: 0, maxX: 10, minY: 0, maxY: 10 }, 0.1);
    expect(vb.w).toBeCloseTo(12);
    expect(vb.h).toBeCloseTo(12);
    expect(vb.x).toBeCloseTo(-1);
    expect(vb.y).toBeCloseTo(-1);
  });

  it("never collapses to zero size for a single point", () => {
    const vb = fitViewBox({ minX: 5, maxX: 5, minY: 5, maxY: 5 }, 0.1, 2);
    expect(vb.w).toBeGreaterThan(0);
    expect(vb.h).toBeGreaterThan(0);
  });
});

describe("lerp / lerpViewBox", () => {
  it("interpolates linearly", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
  });

  it("interpolates all four viewBox fields", () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = { x: 10, y: 20, w: 50, h: 60 };
    expect(lerpViewBox(a, b, 0.5)).toEqual({ x: 5, y: 10, w: 75, h: 80 });
  });
});

describe("zoomAtCursor", () => {
  const opts = { minW: 1, maxW: 10000, minH: 1, maxH: 10000 };

  it("keeps the point under the cursor fixed on screen when zooming in", () => {
    const vb = { x: 0, y: 0, w: 1000, h: 700 };
    // cursor at 25%/25% of the viewport
    const next = zoomAtCursor(vb, 0.5, 0.25, 0.25, opts);
    const worldXBefore = vb.x + 0.25 * vb.w;
    const worldYBefore = vb.y + 0.25 * vb.h;
    const worldXAfter = next.x + 0.25 * next.w;
    const worldYAfter = next.y + 0.25 * next.h;
    expect(worldXAfter).toBeCloseTo(worldXBefore);
    expect(worldYAfter).toBeCloseTo(worldYBefore);
    expect(next.w).toBeCloseTo(500);
    expect(next.h).toBeCloseTo(350);
  });

  it("clamps to the configured min/max span", () => {
    const vb = { x: 0, y: 0, w: 10, h: 10 };
    const zoomedIn = zoomAtCursor(vb, 0.0001, 0.5, 0.5, { minW: 5, maxW: 100, minH: 5, maxH: 100 });
    expect(zoomedIn.w).toBe(5);
    expect(zoomedIn.h).toBe(5);
    const zoomedOut = zoomAtCursor(vb, 10000, 0.5, 0.5, { minW: 5, maxW: 100, minH: 5, maxH: 100 });
    expect(zoomedOut.w).toBe(100);
    expect(zoomedOut.h).toBe(100);
  });
});

describe("clusterByCoordinate", () => {
  it("groups points with identical coordinates into one cluster", () => {
    const clusters = clusterByCoordinate([
      { id: "a", lat: 52.5, lon: 13.4 },
      { id: "b", lat: 52.5, lon: 13.4 },
      { id: "c", lat: 48.1, lon: 11.6 },
    ]);
    expect(clusters).toHaveLength(2);
    const berlin = clusters.find((c) => c.ids.includes("a"));
    expect(berlin?.ids.sort()).toEqual(["a", "b"]);
    const munich = clusters.find((c) => c.ids.includes("c"));
    expect(munich?.ids).toEqual(["c"]);
  });

  it("keeps points with distinct coordinates apart", () => {
    const clusters = clusterByCoordinate([
      { id: "a", lat: 1, lon: 1 },
      { id: "b", lat: 1.001, lon: 1 },
    ]);
    expect(clusters).toHaveLength(2);
  });

  it("absorbs tiny float noise at the configured precision", () => {
    const clusters = clusterByCoordinate(
      [
        { id: "a", lat: 1, lon: 1 },
        { id: "b", lat: 1.0000001, lon: 1 },
      ],
      5,
    );
    expect(clusters).toHaveLength(1);
  });
});
