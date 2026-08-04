import { describe, expect, it } from "vitest";
import type { ZabbixHost, ZabbixMap } from "@auzui/zabbix-client";
import {
  buildTopology,
  clusterMatchesQuery,
  deriveMapClusters,
  deriveProxyClusters,
  deriveSubnetClusters,
  findClusterForHostQuery,
  resolveMapLabel,
  sortClustersBySeverity,
  DIRECT_PROXY_CLUSTER_ID,
  type ClusterSummary,
} from "../topology";

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

  it("treats proxyid '0' (no proxy) as no proxy — never a 'Proxy 0' node", () => {
    const hosts = [
      mkHost({ hostid: "1", proxyid: "0" }),
      mkHost({ hostid: "2", proxyid: "0" }),
      mkHost({ hostid: "3" }), // undefined proxyid
    ];
    const graph = buildTopology(hosts, [], new Map());
    expect(graph.nodes.filter((n) => n.kind === "proxy")).toHaveLength(0);
    expect(graph.edges.filter((e) => e.level === "logical")).toHaveLength(0);
    expect(graph.nodes.some((n) => n.label === "Proxy 0")).toBe(false);
  });

  it("uses the resolved proxy name (proxy.get) instead of 'Proxy <id>' when available", () => {
    const hosts = [mkHost({ hostid: "1", proxyid: "5" }), mkHost({ hostid: "2", proxyid: "5" })];
    const graph = buildTopology(hosts, [], new Map(), new Map([["5", "proxy-fra1"]]));
    const proxyNode = graph.nodes.find((n) => n.kind === "proxy");
    expect(proxyNode?.label).toBe("proxy-fra1");
  });

  it("falls back to 'Proxy <id>' when no name was resolved", () => {
    const hosts = [mkHost({ hostid: "1", proxyid: "5" }), mkHost({ hostid: "2", proxyid: "5" })];
    const graph = buildTopology(hosts, [], new Map());
    const proxyNode = graph.nodes.find((n) => n.kind === "proxy");
    expect(proxyNode?.label).toBe("Proxy 5");
  });
});

describe("deriveSubnetClusters", () => {
  it("groups hosts by /24, including single-host subnets (unlike the graph hub, the cluster list is a full overview)", () => {
    const hosts = [
      mkHost({ hostid: "1", name: "a", interfaces: [{ interfaceid: "i1", ip: "10.0.0.1", dns: "", useip: "1", port: "161", type: "2" }] }),
      mkHost({ hostid: "2", name: "b", interfaces: [{ interfaceid: "i2", ip: "10.0.0.2", dns: "", useip: "1", port: "161", type: "2" }] }),
      mkHost({ hostid: "3", name: "c", interfaces: [{ interfaceid: "i3", ip: "192.0.2.1", dns: "", useip: "1", port: "161", type: "2" }] }),
    ];
    const clusters = deriveSubnetClusters(hosts, new Map());
    expect(clusters).toHaveLength(2);
    const solo = clusters.find((c) => c.name === "192.0.2.0/24")!;
    expect(solo.hosts).toHaveLength(1);
  });

  it("derives cluster severity as the worst active problem among its hosts", () => {
    const hosts = [
      mkHost({ hostid: "1", interfaces: [{ interfaceid: "i1", ip: "10.0.0.1", dns: "", useip: "1", port: "161", type: "2" }] }),
      mkHost({ hostid: "2", interfaces: [{ interfaceid: "i2", ip: "10.0.0.2", dns: "", useip: "1", port: "161", type: "2" }] }),
    ];
    const problemsByHost = new Map([["1", { count: 1, maxSeverity: 2 as const }], ["2", { count: 1, maxSeverity: 4 as const }]]);
    const clusters = deriveSubnetClusters(hosts, problemsByHost);
    expect(clusters[0]!.severity).toBe(4);
  });
});

