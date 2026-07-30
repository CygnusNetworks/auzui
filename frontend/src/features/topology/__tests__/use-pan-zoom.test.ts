import { describe, expect, it } from "vitest";
import { MAX_ZOOM_REL, MIN_ZOOM_REL, zoomBoundsFromFit } from "../use-pan-zoom";
import { zoomAtCursor } from "../../../lib/geo";

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
