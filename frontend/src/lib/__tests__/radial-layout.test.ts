import { describe, expect, it } from "vitest";
import {
  DETAIL_LEVEL_2_ZOOM,
  DETAIL_LEVEL_3_ZOOM,
  LABEL_DENSITY_THRESHOLD,
  LABEL_RADIUS_OFFSET,
  LABEL_RADIUS_STAGGER,
  MAX_RADIAL_RADIUS,
  META_NODE_MAX_R,
  META_NODE_MIN_R,
  MIN_RADIAL_RADIUS,
  MISC_FAMILY_KEY,
  OK_COLLAPSE_THRESHOLD,
  buildSemanticRing,
  computeRadialPositions,
  deriveNameFamilies,
  detailLevelForZoom,
  labelRadiusOffset,
  metaNodeRadius,
  orderHostsForRadial,
  radialRadius,
  representedProblemCount,
  representedWorstSeverity,
  severityDistribution,
  shouldCollapseOkHosts,
  shouldRenderLabel,
  staysStandalone,
  type FamilyMemberHost,
  type RadialLayoutHost,
} from "../radial-layout";
import type { Severity } from "../severity";

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

describe("radialRadius", () => {
  it("clamps to the minimum for small clusters (incl. 0 nodes)", () => {
    expect(radialRadius(0)).toBe(MIN_RADIAL_RADIUS);
    expect(radialRadius(5)).toBe(MIN_RADIAL_RADIUS);
  });

  it("clamps to the maximum for very large clusters", () => {
    expect(radialRadius(10_000)).toBe(MAX_RADIAL_RADIUS);
  });

  it("grows with node count between the bounds (~arc/2π per node)", () => {
    // n * 11 / (2π): 150 → ~262.6, inside [200, 420].
    const r = radialRadius(150);
    expect(r).toBeGreaterThan(MIN_RADIAL_RADIUS);
    expect(r).toBeLessThan(MAX_RADIAL_RADIUS);
    expect(r).toBeCloseTo((150 * 11) / (2 * Math.PI));
    // Monotonic in n while unclamped.
    expect(radialRadius(160)).toBeGreaterThan(radialRadius(150));
  });
});

describe("shouldRenderLabel", () => {
  it("labels everything at or below the density threshold", () => {
    for (const hasProblem of [true, false]) {
      expect(shouldRenderLabel({ visibleCount: LABEL_DENSITY_THRESHOLD, hasProblem, isHovered: false })).toBe(true);
    }
  });

  it("above the threshold, only problem hosts and the hovered node keep a label", () => {
    const dense = LABEL_DENSITY_THRESHOLD + 1;
    expect(shouldRenderLabel({ visibleCount: dense, hasProblem: true, isHovered: false })).toBe(true);
    expect(shouldRenderLabel({ visibleCount: dense, hasProblem: false, isHovered: true })).toBe(true);
    expect(shouldRenderLabel({ visibleCount: dense, hasProblem: false, isHovered: false })).toBe(false);
  });
});

describe("labelRadiusOffset", () => {
  it("alternates even/odd indices between two rings", () => {
    expect(labelRadiusOffset(0)).toBe(LABEL_RADIUS_OFFSET);
    expect(labelRadiusOffset(2)).toBe(LABEL_RADIUS_OFFSET);
    expect(labelRadiusOffset(1)).toBe(LABEL_RADIUS_OFFSET + LABEL_RADIUS_STAGGER);
    expect(labelRadiusOffset(3)).toBe(LABEL_RADIUS_OFFSET + LABEL_RADIUS_STAGGER);
  });
});

// --- Semantic zoom -------------------------------------------------------

/** Terse host factory for family tests. */
function h(label: string, severity: Severity | undefined = undefined): FamilyMemberHost {
  return { id: label, label, severity };
}

function range(prefix: string, n: number, sev: Severity | undefined = undefined): FamilyMemberHost[] {
  return Array.from({ length: n }, (_, i) => h(`${prefix}${String(i + 1).padStart(2, "0")}`, sev));
}

