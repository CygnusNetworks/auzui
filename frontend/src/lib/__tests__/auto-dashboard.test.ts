import { describe, expect, it } from "vitest";
import type { ZabbixItem, ZabbixTrigger } from "@auzui/zabbix-client";
import {
  buildDashboard,
  buildInstanceFamilyCharts,
  classifyItem,
  directionLabel,
  extractThresholds,
  isBooleanStateItem,
  MAX_CHARTS_PER_SECTION,
  pairKey,
  parseItemKey,
} from "../auto-dashboard";
import { NO_COMPONENT_SECTION } from "../latest-items";

function mkItem(overrides: Partial<ZabbixItem> = {}): ZabbixItem {
  return {
    itemid: "1",
    hostid: "10",
    name: "Item",
    key_: "some.key",
    value_type: "0",
    units: "",
    tags: [],
    ...overrides,
  };
}

describe("classifyItem", () => {
  it("prioritizes the component tag over unit and key", () => {
    const item = mkItem({ key_: "net.if.in[eth0]", units: "bps", tags: [{ tag: "component", value: "power" }] });
    expect(classifyItem(item).section).toBe("power");
    // viz still comes from the unit even when the tag wins the section.
    expect(classifyItem(item).viz).toBe("area");
  });

  it("falls back to unit-based classification without a tag", () => {
    expect(classifyItem(mkItem({ key_: "custom.metric", units: "bps" })).viz).toBe("area");
    expect(classifyItem(mkItem({ key_: "custom.metric", units: "%" })).viz).toBe("line");
    expect(classifyItem(mkItem({ key_: "custom.metric", units: "B" })).viz).toBe("capacity");
    expect(classifyItem(mkItem({ key_: "custom.metric", units: "s" })).viz).toBe("line");
    const temp = classifyItem(mkItem({ key_: "custom.metric", units: "°C" }));
    expect(temp.viz).toBe("line");
    expect(temp.section).toBe("temperature");
    const uptime = classifyItem(mkItem({ key_: "custom.metric", units: "uptime" }));
    expect(uptime.viz).toBe("counter");
    expect(uptime.section).toBe("system");
  });

  it("falls back to key_ patterns when there is no tag and no informative unit", () => {
    expect(classifyItem(mkItem({ key_: "system.cpu.util", units: "" })).section).toBe("cpu");
    expect(classifyItem(mkItem({ key_: "vm.memory.size[pavailable]", units: "" })).section).toBe("memory");
    expect(classifyItem(mkItem({ key_: "net.if.in[eth0]", units: "" })).section).toBe("network");
    expect(classifyItem(mkItem({ key_: "vfs.fs.size[/,pused]", units: "" })).section).toBe("storage");
    expect(classifyItem(mkItem({ key_: "proc.num[httpd]", units: "" })).section).toBe("process");
    expect(classifyItem(mkItem({ key_: "sensor.temp.value[0]", units: "" })).section).toBe("sensor");
  });

  it("lands in NO_COMPONENT_SECTION when nothing matches", () => {
    expect(classifyItem(mkItem({ key_: "something.custom", units: "" })).section).toBe(NO_COMPONENT_SECTION);
  });
});

describe("parseItemKey", () => {
  it("splits base and params for a simple key", () => {
    expect(parseItemKey("net.if.in[eth0]")).toEqual({ base: "net.if.in", params: ["eth0"] });
  });

  it("returns the whole key as base with no params when there are no brackets", () => {
    expect(parseItemKey("system.cpu.util")).toEqual({ base: "system.cpu.util", params: [] });
  });

  it("keeps empty params, e.g. an unspecified first param", () => {
    expect(parseItemKey("system.cpu.util[,user]")).toEqual({ base: "system.cpu.util", params: ["", "user"] });
  });

  it("respects commas inside quoted params", () => {
    expect(parseItemKey('vfs.fs.size["/mnt/data, backup",pused]')).toEqual({
      base: "vfs.fs.size",
      params: ["/mnt/data, backup", "pused"],
    });
  });

  it("handles escaped quotes inside a quoted param", () => {
    expect(parseItemKey('key["a \\"quoted\\" value",b]')).toEqual({
      base: "key",
      params: ['a "quoted" value', "b"],
    });
  });

  it("keeps nested brackets inside a param intact", () => {
    expect(parseItemKey("key[a,b[c,d]]")).toEqual({ base: "key", params: ["a", "b[c,d]"] });
  });
});