describe("deriveProxyClusters", () => {
  const DIRECT = "Directly monitored (no proxy)";

  it("groups hosts by proxyid and resolves the proxy name", () => {
    const hosts = [mkHost({ hostid: "1", proxyid: "5" }), mkHost({ hostid: "2", proxyid: "5" })];
    const clusters = deriveProxyClusters(hosts, new Map(), new Map([["5", "proxy-fra1"]]), DIRECT);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ id: "proxy:5", name: "proxy-fra1" });
    expect(clusters[0]!.hosts).toHaveLength(2);
  });

  it("falls back to 'Proxy <id>' without a resolved name", () => {
    const hosts = [mkHost({ hostid: "1", proxyid: "9" })];
    const clusters = deriveProxyClusters(hosts, new Map(), new Map(), DIRECT);
    expect(clusters[0]!.name).toBe("Proxy 9");
  });

  it("buckets hosts with proxyid '0'/undefined into the 'directly monitored' cluster, not 'Proxy 0'", () => {
    const hosts = [
      mkHost({ hostid: "1", proxyid: "5" }),
      mkHost({ hostid: "2", proxyid: "0" }),
      mkHost({ hostid: "3" }),
      mkHost({ hostid: "4", proxyid: "" }),
    ];
    const clusters = deriveProxyClusters(hosts, new Map(), new Map([["5", "proxy-fra1"]]), DIRECT);
    expect(clusters.some((c) => c.name === "Proxy 0")).toBe(false);
    const direct = clusters.find((c) => c.id === DIRECT_PROXY_CLUSTER_ID)!;
    expect(direct).toBeDefined();
    expect(direct.name).toBe(DIRECT);
    expect(direct.hosts.map((h) => h.hostid).sort()).toEqual(["2", "3", "4"]);
  });

  it("omits the 'directly monitored' cluster when every host has a real proxy", () => {
    const hosts = [mkHost({ hostid: "1", proxyid: "5" })];
    const clusters = deriveProxyClusters(hosts, new Map(), new Map(), DIRECT);
    expect(clusters.some((c) => c.id === DIRECT_PROXY_CLUSTER_ID)).toBe(false);
  });

  // Zabbix ≥7.0: a proxy-group host reports proxyid "0", so keying on proxyid
  // alone filed every one of them under "directly monitored".
  it("groups proxy-group hosts by their group instead of calling them directly monitored", () => {
    const hosts = [
      mkHost({ hostid: "1", monitored_by: "2", proxyid: "0", proxy_groupid: "2", assigned_proxyid: "4" }),
      mkHost({ hostid: "2", monitored_by: "2", proxyid: "0", proxy_groupid: "2", assigned_proxyid: "7" }),
      mkHost({ hostid: "3", monitored_by: "1", proxyid: "5" }),
      mkHost({ hostid: "4", monitored_by: "0", proxyid: "0" }),
    ];
    const clusters = deriveProxyClusters(
      hosts,
      new Map(),
      new Map([["5", "proxy-fra1"]]),
      DIRECT,
      new Map([["2", "proxies_cygnusnet"]]),
    );
    const group = clusters.find((c) => c.id === "proxygroup:2")!;
    expect(group).toBeDefined();
    expect(group.name).toBe("proxies_cygnusnet");
    // Assigned proxy moves on failover — the group, not the proxy, is the cluster.
    expect(group.hosts.map((h) => h.hostid).sort()).toEqual(["1", "2"]);
    expect(clusters.find((c) => c.id === "proxy:5")!.hosts).toHaveLength(1);
    expect(clusters.find((c) => c.id === DIRECT_PROXY_CLUSTER_ID)!.hosts.map((h) => h.hostid)).toEqual(["4"]);
  });

  it("falls back to 'Proxy group <id>' for an unresolved group name", () => {
    const hosts = [mkHost({ hostid: "1", monitored_by: "2", proxyid: "0", proxy_groupid: "3" })];
    const clusters = deriveProxyClusters(hosts, new Map(), new Map(), DIRECT);
    expect(clusters[0]!.name).toBe("Proxy group 3");
  });

  it("keeps pre-7.0 payloads (no monitored_by) working off proxyid alone", () => {
    const hosts = [mkHost({ hostid: "1", proxyid: "5" }), mkHost({ hostid: "2", proxyid: "0" })];
    const clusters = deriveProxyClusters(hosts, new Map(), new Map([["5", "p"]]), DIRECT);
    expect(clusters.find((c) => c.id === "proxy:5")!.hosts).toHaveLength(1);
    expect(clusters.find((c) => c.id === DIRECT_PROXY_CLUSTER_ID)!.hosts).toHaveLength(1);
  });

  it("treats monitored_by '2' without a usable group id as directly monitored, never 'Proxy group 0'", () => {
    const hosts = [mkHost({ hostid: "1", monitored_by: "2", proxyid: "0", proxy_groupid: "0" })];
    const clusters = deriveProxyClusters(hosts, new Map(), new Map(), DIRECT);
    expect(clusters.some((c) => c.name.startsWith("Proxy group"))).toBe(false);
    expect(clusters.find((c) => c.id === DIRECT_PROXY_CLUSTER_ID)!.hosts).toHaveLength(1);
  });
});