describe("deriveNameFamilies", () => {
  it("groups by longest common prefix up to the last separator (≥ min size)", () => {
    const families = deriveNameFamilies([...range("vpn-wrt-", 4), ...range("icx7150-", 5)]);
    const keys = families.map((f) => f.key);
    expect(keys).toContain("vpn-wrt-");
    expect(keys).toContain("icx7150-");
    const vpn = families.find((f) => f.key === "vpn-wrt-")!;
    expect(vpn.kind).toBe("prefix");
    expect(vpn.hosts).toHaveLength(4);
    expect(vpn.label).toBe("vpn-wrt-…");
  });

  it("prefers the LONGER shared prefix when it still reaches the min size", () => {
    // 4× vpn-wrt-fra-* and 4× vpn-wrt-ber-* → two families, not one "vpn-wrt-".
    const families = deriveNameFamilies([...range("vpn-wrt-fra-", 4), ...range("vpn-wrt-ber-", 4)]);
    const keys = families.map((f) => f.key).sort();
    expect(keys).toEqual(["vpn-wrt-ber-", "vpn-wrt-fra-"]);
  });

  it("falls back to the domain suffix (after the first dot) when no prefix qualifies", () => {
    const hosts = [
      h("web1.stw-bonn.de"),
      h("mail.stw-bonn.de"),
      h("db.stw-bonn.de"),
      h("ns.stw-bonn.de"),
    ];
    const families = deriveNameFamilies(hosts);
    expect(families).toHaveLength(1);
    expect(families[0]!.key).toBe("stw-bonn.de");
    expect(families[0]!.kind).toBe("domain");
    expect(families[0]!.label).toBe("*.stw-bonn.de");
  });

  it("puts groups below the min size (prefix AND domain) into a single 'Sonstige' family", () => {
    const families = deriveNameFamilies([h("sw-3-a"), h("sw-3-b"), h("sw-3-c"), h("printer"), h("nas")]);
    // sw-3-* is only 3 (< 4) → not a prefix family; none have a domain → all misc.
    expect(families).toHaveLength(1);
    expect(families[0]!.key).toBe(MISC_FAMILY_KEY);
    expect(families[0]!.kind).toBe("misc");
    expect(families[0]!.hosts).toHaveLength(5);
  });

  it("orders prefix families, then domain families (each alphabetical), then 'Sonstige' last", () => {
    const families = deriveNameFamilies([
      ...range("vpn-wrt-", 4),
      ...range("icx7150-", 4),
      h("a.cygnusnet.de"),
      h("b.cygnusnet.de"),
      h("c.cygnusnet.de"),
      h("d.cygnusnet.de"),
      h("lonely"),
    ]);
    expect(families.map((f) => f.key)).toEqual(["icx7150-", "vpn-wrt-", "cygnusnet.de", MISC_FAMILY_KEY]);
  });
});

describe("staysStandalone", () => {
  it("keeps Average+ (≥3) hosts standalone, folds Warning and below", () => {
    expect(staysStandalone(undefined)).toBe(false);
    expect(staysStandalone(2)).toBe(false);
    expect(staysStandalone(3)).toBe(true);
    expect(staysStandalone(5)).toBe(true);
  });
});

describe("buildSemanticRing", () => {
  it("pulls Average+ hosts out as standalone dots and keeps a meta-node for the rest", () => {
    const familyA = deriveNameFamilies([h("aaa-1", 5), h("aaa-2", 1), h("aaa-3"), h("aaa-4", 2)]);
    const ring = buildSemanticRing(familyA);
    const hostEntries = ring.filter((e) => e.kind === "host");
    const metaEntries = ring.filter((e) => e.kind === "family");
    // aaa-1 (Disaster) stays a dot; aaa-2/3/4 (≤ Warning) fold into the meta-node.
    expect(hostEntries.map((e) => e.id)).toEqual(["aaa-1"]);
    expect(metaEntries).toHaveLength(1);
    expect(metaEntries[0]!.represented!.map((r) => r.id)).toEqual(["aaa-2", "aaa-3", "aaa-4"]);
  });

  it("emits no meta-node for an all-severe family (every member stays a dot, worst first)", () => {
    const fam = deriveNameFamilies([h("bbb-1", 4), h("bbb-2", 3), h("bbb-3", 5), h("bbb-4", 3)]);
    const ring = buildSemanticRing(fam);
    expect(ring.every((e) => e.kind === "host")).toBe(true);
    expect(ring.map((e) => e.host!.severity)).toEqual([5, 4, 3, 3]);
  });
});

describe("representedWorstSeverity / representedProblemCount / severityDistribution", () => {
  const members = [h("x", 2), h("y"), h("z", 1), h("w", 2)];
  it("reports the worst represented severity and the problem count", () => {
    expect(representedWorstSeverity(members)).toBe(2);
    expect(representedWorstSeverity([h("a"), h("b")])).toBeUndefined();
    expect(representedProblemCount(members)).toBe(3);
  });
  it("builds a worst-first severity distribution plus an OK count", () => {
    const dist = severityDistribution(members);
    expect(dist.okCount).toBe(1);
    expect(dist.entries).toEqual([
      { severity: 2, count: 2 },
      { severity: 1, count: 1 },
    ]);
  });
});

describe("metaNodeRadius", () => {
  it("has a floor, grows with √count, and is capped", () => {
    expect(metaNodeRadius(0)).toBe(META_NODE_MIN_R);
    expect(metaNodeRadius(9)).toBeGreaterThan(metaNodeRadius(4));
    expect(metaNodeRadius(100_000)).toBe(META_NODE_MAX_R);
  });
});

describe("detailLevelForZoom", () => {
  it("maps zoom relative to the fit scale onto levels 1/2/3", () => {
    expect(detailLevelForZoom(1, 1)).toBe(1);
    expect(detailLevelForZoom(DETAIL_LEVEL_2_ZOOM - 0.01, 1)).toBe(1);
    expect(detailLevelForZoom(DETAIL_LEVEL_2_ZOOM, 1)).toBe(2);
    expect(detailLevelForZoom(DETAIL_LEVEL_3_ZOOM - 0.01, 1)).toBe(2);
    expect(detailLevelForZoom(DETAIL_LEVEL_3_ZOOM, 1)).toBe(3);
  });

  it("uses the ratio, not absolute scale (fit scale ≠ 1)", () => {
    expect(detailLevelForZoom(3.2, 2)).toBe(2); // rel = 1.6
    expect(detailLevelForZoom(8, 2)).toBe(3); // rel = 4
  });

  it("falls back to level 1 for a non-positive fit scale", () => {
    expect(detailLevelForZoom(5, 0)).toBe(1);
  });
});