describe("pairKey", () => {
  it("normalizes a whole-component direction word", () => {
    expect(pairKey("net.if.in")).toBe("net.if.⇄");
    expect(pairKey("net.if.out")).toBe("net.if.⇄");
  });

  it("normalizes a direction prefix joined by underscore, keeping the suffix", () => {
    expect(pairKey("docker.networks.rx_bytes")).toBe("docker.networks.⇄_bytes");
    expect(pairKey("docker.networks.tx_bytes")).toBe("docker.networks.⇄_bytes");
  });

  it("returns the base unchanged when there is no direction word", () => {
    expect(pairKey("vfs.fs.size")).toBe("vfs.fs.size");
  });
});

describe("directionLabel", () => {
  it("extracts the matched direction word", () => {
    expect(directionLabel("net.if.in")).toBe("in");
    expect(directionLabel("docker.networks.rx_bytes")).toBe("rx");
  });

  it("returns undefined when there is no direction word", () => {
    expect(directionLabel("vfs.fs.size")).toBeUndefined();
  });
});

describe("isBooleanStateItem", () => {
  it("flags uint items with a state/status/paused/running key component", () => {
    expect(isBooleanStateItem(mkItem({ key_: 'docker.container_info.state.paused["/x"]', value_type: "3" }))).toBe(
      true,
    );
    expect(isBooleanStateItem(mkItem({ key_: "agent.status", value_type: "3" }))).toBe(true);
  });

  it("ignores non-uint items even with a matching key", () => {
    expect(isBooleanStateItem(mkItem({ key_: "agent.status", value_type: "0" }))).toBe(false);
  });

  it("ignores uint items without a matching key component", () => {
    expect(isBooleanStateItem(mkItem({ key_: "system.cpu.util", value_type: "3" }))).toBe(false);
  });
});

describe("buildInstanceFamilyCharts", () => {
  it("merges a direction pair with identical params into one 2-series chart", () => {
    const items = [
      mkItem({
        itemid: "1",
        name: "eth0: Bytes received",
        key_: "docker.networks.rx_bytes[/c1]",
        units: "Bps",
      }),
      mkItem({
        itemid: "2",
        name: "eth0: Bytes sent",
        key_: "docker.networks.tx_bytes[/c1]",
        units: "Bps",
      }),
    ];
    const charts = buildInstanceFamilyCharts(items, []);
    expect(charts).toHaveLength(1);
    expect(charts[0]!.items).toHaveLength(2);
    expect(charts[0]!.seriesLabels).toEqual(["rx", "tx"]);
  });

  it("groups same-base/same-unit items with different LLD params into one instance family", () => {
    const items = [
      mkItem({ itemid: "1", name: "c1: CPU", key_: "docker.container_info.cpu.usage[/c1]", units: "%" }),
      mkItem({ itemid: "2", name: "c2: CPU", key_: "docker.container_info.cpu.usage[/c2]", units: "%" }),
      mkItem({ itemid: "3", name: "c3: CPU", key_: "docker.container_info.cpu.usage[/c3]", units: "%" }),
    ];
    const charts = buildInstanceFamilyCharts(items, []);
    expect(charts).toHaveLength(1);
    expect(charts[0]!.items).toHaveLength(3);
    expect(charts[0]!.id).toMatch(/^family:/);
  });

  it("caps an instance family at MAX_CHARTS_PER_SECTION instances by lastvalue, noting the rest in the title", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      mkItem({
        itemid: String(i),
        name: `c${i}: CPU`,
        key_: `docker.container_info.cpu.usage[/c${i}]`,
        units: "%",
        lastvalue: String(i), // c9 highest, c0 lowest
      }),
    );
    const charts = buildInstanceFamilyCharts(items, []);
    expect(charts).toHaveLength(1);
    expect(charts[0]!.items).toHaveLength(MAX_CHARTS_PER_SECTION);
    expect(charts[0]!.title).toContain("+2 weitere");
    // Highest lastvalues (c9, c8, ...) are kept, lowest (c0, c1) dropped.
    expect(charts[0]!.items.map((i) => i.itemid)).not.toContain("0");
    expect(charts[0]!.items.map((i) => i.itemid)).not.toContain("1");
  });

  it("renders a single, non-paired item as its own chart unchanged", () => {
    const items = [mkItem({ itemid: "1", name: "Solo", key_: "custom.metric", units: "%" })];
    const charts = buildInstanceFamilyCharts(items, []);
    expect(charts).toEqual([
      {
        id: "1",
        title: "Solo",
        viz: "line",
        items: [items[0]],
        seriesLabels: ["Solo"],
        thresholds: [],
      },
    ]);
  });
});

