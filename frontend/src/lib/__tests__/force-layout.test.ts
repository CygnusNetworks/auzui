import { describe, expect, it } from "vitest";
import { computeForceLayout } from "../force-layout";

describe("computeForceLayout", () => {
  it("produces finite positions for every node, never NaN", () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}` }));
    const edges = Array.from({ length: 19 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` }));
    const positions = computeForceLayout(nodes, edges, { iterations: 60 });
    expect(positions.size).toBe(20);
    for (const [, p] of positions) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("handles a single node without dividing by zero", () => {
    const positions = computeForceLayout([{ id: "only" }], []);
    const p = positions.get("only")!;
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });

  it("handles duplicate/zero-distance seed positions without NaN", () => {
    const nodes = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 0, y: 0 },
      { id: "c", x: 0, y: 0 },
    ];
    const positions = computeForceLayout(nodes, [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ]);
    for (const [, p] of positions) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("pulls connected nodes closer than a spring pair started far apart with no other forces", () => {
    const nodes = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 2000, y: 0 },
    ];
    const positions = computeForceLayout(nodes, [{ source: "a", target: "b" }], {
      iterations: 200,
      repulsion: 500,
      centerStrength: 0,
    });
    const a = positions.get("a")!;
    const b = positions.get("b")!;
    const finalDist = Math.hypot(a.x - b.x, a.y - b.y);
    expect(finalDist).toBeLessThan(2000);
  });

  it("ignores edges referencing unknown node ids instead of throwing", () => {
    const nodes = [{ id: "a" }, { id: "b" }];
    expect(() =>
      computeForceLayout(nodes, [{ source: "a", target: "ghost" }], { iterations: 10 }),
    ).not.toThrow();
  });

  it("seeds nodes sharing a group closer together than nodes in different groups", () => {
    const groupA = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, group: "A" }));
    const groupB = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, group: "B" }));
    const positions = computeForceLayout([...groupA, ...groupB], [], { iterations: 0 });
    const avgPos = (ids: string[]) => {
      const pts = ids.map((id) => positions.get(id)!);
      return {
        x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
        y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
      };
    };
    const centerA = avgPos(groupA.map((n) => n.id));
    const centerB = avgPos(groupB.map((n) => n.id));
    const maxSpreadWithinA = Math.max(
      ...groupA.map((n) => Math.hypot(positions.get(n.id)!.x - centerA.x, positions.get(n.id)!.y - centerA.y)),
    );
    const distBetweenGroups = Math.hypot(centerA.x - centerB.x, centerA.y - centerB.y);
    expect(distBetweenGroups).toBeGreaterThan(maxSpreadWithinA * 2);
  });

  it("keeps fixed nodes pinned in place", () => {
    const nodes = [
      { id: "a", x: 50, y: 50, fixed: true },
      { id: "b", x: 60, y: 60 },
    ];
    const positions = computeForceLayout(nodes, [{ source: "a", target: "b" }], { iterations: 50 });
    expect(positions.get("a")).toEqual({ x: 50, y: 50 });
  });
});
