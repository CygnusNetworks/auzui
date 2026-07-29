/**
 * Deterministic radial layout for the Fokus-Bühne (Entwurf 3 "Cluster +
 * Fokus"): the selected cluster's hub sits in the center, its hosts are
 * placed on a circle around it. No force simulation here — angle = index/N,
 * so the layout never "jiggles" and reordering (e.g. more problems arrive)
 * only rotates existing points rather than re-simulating everything.
 *
 * Problem hosts are ordered first (worst severity first), then OK hosts, both
 * clockwise starting at 12 o'clock (PLAN.md: "Problem-Hosts zuerst im
 * Uhrzeigersinn"). Above OK_COLLAPSE_THRESHOLD OK-hosts, the caller collapses
 * the OK tail into a single "+N OK" node (see shouldCollapseOkHosts) —
 * placed as the last point on the circle.
 */
import type { Severity } from "./severity";

/** Above this many OK (problem-free) hosts, collapse them into one "+N OK" node (PLAN.md: "> ~24 OK-Hosts"). */
export const OK_COLLAPSE_THRESHOLD = 24;

export interface RadialLayoutHost {
  id: string;
  severity: Severity | undefined;
}

export interface RadialPosition {
  id: string;
  x: number;
  y: number;
  /** Radians, 0 = 12 o'clock, increasing clockwise (screen space: y-down). */
  angle: number;
}

/**
 * Orders hosts for the circle: defined severity first (worst → mildest),
 * then OK hosts (undefined severity), each group stable on its original
 * relative order (so re-renders with the same input never reshuffle).
 */
export function orderHostsForRadial(hosts: RadialLayoutHost[]): RadialLayoutHost[] {
  const problems = hosts.filter((h) => h.severity !== undefined);
  const ok = hosts.filter((h) => h.severity === undefined);
  problems.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));
  return [...problems, ...ok];
}

/** True once the OK-host count exceeds the collapse threshold — caller replaces the OK tail with one summary node. */
export function shouldCollapseOkHosts(okCount: number, threshold = OK_COLLAPSE_THRESHOLD): boolean {
  return okCount > threshold;
}

/**
 * Computes one point per host on a circle of `radius` around the origin
 * (hub sits at (0,0) — caller translates). Angle = index/N * 2π, offset so
 * index 0 is at 12 o'clock and it proceeds clockwise in SVG's y-down space.
 */
export function computeRadialPositions(ids: string[], radius: number): RadialPosition[] {
  const n = ids.length;
  if (n === 0) return [];
  return ids.map((id, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { id, x: radius * Math.cos(angle), y: radius * Math.sin(angle), angle };
  });
}