describe("resolveMapLabel", () => {
  const host = mkHost({
    hostid: "1",
    host: "sw01.tech",
    name: "Switch 01",
    interfaces: [{ interfaceid: "i1", ip: "10.0.0.5", dns: "sw01.example.net", useip: "1", port: "161", type: "2" }],
  });

  it("resolves the common host macros against the loaded host", () => {
    expect(resolveMapLabel("{HOST.NAME}", host)).toBe("Switch 01");
    expect(resolveMapLabel("{HOSTNAME}", host)).toBe("Switch 01");
    expect(resolveMapLabel("{HOST.HOST}", host)).toBe("sw01.tech");
    expect(resolveMapLabel("{HOST.IP}", host)).toBe("10.0.0.5");
    expect(resolveMapLabel("{IPADDRESS}", host)).toBe("10.0.0.5");
    expect(resolveMapLabel("{HOST.DNS}", host)).toBe("sw01.example.net");
  });

  it("resolves {HOST.CONN} to the IP or DNS depending on interface.useip", () => {
    expect(resolveMapLabel("{HOST.CONN}", host)).toBe("10.0.0.5");
    const dnsHost = mkHost({
      interfaces: [{ interfaceid: "i1", ip: "10.0.0.5", dns: "sw01.example.net", useip: "0", port: "161", type: "2" }],
    });
    expect(resolveMapLabel("{HOST.CONN}", dnsHost)).toBe("sw01.example.net");
  });

  it("substitutes macros inside surrounding text", () => {
    expect(resolveMapLabel("{HOST.NAME} ({HOST.IP})", host)).toBe("Switch 01 (10.0.0.5)");
  });

  it("drops unknown macros and collapses the whitespace/blank lines they leave behind", () => {
    expect(resolveMapLabel("{HOST.NAME}\n{UNKNOWN.MACRO}", host)).toBe("Switch 01");
    expect(resolveMapLabel("Core {SOME.THING} switch", host)).toBe("Core switch");
    expect(resolveMapLabel("{$UNRESOLVED}", host)).toBe("");
  });

  it("returns an empty string when the macro cannot be resolved (no host / no interface)", () => {
    expect(resolveMapLabel("{HOST.NAME}", undefined)).toBe("");
    const noIface = mkHost({ name: "n", host: "h", interfaces: [] });
    expect(resolveMapLabel("{HOST.IP}", noIface)).toBe("");
    expect(resolveMapLabel("{HOST.CONN}", noIface)).toBe("");
    expect(resolveMapLabel("{HOST.NAME}", noIface)).toBe("n");
  });

  it("leaves macro-free labels untouched", () => {
    expect(resolveMapLabel("Core Switch", host)).toBe("Core Switch");
    expect(resolveMapLabel("", host)).toBe("");
  });
});

describe("deriveMapClusters", () => {
  it("resolves cluster hosts from map selements, ignoring non-host elements and unknown hostids", () => {
    const hostByHostId = new Map([
      ["1", mkHost({ hostid: "1", name: "h1" })],
      ["2", mkHost({ hostid: "2", name: "h2" })],
    ]);
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
          { selementid: "se4", elementtype: "0", label: "unknown", x: "0", y: "0", elements: [{ hostid: "999" }] },
        ],
      },
    ];
    const clusters = deriveMapClusters(maps, hostByHostId, new Map());
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ id: "map:10", name: "Core" });
    expect(clusters[0]!.hosts.map((h) => h.hostid).sort()).toEqual(["1", "2"]);
  });
});

describe("sortClustersBySeverity", () => {
  function cluster(name: string, severity: ClusterSummary["severity"]): ClusterSummary {
    return { id: name, kind: "subnet", name, hosts: [], severity };
  }

  it("sorts worst severity first, then by name; OK clusters (undefined) sort last", () => {
    const clusters = [cluster("b-subnet", undefined), cluster("a-subnet", 2), cluster("z-subnet", 4), cluster("a-ok", undefined)];
    const sorted = sortClustersBySeverity(clusters);
    expect(sorted.map((c) => c.name)).toEqual(["z-subnet", "a-subnet", "a-ok", "b-subnet"]);
  });
});

describe("clusterMatchesQuery / findClusterForHostQuery", () => {
  const clusters: ClusterSummary[] = [
    {
      id: "s1",
      kind: "subnet",
      name: "10.0.0.0/24",
      hosts: [{ hostid: "1", label: "core-sw01", severity: undefined, problemCount: 0, ip: "10.0.0.1" }],
      severity: undefined,
    },
    {
      id: "s2",
      kind: "subnet",
      name: "192.0.2.0/24",
      hosts: [{ hostid: "2", label: "edge-fw02", severity: 4, problemCount: 1, ip: "192.0.2.1" }],
      severity: 4,
    },
  ];

  it("matches on cluster name or any member host name, case-insensitively", () => {
    expect(clusterMatchesQuery(clusters[0]!, "10.0.0")).toBe(true);
    expect(clusterMatchesQuery(clusters[0]!, "CORE-SW01")).toBe(true);
    expect(clusterMatchesQuery(clusters[0]!, "edge")).toBe(false);
    expect(clusterMatchesQuery(clusters[0]!, "")).toBe(true);
  });

  it("finds the cluster containing a matching host, for jump-to-host search", () => {
    expect(findClusterForHostQuery(clusters, "edge-fw02")?.id).toBe("s2");
    expect(findClusterForHostQuery(clusters, "nope")).toBeUndefined();
    expect(findClusterForHostQuery(clusters, "")).toBeUndefined();
  });
});
