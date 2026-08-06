import { describe, expect, it } from "vitest";
import type { ZabbixItem, ZabbixItemPrototype } from "@auzui/zabbix-client";
import { buildTemplateItemIds } from "../template-items";

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

function mkTemplateItem(overrides: Partial<Pick<ZabbixItem, "hostid" | "key_">> = {}): Pick<ZabbixItem, "hostid" | "key_"> {
  return { hostid: "100", key_: "some.key", ...overrides };
}

function mkPrototype(
  overrides: Partial<Pick<ZabbixItemPrototype, "hostid" | "key_">> = {},
): Pick<ZabbixItemPrototype, "hostid" | "key_"> {
  return { hostid: "100", key_: "net.if.type[ifType.{#SNMPINDEX}]", ...overrides };
}

describe("buildTemplateItemIds", () => {
  it("maps an inherited item to its template via key_", () => {
    const items = [mkItem({ itemid: "1", key_: "some.key" })];
    const templateItems = [mkTemplateItem({ hostid: "100", key_: "some.key" })];
    const map = buildTemplateItemIds(items, templateItems, []);
    expect(map.get("100")).toEqual(new Set(["1"]));
  });

  it("maps an LLD-discovered item to its template via itemDiscovery.key_ against the item prototype", () => {
    const items = [
      mkItem({
        itemid: "2",
        key_: "net.if.type[ifType.12]",
        itemDiscovery: { parent_itemid: "999", key_: "net.if.type[ifType.{#SNMPINDEX}]" },
      }),
    ];
    const templatePrototypes = [mkPrototype({ hostid: "100", key_: "net.if.type[ifType.{#SNMPINDEX}]" })];
    const map = buildTemplateItemIds(items, [], templatePrototypes);
    expect(map.get("100")).toEqual(new Set(["2"]));
  });

  it("leaves a host-local item with no matching key_ or prototype out of every set", () => {
    const items = [mkItem({ itemid: "3", key_: "host.local.metric" })];
    const templateItems = [mkTemplateItem({ hostid: "100", key_: "some.key" })];
    const templatePrototypes = [mkPrototype({ hostid: "100", key_: "net.if.type[ifType.{#SNMPINDEX}]" })];
    const map = buildTemplateItemIds(items, templateItems, templatePrototypes);
    expect(map.get("100")).toEqual(new Set());
  });

  it("gives a template with no matching items an empty (but present) set entry", () => {
    const templateItems = [mkTemplateItem({ hostid: "100", key_: "some.key" })];
    const map = buildTemplateItemIds([], templateItems, []);
    expect(map.has("100")).toBe(true);
    expect(map.get("100")).toEqual(new Set());
  });

  it("handles multiple templates at once, keeping items and prototypes separated per template", () => {
    const items = [
      mkItem({ itemid: "1", key_: "some.key" }),
      mkItem({
        itemid: "2",
        key_: "net.if.type[ifType.12]",
        itemDiscovery: { parent_itemid: "999", key_: "net.if.type[ifType.{#SNMPINDEX}]" },
      }),
      mkItem({ itemid: "3", key_: "other.key" }),
    ];
    const templateItems = [mkTemplateItem({ hostid: "100", key_: "some.key" }), mkTemplateItem({ hostid: "200", key_: "other.key" })];
    const templatePrototypes = [mkPrototype({ hostid: "100", key_: "net.if.type[ifType.{#SNMPINDEX}]" })];

    const map = buildTemplateItemIds(items, templateItems, templatePrototypes);
    expect(map.get("100")).toEqual(new Set(["1", "2"]));
    expect(map.get("200")).toEqual(new Set(["3"]));
  });
});
