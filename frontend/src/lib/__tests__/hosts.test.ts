import { describe, expect, it } from "vitest";
import { aggregateHostProblems, matchesHostSearch, sortHosts, summarizeNames } from "../hosts";
import type { ZabbixHost } from "@auzui/zabbix-client";

describe("aggregateHostProblems", () => {
  const triggers = [
    { triggerid: "100", hosts: [{ hostid: "1", host: "h1" }] },
    { triggerid: "101", hosts: [{ hostid: "1", host: "h1" }] },
    { triggerid: "200", hosts: [{ hostid: "2", host: "h2" }] },
  ];

  it("counts problems per host and tracks the max severity", () => {
    const problems = [
      { objectid: "100", severity: "2" },
      { objectid: "101", severity: "4" },
      { objectid: "200", severity: "1" },
    ];
    const result = aggregateHostProblems(problems, triggers);
    expect(result.get("1")).toEqual({ count: 2, maxSeverity: 4 });
    expect(result.get("2")).toEqual({ count: 1, maxSeverity: 1 });
  });

  it("ignores problems whose trigger has no matching host (unmonitored)", () => {
    const result = aggregateHostProblems([{ objectid: "999", severity: "5" }], triggers);
    expect(result.size).toBe(0);
  });

  it("returns an empty map for no problems", () => {
    expect(aggregateHostProblems([], triggers).size).toBe(0);
  });
});

function mkHost(overrides: Partial<ZabbixHost> = {}): ZabbixHost {
  return {
    hostid: "1",
    host: "core-sw01",
    name: "core-sw01",
    status: "0",
    ...overrides,
  };
}

describe("matchesHostSearch", () => {
  it("matches on name, host and interface IP/DNS, case-insensitively", () => {
    const host = mkHost({
      name: "Core Switch 01",
      host: "core-sw01",
      interfaces: [{ interfaceid: "1", ip: "192.0.2.5", dns: "sw01.example.com", useip: "1", port: "161", type: "2" }],
    });
    expect(matchesHostSearch(host, "core")).toBe(true);
    expect(matchesHostSearch(host, "192.0.2.5")).toBe(true);
    expect(matchesHostSearch(host, "SW01.EXAMPLE")).toBe(true);
    expect(matchesHostSearch(host, "nope")).toBe(false);
  });

  it("matches everything for an empty query", () => {
    expect(matchesHostSearch(mkHost(), "  ")).toBe(true);
  });
});

describe("summarizeNames", () => {
  it("returns everything visible with no extra count when under the limit", () => {
    const result = summarizeNames(["a", "b"], 4);
    expect(result).toEqual({ visible: ["a", "b"], extraCount: 0, fullText: "a, b" });
  });

  it("truncates and counts the remainder when over the limit", () => {
    const result = summarizeNames(["a", "b", "c", "d", "e", "f"], 4);
    expect(result.visible).toEqual(["a", "b", "c", "d"]);
    expect(result.extraCount).toBe(2);
    expect(result.fullText).toBe("a, b, c, d, e, f");
  });

  it("handles an empty list", () => {
    expect(summarizeNames([], 4)).toEqual({ visible: [], extraCount: 0, fullText: "" });
  });
});

describe("sortHosts", () => {
  it("sorts by name locale-aware", () => {
    const hosts = [mkHost({ hostid: "1", name: "zeta" }), mkHost({ hostid: "2", name: "alpha" })];
    expect(sortHosts(hosts, "name", new Map()).map((h) => h.name)).toEqual(["alpha", "zeta"]);
  });

  it("sorts by severity, worst first, hosts without problems last", () => {
    const hosts = [
      mkHost({ hostid: "1", name: "quiet" }),
      mkHost({ hostid: "2", name: "hot" }),
      mkHost({ hostid: "3", name: "warm" }),
    ];
    const problemsByHost = new Map([
      ["2", { count: 1, maxSeverity: 4 as const }],
      ["3", { count: 1, maxSeverity: 2 as const }],
    ]);
    expect(sortHosts(hosts, "severity", problemsByHost).map((h) => h.name)).toEqual([
      "hot",
      "warm",
      "quiet",
    ]);
  });
});