describe("buildDashboard semantic bundles", () => {
  it("collapses a CPU util type breakdown into one chart, dropping idle", () => {
    const items: ZabbixItem[] = [
      mkItem({ itemid: "1", name: "CPU user", key_: "system.cpu.util[,user]", units: "%" }),
      mkItem({ itemid: "2", name: "CPU system", key_: "system.cpu.util[,system]", units: "%" }),
      mkItem({ itemid: "3", name: "CPU idle", key_: "system.cpu.util[,idle]", units: "%" }),
    ];
    const dashboard = buildDashboard({}, items, []);
    expect(dashboard.sections).toHaveLength(1);
    const chart = dashboard.sections[0]!.charts[0]!;
    expect(chart.title).toBe("CPU Utilization");
    expect(chart.items).toHaveLength(2);
    expect(chart.seriesLabels).toEqual(["User", "System"]);
  });

  it("does not apply the CPU-util-type bundle rule to a single-param key (e.g. a percpu index), but still folds same-unit per-core instances into one family chart", () => {
    const items: ZabbixItem[] = [
      mkItem({ itemid: "1", key_: "system.cpu.util[2]", name: "CPU 2" }),
      mkItem({ itemid: "2", key_: "system.cpu.util[1]", name: "CPU 1" }),
    ];
    const dashboard = buildDashboard({}, items, []);
    expect(dashboard.sections[0]!.charts).toHaveLength(1);
    const chart = dashboard.sections[0]!.charts[0]!;
    expect(chart.title).not.toBe("CPU Utilization");
    expect(chart.items.map((i) => i.itemid).sort()).toEqual(["1", "2"]);
  });

  it("puts boolean/state items into textItems, not into a chart section", () => {
    const items: ZabbixItem[] = [
      mkItem({ itemid: "1", value_type: "0", key_: "system.cpu.util", name: "CPU" }),
      mkItem({
        itemid: "2",
        value_type: "3",
        key_: 'docker.container_info.state.paused["/x"]',
        name: "Paused",
        lastvalue: "0",
      }),
    ];
    const dashboard = buildDashboard({}, items, []);
    expect(dashboard.textItems.map((i) => i.itemid)).toEqual(["2"]);
    expect(dashboard.sections.flatMap((s) => s.charts.map((c) => c.id))).toEqual(["1"]);
  });
});

function mkTrigger(overrides: Partial<ZabbixTrigger> = {}): ZabbixTrigger {
  return {
    triggerid: "1",
    description: "trigger",
    expression: "",
    priority: "2",
    items: [{ itemid: "1", key_: "k", name: "n", value_type: "0" }],
    ...overrides,
  };
}

describe("extractThresholds", () => {
  it("extracts a > threshold with a time-window function", () => {
    const triggers = [
      mkTrigger({ expression: "max(/host/zabbix[rcache,buffer,pused],10m)>75", priority: "3" }),
    ];
    expect(extractThresholds(triggers, "1")).toEqual([
      { value: 75, label: "trigger", severity: "avg" },
    ]);
  });

  it("extracts >=, < and <= operators", () => {
    expect(extractThresholds([mkTrigger({ expression: "last(/h/k)>=90", priority: "4" })], "1")).toEqual([
      { value: 90, label: "trigger", severity: "high" },
    ]);
    expect(extractThresholds([mkTrigger({ expression: "last(/h/k)<5", priority: "1" })], "1")).toEqual([
      { value: 5, label: "trigger", severity: "info" },
    ]);
    expect(extractThresholds([mkTrigger({ expression: "min(/h/k,10m)<=1000", priority: "2" })], "1")).toEqual([
      { value: 1000, label: "trigger", severity: "warn" },
    ]);
  });

  it("returns nothing when the trigger doesn't reference the item", () => {
    const triggers = [mkTrigger({ items: [{ itemid: "999", key_: "k", name: "n", value_type: "0" }] })];
    expect(extractThresholds(triggers, "1")).toEqual([]);
  });

  it("returns nothing when the expression has no comparison operator", () => {
    const triggers = [mkTrigger({ expression: "nodata(/h/k,30m)=1" })];
    expect(extractThresholds(triggers, "1")).toEqual([]);
  });
});

