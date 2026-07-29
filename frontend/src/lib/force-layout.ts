/**
 * Minimal self-contained force simulator for the Topology graph (PLAN.md
 * Phase 2 / Entwurf 2, Abschnitt F: "d3-force einmalig, Positionen
 * persistieren"). d3-force is not a dependency of this repo and the graphs
 * here stay in the low hundreds of nodes, so a small hand-rolled
 * repulsion+spring simulator is enough — no new dependency needed.
 *
 * Runs a fixed number of iterations once (no re-layout on every render); the
 * caller persists the resulting positions (localStorage) and seeds them back
 * in on reload so the layout never "jumps".
 */

export interface ForceLayoutNode {
  id: string;
  /** Seed position, e.g. from a previous run persisted in localStorage. */
  x?: number;
  y?: number;
  /** Pinned nodes (user is dragging) don't move. */
  fixed?: boolean;
}

export interface ForceLayoutEdge {
  source: string;
  target: string;
}

export interface ForceLayoutOptions {
  width?: number;
  height?: number;
  iterations?: number;
  /** Repulsion strength between any two nodes. */
  repulsion?: number;
  /** Spring constant pulling connected nodes toward idealLength. */
  springStrength?: number;
  idealLength?: number;
  /** Pull toward the canvas center — keeps disconnected components from drifting off. */
  centerStrength?: number;
}

const DEFAULTS: Required<ForceLayoutOptions> = {
  width: 1000,
  height: 700,
  iterations: 150,
  repulsion: 12000,
  springStrength: 0.02,
  idealLength: 90,
  centerStrength: 0.01,
};

/** Deterministic pseudo-random seed positions — avoids overlapping (0,0) starts without relying on Math.random. */
function seedPosition(index: number, total: number, width: number, height: number): { x: number; y: number } {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2;
  const radius = Math.min(width, height) / 3;
  return {
    x: width / 2 + radius * Math.cos(angle),
    y: height / 2 + radius * Math.sin(angle),
  };
}

/**
 * Runs the simulation to convergence (fixed iteration count) and returns
 * final positions keyed by node id. Never produces NaN/Infinity: distances of
 * (near-)zero are floored before dividing.
 */
export function computeForceLayout(
  nodes: ForceLayoutNode[],
  edges: ForceLayoutEdge[],
  opts: ForceLayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const o = { ...DEFAULTS, ...opts };
  const MIN_DIST = 1;

  const pos = new Map<string, { x: number; y: number; fixed: boolean }>();
  nodes.forEach((n, i) => {
    const seed = seedPosition(i, nodes.length, o.width, o.height);
    pos.set(n.id, {
      x: Number.isFinite(n.x) ? (n.x as number) : seed.x,
      y: Number.isFinite(n.y) ? (n.y as number) : seed.y,
      fixed: Boolean(n.fixed),
    });
  });

  const adjacency = edges
    .map((e) => ({ a: pos.has(e.source) ? e.source : undefined, b: pos.has(e.target) ? e.target : undefined }))
    .filter((e): e is { a: string; b: string } => Boolean(e.a && e.b));

  const ids = [...pos.keys()];

  for (let iter = 0; iter < o.iterations; iter++) {
    const cooling = 1 - iter / o.iterations; // linear cooldown, 1 → 0
    const disp = new Map<string, { x: number; y: number }>();
    for (const id of ids) disp.set(id, { x: 0, y: 0 });

    // Repulsion between every pair (fine at this graph size; PLAN.md caps
    // initial rendering well below where O(n²) would matter).
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i]!)!;
        const b = pos.get(ids[j]!)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIN_DIST) {
          // Deterministic nudge instead of Math.random() to keep this pure/testable.
          dx = MIN_DIST;
          dy = 0;
          dist = MIN_DIST;
        }
        const force = o.repulsion / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const da = disp.get(ids[i]!)!;
        const db = disp.get(ids[j]!)!;
        da.x += fx;
        da.y += fy;
        db.x -= fx;
        db.y -= fy;
      }
    }

    // Springs along edges toward idealLength.
    for (const { a: aId, b: bId } of adjacency) {
      const a = pos.get(aId)!;
      const b = pos.get(bId)!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MIN_DIST) {
        dx = MIN_DIST;
        dy = 0;
        dist = MIN_DIST;
      }
      const force = o.springStrength * (dist - o.idealLength);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const da = disp.get(aId)!;
      const db = disp.get(bId)!;
      da.x += fx;
      da.y += fy;
      db.x -= fx;
      db.y -= fy;
    }

    // Weak centering pull.
    for (const id of ids) {
      const p = pos.get(id)!;
      const d = disp.get(id)!;
      d.x += (o.width / 2 - p.x) * o.centerStrength;
      d.y += (o.height / 2 - p.y) * o.centerStrength;
    }

    for (const id of ids) {
      const p = pos.get(id)!;
      if (p.fixed) continue;
      const d = disp.get(id)!;
      p.x += d.x * cooling;
      p.y += d.y * cooling;
    }
  }

  const result = new Map<string, { x: number; y: number }>();
  for (const [id, p] of pos) {
    result.set(id, {
      x: Number.isFinite(p.x) ? p.x : o.width / 2,
      y: Number.isFinite(p.y) ? p.y : o.height / 2,
    });
  }
  return result;
}
