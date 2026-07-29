import { describe, expect, it } from "vitest";
import { aggregateGroupProblems, utilBucket, utilColorMix } from "../explorer";

describe("aggregateGroupProblems", () => {
  const problemsByHost = new Map([
    ["1", { count: 2, maxSeverity: 4 as const }],
    ["2", { count: 1, maxSeverity: 2 as const }],
  ]);

  it("rolls per-host aggregation up to each of the host's groups", () => {
    const hosts = [
      { hostid: "1", hostgroups: [{ groupid: "g1" }, { groupid: "g2" }] },
      { hostid: "2", hostgroups: [{ groupid: "g1" }] },
      { hostid: "3", hostgroups: [{ groupid: "g2" }] },
    ];
    const result = aggregateGroupProblems(hosts, problemsByHost);
    expect(result.get("g1")).toEqual({ hostCount: 2, problemCount: 3, maxSeverity: 4 });
    expect(result.get("g2")).toEqual({ hostCount: 2, problemCount: 2, maxSeverity: 4 });
  });

  it("counts hosts without any active problem with maxSeverity -1", () => {
    const result = aggregateGroupProblems([{ hostid: "3", hostgroups: [{ groupid: "g3" }] }], problemsByHost);
    expect(result.get("g3")).toEqual({ hostCount: 1, problemCount: 0, maxSeverity: -1 });
  });

  it("returns an empty map for no hosts", () => {
    expect(aggregateGroupProblems([], problemsByHost).size).toBe(0);
  });
});

describe("utilBucket", () => {
  it("buckets into 5 stages at 20/40/60/80", () => {
    expect(utilBucket(0)).toBe(0);
    expect(utilBucket(19.9)).toBe(0);
    expect(utilBucket(20)).toBe(1);
    expect(utilBucket(39)).toBe(1);
    expect(utilBucket(40)).toBe(2);
    expect(utilBucket(59)).toBe(2);
    expect(utilBucket(60)).toBe(3);
    expect(utilBucket(79)).toBe(3);
    expect(utilBucket(80)).toBe(4);
    expect(utilBucket(100)).toBe(4);
  });

  it("treats non-finite input as the lowest bucket", () => {
    expect(utilBucket(NaN)).toBe(0);
  });
});

describe("utilColorMix", () => {
  it("mixes the existing chart-1 token, never a hardcoded hex color", () => {
    expect(utilColorMix(10)).toBe("color-mix(in oklab, var(--color-chart-1) 15%, var(--color-surface-3))");
    expect(utilColorMix(90)).toBe("color-mix(in oklab, var(--color-chart-1) 88%, var(--color-surface-3))");
  });
});
