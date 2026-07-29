import { describe, expect, it } from "vitest";
import {
  groupItemsByComponent,
  isNumericItem,
  isTextItem,
  NO_COMPONENT_SECTION,
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
