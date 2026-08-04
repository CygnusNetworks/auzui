import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fitViewBox, lerpViewBox, zoomAtCursor, type Bounds, type ViewBox } from "../../lib/geo";

export type { ViewBox } from "../../lib/geo";

const FIT_ANIMATION_MS = 250;

export interface PanZoomOptions {
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
}

/**
 * Zoom is clamped relative to the "fit" scale (the scale at which the content
 * exactly fills the stage): no further out than MIN_ZOOM_REL× fit, no closer
 * in than MAX_ZOOM_REL× fit. Exported so callers derive their PanZoomOptions
 * from the fitted viewBox instead of hard-coding absolute pixel spans.
 */
export const MIN_ZOOM_REL = 0.5;
export const MAX_ZOOM_REL = 8;

/**
 * Derives absolute viewBox min/max spans from the fitted span (`fitW`/`fitH`)
 * so zoom stays within [minRel, maxRel]× of fit. A larger `scale` (more zoomed
 * in) means a smaller viewBox width, hence the inverse mapping: the closest
 * zoom (maxRel× fit) yields the smallest span (fit / maxRel). Pure/testable —
 * guards against non-finite/non-positive inputs so callers never produce NaN
 * clamp bounds. */
export function zoomBoundsFromFit(
  fitW: number,
  fitH: number,
  minRel = MIN_ZOOM_REL,
  maxRel = MAX_ZOOM_REL,
): PanZoomOptions {
  const safeW = Number.isFinite(fitW) && fitW > 0 ? fitW : 1;
  const safeH = Number.isFinite(fitH) && fitH > 0 ? fitH : 1;
  return {
    minW: safeW / maxRel,
    maxW: safeW / minRel,
    minH: safeH / maxRel,
    maxH: safeH / minRel,
  };
}

/**
 * World units per rendered CSS pixel. Multiplying a pixel size by this yields
 * an SVG length that is visually constant regardless of zoom *and* of the
 * content's own coordinate span — a 1400-unit-wide Zabbix map and a
 * 0.2°-wide geo bounding box both get the same on-screen marker size.
 *
 * `fallbackScale` (usePanZoom's relative `scale`) is only used before the SVG
 * has been measured, and reproduces the previous span-dependent behaviour
 * rather than collapsing everything to zero. Pure.
 */
export function worldUnitsPerPixel(
  viewBox: { w: number; h: number },
  svgWidthPx: number,
  svgHeightPx: number,
  fallbackScale: number,
): number {
  // The SVGs render with the default preserveAspectRatio ("xMidYMid meet"),
  // so the viewBox is scaled by the *smaller* of the two axis ratios — using
  // width alone is off by the aspect mismatch (~2× on a 1084×560 stage).
  const okW = svgWidthPx > 0 && Number.isFinite(viewBox.w) && viewBox.w > 0;
  const okH = svgHeightPx > 0 && Number.isFinite(viewBox.h) && viewBox.h > 0;
  if (okW || okH) {
    const pxPerUnit = Math.min(
      okW ? svgWidthPx / viewBox.w : Infinity,
      okH ? svgHeightPx / viewBox.h : Infinity,
    );
    if (pxPerUnit > 0 && Number.isFinite(pxPerUnit)) return 1 / pxPerUnit;
  }
  return Number.isFinite(fallbackScale) && fallbackScale > 0 ? 1 / fallbackScale : 1;
}

/**
 * Shared pan/zoom mechanics for FocusStage/MapStage/MapView (PLAN.md "Gemeinsame
 * Interaktion"): wheel-zoom centered on the cursor, pinch-to-zoom (2-pointer
 * distance), pan via drag, double-click zoom-in, and an animated fit() that
 * lerps the viewBox over ~250ms via requestAnimationFrame.
 *
 * `scale` is `initial.w / viewBox.w` — a *relative* zoom factor (1 = initial
 * view), for zoom-dependent behaviour like detail levels. It is NOT a
 * pixels-to-world conversion: use `unitsPerPx` for that (see below), or a
 * marker sized `8 / scale` renders 8 world units, whose on-screen size then
 * depends on the content's own coordinate span.
 */
