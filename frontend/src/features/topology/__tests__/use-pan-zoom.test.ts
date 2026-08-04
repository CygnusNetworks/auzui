import { describe, expect, it } from "vitest";
import { MAX_ZOOM_REL, MIN_ZOOM_REL, worldUnitsPerPixel, zoomBoundsFromFit } from "../use-pan-zoom";
import { zoomAtCursor } from "../../../lib/geo";

describe("worldUnitsPerPixel", () => {
  /** Screen size of `units` world units under "xMidYMid meet" — the inverse of what the helper computes. */
  function renderedPx(units: number, vb: { w: number; h: number }, svgW: number, svgH: number): number {
    return units * Math.min(svgW / vb.w, svgH / vb.h);
  }

  it("follows the smaller axis ratio, as preserveAspectRatio=meet does", () => {
    // Square viewBox in a wide, short stage: height governs, not width.
    expect(worldUnitsPerPixel({ w: 545.6, h: 545.6 }, 1084, 560, 1)).toBeCloseTo(545.6 / 560);
    expect(worldUnitsPerPixel({ w: 800, h: 600 }, 1084, 560, 1)).toBeCloseTo(600 / 560);
  });

  it("keeps a pixel size on-screen-constant across wildly different coordinate spans", () => {
    // The bug: a 9.5px label sized via the relative zoom factor rendered ~6px
    // on a 1400-unit Zabbix map and hundreds of km wide on a 0.2° geo box.
    const px = 9.5;
    for (const vb of [{ w: 1400, h: 720 }, { w: 0.25, h: 0.25 }, { w: 545.6, h: 545.6 }]) {
      const units = px * worldUnitsPerPixel(vb, 1084, 560, 1);
      expect(renderedPx(units, vb, 1084, 560)).toBeCloseTo(px);
    }
  });

  it("falls back to the relative scale until the SVG has been measured", () => {
    expect(worldUnitsPerPixel({ w: 800, h: 600 }, 0, 0, 2)).toBeCloseTo(0.5);
    expect(worldUnitsPerPixel({ w: 800, h: 600 }, 0, 0, 0)).toBe(1);
    expect(worldUnitsPerPixel({ w: NaN, h: NaN }, 0, 0, NaN)).toBe(1);
  });
});

describe("zoomBoundsFromFit", () => {
  it("maps a fit span to [MIN_ZOOM_REL, MAX_ZOOM_REL]× clamp bounds", () => {
    // fit span 800 → closest zoom = 800/8 = 100, furthest = 800/0.5 = 1600.
    const opts = zoomBoundsFromFit(800, 600);
    expect(opts.minW).toBeCloseTo(800 / MAX_ZOOM_REL);
    expect(opts.maxW).toBeCloseTo(800 / MIN_ZOOM_REL);
    expect(opts.minH).toBeCloseTo(600 / MAX_ZOOM_REL);
    expect(opts.maxH).toBeCloseTo(600 / MIN_ZOOM_REL);
  });

  it("never yields NaN / non-positive bounds for degenerate fit spans", () => {
    for (const [w, h] of [
      [0, 0],
      [NaN, NaN],
      [Infinity, -5],
    ] as const) {
      const opts = zoomBoundsFromFit(w, h);
      for (const v of [opts.minW, opts.maxW, opts.minH, opts.maxH]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
    }
  });

  it("clamps zoom-in and zoom-out against the fit-derived bounds (no runaway, no NaN)", () => {
    const opts = zoomBoundsFromFit(800, 800);
    let vb = { x: -400, y: -400, w: 800, h: 800 }; // fitted
    // Zoom in hard many times — width must not drop below fit/8.
    for (let i = 0; i < 50; i++) vb = zoomAtCursor(vb, 0.5, 0.5, 0.5, opts);
    expect(vb.w).toBeCloseTo(800 / MAX_ZOOM_REL);
    expect(Number.isNaN(vb.x)).toBe(false);
    // Zoom out hard many times — width must not exceed fit/0.5.
    for (let i = 0; i < 50; i++) vb = zoomAtCursor(vb, 2, 0.5, 0.5, opts);
    expect(vb.w).toBeCloseTo(800 / MIN_ZOOM_REL);
    expect(Number.isNaN(vb.x)).toBe(false);
  });
});
