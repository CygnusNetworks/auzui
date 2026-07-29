import { describe, expect, it } from "vitest";
import type { ZabbixItem, ZabbixTrigger } from "@auzui/zabbix-client";
import { buildDashboard, classifyItem, extractThresholds, MAX_CHARTS_PER_SECTION } from "../auto-dashboard";
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
      mkItem({ itemid: "1", key_: "system.cpu.util[2]", name: "CPU 2" }),
      mkItem({ itemid: "2", key_: "system.cpu.util[1]", name: "CPU 1" }),
    ];
    const dashboard = buildDashboard({}, items, []);
    expect(dashboard.sections[0]!.charts.map((c) => c.title)).toEqual(["CPU 1", "CPU 2"]);
  });

  it("exposes MAX_CHARTS_PER_SECTION as 8 for the UI's collapse threshold", () => {
    expect(MAX_CHARTS_PER_SECTION).toBe(8);
  });
});
