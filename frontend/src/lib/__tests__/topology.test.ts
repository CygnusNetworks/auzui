import { describe, expect, it } from "vitest";
import type { ZabbixHost, ZabbixMap } from "@auzui/zabbix-client";
import { buildTopology } from "../topology";

function mkHost(overrides: Partial<ZabbixHost> = {}): ZabbixHost {
  return {
    hostid: "1",
    host: "h1",
    name: "h1",
    status: "0",
    ...overrides,
  };
}

describe("buildTopology", () => {
  it("clusters hosts sharing a /24 into one subnet hub node, no duplicate edges", () => {
    const hosts = [
      mkHost({
        hostid: "1",
        name: "sw01",
        interfaces: [{ interfaceid: "i1", ip: "192.0.2.10", dns: "", useip: "1", port: "161", type: "2" }],
      }),
      mkHost({
        hostid: "2",
        name: "sw02",
        interfaces: [{ interfaceid: "i2", ip: "192.0.2.20", dns: "", useip: "1", port: "161", type: "2" }],
      }),
      mkHost({
        hostid: "3",
        name: "other-subnet",
        interfaces: [{ interfaceid: "i3", ip: "198.51.100.5", dns: "", useip: "1", port: "161", type: "2" }],
      }),
    ];

    const graph = buildTopology(hosts, [], new Map());

    const subnetNodes = graph.nodes.filter((n) => n.kind === "subnet");
    expect(subnetNodes).toHaveLength(1);
    expect(subnetNodes[0]!.id).toBe("subnet:192.0.2.0/24");

    const l3Edges = graph.edges.filter((e) => e.level === "l3");
    expect(l3Edges).toHaveLength(2);
    expect(new Set(l3Edges.map((e) => e.source))).toEqual(new Set(["host:1", "host:2"]));
    expect(l3Edges.every((e) => e.target === "subnet:192.0.2.0/24")).toBe(true);

    // host 3 is alone in its subnet — no hub node/edge for it (avoids clutter).
    expect(graph.nodes.some((n) => n.kind === "subnet" && n.label === "198.51.100.0/24")).toBe(false);
  });

  it("does not create a hub for a single host in a subnet", () => {
    const hosts = [
      mkHost({
        hostid: "1",
        interfaces: [{ interfaceid: "i1", ip: "10.0.0.1", dns: "", useip: "1", port: "161", type: "2" }],
      }),
    ];
    const graph = buildTopology(hosts, [], new Map());
    expect(graph.nodes.filter((n) => n.kind === "subnet")).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("builds explicit edges from map.get selements + links, ignoring non-host elements", () => {
    const hosts = [mkHost({ hostid: "1" }), mkHost({ hostid: "2" }), mkHost({ hostid: "3" })];
    const maps: ZabbixMap[] = [
      {
        sysmapid: "10",
        name: "Core",
        width: "800",
        height: "600",
        selements: [
          { selementid: "se1", elementtype: "0", label: "h1", x: "0", y: "0", elements: [{ hostid: "1" }] },
          { selementid: "se2", elementtype: "0", label: "h2", x: "0", y: "0", elements: [{ hostid: "2" }] },
          { selementid: "se3", elementtype: "3", label: "group", x: "0", y: "0" },
        ],
        links: [{ linkid: "l1", selementid1: "se1", selementid2: "se2" }],
      },
    ];

    const graph = buildTopology(hosts, maps, new Map());
    const explicitEdges = graph.edges.filter((e) => e.level === "explicit");
    expect(explicitEdges).toHaveLength(1);
    expect(explicitEdges[0]).toMatchObject({ source: "host:1", target: "host:2", confidence: 1 });
  });

  it("dedupes explicit edges appearing across multiple maps", () => {
    const hosts = [mkHost({ hostid: "1" }), mkHost({ hostid: "2" })];
    const oneMap: ZabbixMap = {
      sysmapid: "10",
      name: "Core",
      width: "800",
      height: "600",
      selements: [
        { selementid: "se1", elementtype: "0", label: "h1", x: "0", y: "0", elements: [{ hostid: "1" }] },
        { selementid: "se2", elementtype: "0", label: "h2", x: "0", y: "0", elements: [{ hostid: "2" }] },
      ],
      links: [{ linkid: "l1", selementid1: "se1", selementid2: "se2" }],
    };
    const graph = buildTopology(hosts, [oneMap, { ...oneMap, sysmapid: "11" }], new Map());
    expect(graph.edges.filter((e) => e.level === "explicit")).toHaveLength(1);
  });

  it("maps per-host severity from the aggregateHostProblems result", () => {
    const hosts = [mkHost({ hostid: "1" }), mkHost({ hostid: "2" })];
    const problemsByHost = new Map([["1", { count: 2, maxSeverity: 4 as const }]]);
    const graph = buildTopology(hosts, [], problemsByHost);
    const n1 = graph.nodes.find((n) => n.id === "host:1");
    const n2 = graph.nodes.find((n) => n.id === "host:2");
    expect(n1?.severity).toBe(4);
    expect(n2?.severity).toBeUndefined();
  });

  it("creates a proxy-group node + edges for hosts sharing a proxy", () => {
    const hosts = [
      mkHost({ hostid: "1", proxyid: "5" }),
      mkHost({ hostid: "2", proxyid: "5" }),
      mkHost({ hostid: "3", proxyid: "6" }), // alone on its proxy — no node
    ];
    const graph = buildTopology(hosts, [], new Map());
    const proxyNodes = graph.nodes.filter((n) => n.kind === "proxy");
    expect(proxyNodes).toHaveLength(1);
    expect(proxyNodes[0]!.id).toBe("proxy:5");
    const logicalEdges = graph.edges.filter((e) => e.level === "logical");
    expect(logicalEdges).toHaveLength(2);
  });
});