describe("buildDashboard", () => {
  it("groups interface items with the same tag value into one multi-series chart", () => {
    const items: ZabbixItem[] = [
      mkItem({
        itemid: "1",
        name: "Bits received",
        key_: "net.if.in[eth0]",
        units: "bps",
        tags: [
          { tag: "component", value: "network" },
          { tag: "interface", value: "eth0" },
        ],
      }),
      mkItem({
        itemid: "2",
        name: "Bits sent",
        key_: "net.if.out[eth0]",
        units: "bps",
        tags: [
          { tag: "component", value: "network" },
          { tag: "interface", value: "eth0" },
        ],
      }),
    ];
    const dashboard = buildDashboard({}, items, []);
    expect(dashboard.sections).toHaveLength(1);
    expect(dashboard.sections[0]!.section).toBe("network");
    expect(dashboard.sections[0]!.charts).toHaveLength(1);
    const chart = dashboard.sections[0]!.charts[0]!;
    expect(chart.title).toBe("Interface eth0");
    expect(chart.items).toHaveLength(2);
    expect(chart.seriesLabels).toEqual(["in", "out"]);
  });

  it("puts text items in a separate bucket, not into any chart section", () => {
    const items: ZabbixItem[] = [
      mkItem({ itemid: "1", value_type: "0", key_: "system.cpu.util", name: "CPU" }),
      mkItem({ itemid: "2", value_type: "4", key_: "system.sw.os", name: "OS" }),
    ];
    const dashboard = buildDashboard({}, items, []);
    expect(dashboard.textItems.map((i) => i.itemid)).toEqual(["2"]);
    expect(dashboard.sections.flatMap((s) => s.charts.map((c) => c.id))).toEqual(["1"]);
  });

  it("orders sections network-first for switch/SNMP roles", () => {
    const items: ZabbixItem[] = [
      mkItem({ itemid: "1", key_: "system.cpu.util", name: "CPU" }),
      mkItem({ itemid: "2", key_: "net.if.in[1]", name: "Net", units: "bps" }),
    ];
    const dashboard = buildDashboard(
      { parentTemplates: [{ templateid: "1", name: "Brocade/Foundry Stackable by SNMP" }] },
      items,
      [],
    );
    expect(dashboard.sections.map((s) => s.section)).toEqual(["network", "cpu"]);
  });

  it("orders sections cpu/memory/storage/network first for Linux roles, Sonstige last", () => {
    const items: ZabbixItem[] = [
      mkItem({ itemid: "1", key_: "vfs.fs.size[/,pused]", name: "Disk" }),
      mkItem({ itemid: "2", key_: "system.cpu.util", name: "CPU" }),
      mkItem({ itemid: "3", key_: "custom.other", name: "Other" }),
      mkItem({ itemid: "4", key_: "vm.memory.size[pavailable]", name: "Mem" }),
    ];
    const dashboard = buildDashboard(
      { parentTemplates: [{ templateid: "1", name: "Cygnus Linux by Zabbix agent" }] },
      items,
      [],
    );
    expect(dashboard.sections.map((s) => s.section)).toEqual([
      "cpu",
      "memory",
      "storage",
      NO_COMPONENT_SECTION,
    ]);
  });

  it("sorts charts within a section by title", () => {
    const items: ZabbixItem[] = [
      mkItem({ itemid: "1", key_: "custom.b", name: "B Item" }),
      mkItem({ itemid: "2", key_: "custom.a", name: "A Item" }),
    ];
    const dashboard = buildDashboard({}, items, []);
    expect(dashboard.sections[0]!.charts.map((c) => c.title)).toEqual(["A Item", "B Item"]);
  });

  it("exposes MAX_CHARTS_PER_SECTION as 8 for the UI's collapse threshold", () => {
    expect(MAX_CHARTS_PER_SECTION).toBe(8);
  });
});
