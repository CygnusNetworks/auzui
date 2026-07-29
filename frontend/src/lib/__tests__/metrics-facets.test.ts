import { describe, expect, it } from "vitest";
import type { ZabbixItem } from "@auzui/zabbix-client";
import {
  deriveComponentFacet,
  deriveUnitFacet,
  filterItemsByFacets,
  parseItemIds,
  shouldSearchItems,
} from "../metrics-facets";

function mkItem(overrides: Partial<ZabbixItem> = {}): ZabbixItem {
  return {
    itemid: "1",
    hostid: "1",
    name: "item",
    key_: "key",
    value_type: "0",
    units: "",
    ...overrides,
  };
}

describe("deriveComponentFacet", () => {
  it("counts component-tag values, sorted by frequency then alphabetically", () => {
    const items = [
      mkItem({ itemid: "1", tags: [{ tag: "component", value: "temperature" }] }),
      mkItem({ itemid: "2", tags: [{ tag: "component", value: "network" }] }),
      mkItem({ itemid: "3", tags: [{ tag: "component", value: "network" }] }),
      mkItem({ itemid: "4" }),
    ];
    expect(deriveComponentFacet(items)).toEqual([
      { value: "network", count: 2 },
      { value: "temperature", count: 1 },
    ]);
  });
});

describe("deriveUnitFacet", () => {
  it("counts non-empty units", () => {
    const items = [mkItem({ units: "°C" }), mkItem({ units: "°C" }), mkItem({ units: "" })];
    expect(deriveUnitFacet(items)).toEqual([{ value: "°C", count: 2 }]);
  });
});

describe("filterItemsByFacets", () => {
  const items = [
    mkItem({ itemid: "1", units: "°C", tags: [{ tag: "component", value: "temperature" }] }),
    mkItem({ itemid: "2", units: "%", tags: [{ tag: "component", value: "cpu" }] }),
  ];

  it("filters by component and unit independently and combined", () => {
    expect(filterItemsByFacets(items, { component: "cpu" }).map((i) => i.itemid)).toEqual(["2"]);
    expect(filterItemsByFacets(items, { unit: "°C" }).map((i) => i.itemid)).toEqual(["1"]);
    expect(filterItemsByFacets(items, { component: "cpu", unit: "°C" })).toEqual([]);
  });

  it("returns everything with no facets selected", () => {
    expect(filterItemsByFacets(items, {})).toHaveLength(2);
  });
});

describe("shouldSearchItems", () => {
  it("requires 2+ chars unless a host or group is selected", () => {
    expect(shouldSearchItems("a", undefined, undefined)).toBe(false);
    expect(shouldSearchItems("ab", undefined, undefined)).toBe(true);
    expect(shouldSearchItems("", "host1", undefined)).toBe(true);
    expect(shouldSearchItems("", undefined, "group1")).toBe(true);
  });
});

describe("parseItemIds", () => {
  it("dedupes and trims, ignoring empty entries", () => {
    expect(parseItemIds("1, 2,1,,3")).toEqual(["1", "2", "3"]);
    expect(parseItemIds(undefined)).toEqual([]);
    expect(parseItemIds("")).toEqual([]);
  });
});