export function usePanZoom(initial: ViewBox, opts: PanZoomOptions) {
  const [viewBox, setViewBox] = useState<ViewBox>(initial);
  const svgNodeRef = useRef<SVGSVGElement | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  const [svgSizePx, setSvgSizePx] = useState({ w: 0, h: 0 });
  const panRef = useRef<{ startX: number; startY: number; origin: ViewBox } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDist: number; origin: ViewBox; midX: number; midY: number } | null>(null);
  const animRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    },
    [],
  );

  /**
   * Callback ref rather than an effect: FocusStage mounts its <svg> only once a
   * cluster is selected, so an effect with `[]` deps would run against a null
   * ref and never measure — leaving `unitsPerPx` stuck on the fallback.
   * ResizeObserver is absent in jsdom; there the one-shot measure suffices.
   */
  const svgRef = useCallback((el: SVGSVGElement | null) => {
    svgNodeRef.current = el;
    resizeObsRef.current?.disconnect();
    resizeObsRef.current = null;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSvgSizePx((cur) => (cur.w === r.width && cur.h === r.height ? cur : { w: r.width, h: r.height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    resizeObsRef.current = new ResizeObserver(measure);
    resizeObsRef.current.observe(el);
  }, []);

  useEffect(() => () => resizeObsRef.current?.disconnect(), []);

  /**
   * `initial` is only the *initial* state, so a stage whose framing is derived
   * from data would keep the placeholder view forever: MapStage first renders
   * with no map selected (800×600 default, then never the map's real canvas),
   * MapView first renders with no geocoded hosts (whole world, then never the
   * hosts' bounding box). Re-adopt the framing whenever it actually changes —
   * a constant `initial` (FocusStage) never triggers this, so user panning is
   * left alone.
   */
  const initialKey = `${initial.x},${initial.y},${initial.w},${initial.h}`;
  const adoptedKeyRef = useRef(initialKey);
  useEffect(() => {
    if (adoptedKeyRef.current === initialKey) return;
    adoptedKeyRef.current = initialKey;
    stopAnimation();
    setViewBox(initial);
    // `initial` is intentionally not a dependency — its identity changes every
    // render in callers that build it inline; the value key is what matters.

  }, [initialKey]);

  function rectFraction(clientX: number, clientY: number): { px: number; py: number } {
    const rect = svgNodeRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { px: 0.5, py: 0.5 };
    return { px: (clientX - rect.left) / rect.width, py: (clientY - rect.top) / rect.height };
  }

  function screenToUnits(dxPx: number, dyPx: number): { dx: number; dy: number } {
    const rect = svgNodeRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { dx: 0, dy: 0 };
    return { dx: (dxPx / rect.width) * viewBox.w, dy: (dyPx / rect.height) * viewBox.h };
  }

  function stopAnimation() {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }

  /** Animates the viewBox to `target` over ~250ms (requestAnimationFrame lerp). */
  function animateTo(target: ViewBox) {
    stopAnimation();
    const start = viewBox;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / FIT_ANIMATION_MS);
      setViewBox(lerpViewBox(start, target, t));
      if (t < 1) animRef.current = requestAnimationFrame(step);
      else animRef.current = null;
    };
    animRef.current = requestAnimationFrame(step);
  }

  /** Fits the viewBox to `bounds` with 10% padding, animated. */
  function fitTo(bounds: Bounds, padRatio = 0.1, minSpan = 1) {
    animateTo(fitViewBox(bounds, padRatio, minSpan));
  }

  function zoomBy(factor: number, px = 0.5, py = 0.5) {
    stopAnimation();
    setViewBox((vb) => zoomAtCursor(vb, factor, px, py, opts));
  }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    const { px, py } = rectFraction(e.clientX, e.clientY);
    zoomBy(factor, px, py);
  }

  function onDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    const { px, py } = rectFraction(e.clientX, e.clientY);
    zoomBy(0.5, px, py);
  }

  function onBackgroundPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      panRef.current = null;
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      pinchRef.current = {
        startDist: Math.max(dist, 1),
        origin: viewBox,
        midX: (a!.x + b!.x) / 2,
        midY: (a!.y + b!.y) / 2,
      };
    } else if (pointersRef.current.size === 1) {
      stopAnimation();
      panRef.current = { startX: e.clientX, startY: e.clientY, origin: viewBox };
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.max(Math.hypot(a!.x - b!.x, a!.y - b!.y), 1);
      const factor = pinchRef.current.startDist / dist;
      const { px, py } = rectFraction(pinchRef.current.midX, pinchRef.current.midY);
      const origin = pinchRef.current.origin;
      setViewBox(zoomAtCursor(origin, factor, px, py, opts));
      return;
    }

    if (panRef.current) {
      const { dx, dy } = screenToUnits(e.clientX - panRef.current.startX, e.clientY - panRef.current.startY);
      const origin = panRef.current.origin;
      setViewBox({ ...origin, x: origin.x - dx, y: origin.y - dy });
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) panRef.current = null;
  }

  const scale = useMemo(() => initial.w / viewBox.w, [initial.w, viewBox.w]);

  const unitsPerPx = worldUnitsPerPixel(viewBox, svgSizePx.w, svgSizePx.h, scale);

  return {
    viewBox,
    setViewBox,
    svgRef,
    unitsPerPx,
    onWheel,
    onDoubleClick,
    onBackgroundPointerDown,
    onPointerMove,
    onPointerUp,
    screenToUnits,
    scale,
    zoomBy,
    fitTo,
    animateTo,
  };
}
