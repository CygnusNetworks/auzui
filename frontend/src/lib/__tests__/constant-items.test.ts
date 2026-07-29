import { describe, expect, it } from "vitest";
import { classifyConstancy } from "../constant-items";
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

describe("classifyConstancy", () => {
  it("treats a text item with equal lastvalue/prevvalue as constant", () => {
    const item = mkItem({
      value_type: "4",
      lastvalue: "Zabbix agent 6.0",
      prevvalue: "Zabbix agent 6.0",
    });
    expect(classifyConstancy(item)).toEqual({ kind: "constant" });
  });

  it("treats a text item with no prevvalue (only ever one recorded value) as constant", () => {
    const item = mkItem({ value_type: "4", lastvalue: "8", prevvalue: undefined });
    expect(classifyConstancy(item)).toEqual({ kind: "constant" });
  });

  it("treats a text item with differing lastvalue/prevvalue as variable", () => {
    const item = mkItem({ value_type: "1", lastvalue: "up", prevvalue: "down" });
    expect(classifyConstancy(item)).toEqual({ kind: "variable" });
  });

  it("treats an item with no lastvalue at all as variable (nothing to show as a fact)", () => {
    const item = mkItem({ value_type: "4", lastvalue: undefined, prevvalue: undefined });
    expect(classifyConstancy(item)).toEqual({ kind: "variable" });
  });

  it("falls back to lastvalue/prevvalue for a numeric item when no series is given", () => {
    const item = mkItem({ value_type: "3", lastvalue: "4", prevvalue: "4" });
    expect(classifyConstancy(item)).toEqual({ kind: "constant" });
  });

  it("classifies a numeric series with no value change as constant", () => {
    const item = mkItem({ value_type: "0", lastvalue: "42", prevvalue: "1" });
    const series = [
      { t: 1, v: 42 },
      { t: 2, v: 42 },
      { t: 3, v: 42 },
    ];
    expect(classifyConstancy(item, series)).toEqual({ kind: "constant" });
  });

  it("classifies a numeric series with exactly one transition as changed-once, with the new value + timestamp", () => {
    const item = mkItem({ value_type: "0", lastvalue: "8", prevvalue: "4" });
    const series = [
      { t: 1, v: 4 },
      { t: 2, v: 4 },
      { t: 3, v: 8 },
      { t: 4, v: 8 },
    ];
    expect(classifyConstancy(item, series)).toEqual({ kind: "changed-once", newValue: "8", changedAt: 3 });
  });

  it("classifies a numeric series with multiple transitions as variable", () => {
    const item = mkItem({ value_type: "0" });
    const series = [
      { t: 1, v: 1 },
      { t: 2, v: 2 },
      { t: 3, v: 1 },
    ];
    expect(classifyConstancy(item, series)).toEqual({ kind: "variable" });
  });

  it("falls back to lastvalue/prevvalue for a numeric item given an empty series", () => {
    const item = mkItem({ value_type: "0", lastvalue: "1", prevvalue: "1" });
    expect(classifyConstancy(item, [])).toEqual({ kind: "constant" });
  });
});
