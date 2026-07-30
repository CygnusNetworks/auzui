import { useEffect, useMemo, useRef, useState } from "react";
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
 * Shared pan/zoom mechanics for FocusStage/MapStage/MapView (PLAN.md "Gemeinsame
 * Interaktion"): wheel-zoom centered on the cursor, pinch-to-zoom (2-pointer
 * distance), pan via drag, double-click zoom-in, and an animated fit() that
 * lerps the viewBox over ~250ms via requestAnimationFrame. `scale` is
 * `initial.w / viewBox.w`, used by callers to keep label/marker sizes
 * constant in screen space.
 */
export function usePanZoom(initial: ViewBox, opts: PanZoomOptions) {
  const [viewBox, setViewBox] = useState<ViewBox>(initial);
  const svgRef = useRef<SVGSVGElement>(null);
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

  function rectFraction(clientX: number, clientY: number): { px: number; py: number } {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { px: 0.5, py: 0.5 };
    return { px: (clientX - rect.left) / rect.width, py: (clientY - rect.top) / rect.height };
  }

  function screenToUnits(dxPx: number, dyPx: number): { dx: number; dy: number } {
    const rect = svgRef.current?.getBoundingClientRect();
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

  return {
    viewBox,
    setViewBox,
    svgRef,
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
