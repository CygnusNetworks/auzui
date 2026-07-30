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

  it("treats an empty-string prevvalue (Zabbix's 'only one value' marker) as constant", () => {
    // Screenshot case: vfs.file.contents[...] returns a text value 65534 that
    // has only ever been recorded once, so Zabbix reports prevvalue as "".
    // "" !== "65534" must NOT classify it as variable.
    const item = mkItem({
      value_type: "4",
      key_: 'vfs.file.contents["/sys/class/net/wg0/type"]',
      lastvalue: "65534",
      prevvalue: "",
    });
    expect(classifyConstancy(item)).toEqual({ kind: "constant" });
  });

  it("treats a stale text item (last change older than half the range) as constant via the age heuristic", () => {
    // Value differs from prevvalue but the last value arrived 21h ago, well
    // before a 1h window — constant within everything the user is viewing.
    const now = 1_000_000;
    const item = mkItem({
      value_type: "4",
      lastvalue: "65534",
      prevvalue: "0",
      lastclock: String(now - 21 * 3600),
    });
    expect(classifyConstancy(item, undefined, { now, rangeSeconds: 3600 })).toEqual({ kind: "constant" });
  });

  it("keeps a recently-changed text item variable when its change falls inside the range", () => {
    const now = 1_000_000;
    const item = mkItem({
      value_type: "4",
      lastvalue: "up",
      prevvalue: "down",
      lastclock: String(now - 600), // 10 min ago, inside a 1h window
    });
    expect(classifyConstancy(item, undefined, { now, rangeSeconds: 3600 })).toEqual({ kind: "variable" });
  });

  it("does not apply the age heuristic to numeric items (they use their series)", () => {
    const now = 1_000_000;
    const item = mkItem({
      value_type: "3",
      lastvalue: "5",
      prevvalue: "4",
      lastclock: String(now - 21 * 3600),
    });
    expect(classifyConstancy(item, undefined, { now, rangeSeconds: 3600 })).toEqual({ kind: "variable" });
  });
});
