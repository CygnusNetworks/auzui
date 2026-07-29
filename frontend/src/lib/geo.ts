/**
 * Pure geometry helpers shared by GraphView + MapView (PLAN.md: "Geometrie-
 * Helfer ... in lib/ mit Vitest-Tests"). No DOM/React here — GraphView and
 * MapView both build on the same viewBox model ({x,y,w,h} in "world units":
 * force-layout pixels for the graph, degrees for the map) and the same
 * zoom/fit math via use-pan-zoom.ts.
 */

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Equirectangular projection (lon → x, -lat → y so north is up in SVG's y-down space). */
export function projectEquirectangular(lat: number, lon: number): { x: number; y: number } {
  return { x: lon, y: -lat };
}

export function unprojectEquirectangular(x: number, y: number): { lat: number; lon: number } {
  return { lat: -y, lon: x };
}

/** Bounding box over a set of points; returns undefined for an empty set (caller picks a fallback). */
export function computeBounds(points: { x: number; y: number }[]): Bounds | undefined {
  if (points.length === 0) return undefined;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Fit a viewBox around `bounds` with `padRatio` extra space on each side
 * (0.1 = 10%, PLAN.md). Degenerate bounds (a single point, or all points on
 * one axis) get a minimum span so the viewBox never collapses to zero size.
 */
export function fitViewBox(bounds: Bounds, padRatio = 0.1, minSpan = 1): ViewBox {
  const rawW = Math.max(bounds.maxX - bounds.minX, minSpan);
  const rawH = Math.max(bounds.maxY - bounds.minY, minSpan);
  const padW = rawW * padRatio;
  const padH = rawH * padRatio;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const w = rawW + padW * 2;
  const h = rawH + padH * 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Linear interpolation, used to animate viewBox transitions (~250ms rAF lerp per PLAN.md). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpViewBox(a: ViewBox, b: ViewBox, t: number): ViewBox {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}

export interface ZoomAtCursorOptions {
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
}

/**
 * Zooms `vb` by `factor` (>1 zooms out, <1 zooms in) while keeping the world
 * point under the cursor (given as fractions 0..1 of the viewport) fixed on
 * screen — the "wheel zooms AUF DEN CURSOR" requirement. Pure function so the
 * cursor-anchoring math is independently testable from pointer-event glue.
 */
export function zoomAtCursor(vb: ViewBox, factor: number, px: number, py: number, opts: ZoomAtCursorOptions): ViewBox {
  const newW = Math.max(opts.minW, Math.min(opts.maxW, vb.w * factor));
  const newH = Math.max(opts.minH, Math.min(opts.maxH, vb.h * factor));
  const cx = vb.x + px * vb.w;
  const cy = vb.y + py * vb.h;
  return { x: cx - px * newW, y: cy - py * newH, w: newW, h: newH };
}

export interface GeoPoint {
  id: string;
  lat: number;
  lon: number;
}

export interface GeoCluster {
  /** Representative id: the first member's id — stable given a stable input order. */
  id: string;
  lat: number;
  lon: number;
  ids: string[];
}

/**
 * Groups points sharing (near-)identical coordinates into one cluster each
 * (PLAN.md: "mehrere Hosts am Standort → EIN Cluster-Punkt"). Coordinates are
 * rounded to `precision` decimal digits before grouping (~1m at 5 digits),
 * which absorbs float noise without merging genuinely distinct sites.
 */
export function clusterByCoordinate<T extends GeoPoint>(points: T[], precision = 5): GeoCluster[] {
  const factor = 10 ** precision;
  const groups = new Map<string, T[]>();
  for (const p of points) {
    const key = `${Math.round(p.lat * factor)}:${Math.round(p.lon * factor)}`;
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  const clusters: GeoCluster[] = [];
  for (const list of groups.values()) {
    clusters.push({ id: list[0]!.id, lat: list[0]!.lat, lon: list[0]!.lon, ids: list.map((p) => p.id) });
  }
  return clusters;
}
