import { describe, expect, it } from "vitest";
import {
  groupItemsByComponent,
  isNumericItem,
  isTextItem,
  NO_COMPONENT_SECTION,
  resolveItemName,
  stripUnresolvedMacros,
} from "../latest-items";
import type { ZabbixItem } from "@auzui/zabbix-client";

function mkItem(overrides: Partial<ZabbixItem> = {}): ZabbixItem {
  return {
    itemid: "1",
    hostid: "10",
    name: "Item",
    key_: "some.key",
    value_type: "0",
    units: "",
    ...overrides,
  };
}

describe("isNumericItem / isTextItem", () => {
  it("classifies float (0) and uint (3) as numeric", () => {
    expect(isNumericItem(mkItem({ value_type: "0" }))).toBe(true);
    expect(isNumericItem(mkItem({ value_type: "3" }))).toBe(true);
    expect(isNumericItem(mkItem({ value_type: "1" }))).toBe(false);
  });

  it("classifies char (1), log (2) and text (4) as text", () => {
    expect(isTextItem(mkItem({ value_type: "1" }))).toBe(true);
    expect(isTextItem(mkItem({ value_type: "2" }))).toBe(true);
    expect(isTextItem(mkItem({ value_type: "4" }))).toBe(true);
    expect(isTextItem(mkItem({ value_type: "0" }))).toBe(false);
  });
});

describe("groupItemsByComponent", () => {
  it("groups by the component tag", () => {
    const items = [
      mkItem({ itemid: "1", tags: [{ tag: "component", value: "cpu" }] }),
      mkItem({ itemid: "2", tags: [{ tag: "component", value: "memory" }] }),
      mkItem({ itemid: "3", tags: [{ tag: "component", value: "cpu" }] }),
    ];
    const sections = groupItemsByComponent(items);
    expect(sections.map((s) => s.component)).toEqual(["cpu", "memory"]);
    expect(sections[0]!.items.map((i) => i.itemid)).toEqual(["1", "3"]);
  });

  it("puts items without a component tag into 'Sonstige', sorted last", () => {
    const items = [
      mkItem({ itemid: "1", tags: [{ tag: "component", value: "network" }] }),
      mkItem({ itemid: "2", tags: [] }),
      mkItem({ itemid: "3" }),
    ];
    const sections = groupItemsByComponent(items);
    expect(sections.map((s) => s.component)).toEqual(["network", NO_COMPONENT_SECTION]);
    expect(sections[1]!.items.map((i) => i.itemid)).toEqual(["2", "3"]);
  });

  it("returns an empty array for no items", () => {
    expect(groupItemsByComponent([])).toEqual([]);
  });
});

describe("stripUnresolvedMacros", () => {
  it("removes an LLD macro and fixes the space before the colon", () => {
    expect(stripUnresolvedMacros("Interface {#IFNAME}: Bits received")).toBe(
      "Interface: Bits received",
    );
  });

  it("removes a leading host macro and trims", () => {
    expect(stripUnresolvedMacros("{HOST.NAME} CPU utilization")).toBe("CPU utilization");
  });

  it("removes a user macro inside brackets and tidies punctuation", () => {
    expect(stripUnresolvedMacros("Disk [{$PATH}] usage")).toBe("Disk [] usage");
  });

  it("leaves a name without macros untouched", () => {
    expect(stripUnresolvedMacros("Load average (1m)")).toBe("Load average (1m)");
  });
});

describe("resolveItemName", () => {
  it("prefers Zabbix 7.x name_resolved when present", () => {
    expect(
      resolveItemName(mkItem({ name: "Interface {#IFNAME}: Bits", name_resolved: "Interface eth0: Bits" })),
    ).toBe("Interface eth0: Bits");
  });

  it("falls back to macro-stripped name when name_resolved is absent", () => {
    expect(resolveItemName(mkItem({ name: "Interface {#IFNAME}: Bits" }))).toBe("Interface: Bits");
  });

  it("falls back to macro-stripped name when name_resolved is blank", () => {
    expect(resolveItemName(mkItem({ name: "{HOST.NAME} uptime", name_resolved: "   " }))).toBe("uptime");
  });
});
