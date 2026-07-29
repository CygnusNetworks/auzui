import { describe, expect, it } from "vitest";
import {
  OK_COLLAPSE_THRESHOLD,
  computeRadialPositions,
  orderHostsForRadial,
  shouldCollapseOkHosts,
  type RadialLayoutHost,
} from "../radial-layout";

describe("orderHostsForRadial", () => {
  it("puts problem hosts first (worst severity first), then OK hosts, each stable", () => {
    const hosts: RadialLayoutHost[] = [
      { id: "ok1", severity: undefined },
      { id: "warn", severity: 2 },
      { id: "ok2", severity: undefined },
      { id: "disaster", severity: 5 },
      { id: "high", severity: 4 },
    ];
    expect(orderHostsForRadial(hosts).map((h) => h.id)).toEqual(["disaster", "high", "warn", "ok1", "ok2"]);
  });

  it("does not mutate the input array", () => {
    const hosts: RadialLayoutHost[] = [{ id: "a", severity: 1 }, { id: "b", severity: 3 }];
    const copy = [...hosts];
    orderHostsForRadial(hosts);
    expect(hosts).toEqual(copy);
  });
});

describe("shouldCollapseOkHosts", () => {
  it("is false at and below the threshold, true above it", () => {
    expect(shouldCollapseOkHosts(OK_COLLAPSE_THRESHOLD)).toBe(false);
    expect(shouldCollapseOkHosts(OK_COLLAPSE_THRESHOLD + 1)).toBe(true);
    expect(shouldCollapseOkHosts(0)).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(shouldCollapseOkHosts(5, 4)).toBe(true);
    expect(shouldCollapseOkHosts(4, 4)).toBe(false);
  });
});

describe("computeRadialPositions", () => {
  it("returns an empty array for no ids", () => {
    expect(computeRadialPositions([], 100)).toEqual([]);
  });

  it("places a single node at 12 o'clock (angle = -π/2, straight up)", () => {
    const [p] = computeRadialPositions(["a"], 100);
    expect(p!.x).toBeCloseTo(0);
    expect(p!.y).toBeCloseTo(-100);
  });

  it("distributes N nodes evenly around the circle at radius distance from origin", () => {
    const positions = computeRadialPositions(["a", "b", "c", "d"], 10);
    expect(positions).toHaveLength(4);
    for (const p of positions) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(10);
    }
    // Quarter-circle apart.
    expect(positions[1]!.angle - positions[0]!.angle).toBeCloseTo(Math.PI / 2);
  });

  it("is deterministic — same input always yields the same output", () => {
    const a = computeRadialPositions(["x", "y", "z"], 50);
    const b = computeRadialPositions(["x", "y", "z"], 50);
    expect(a).toEqual(b);
  });
});
