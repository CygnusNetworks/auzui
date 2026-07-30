import { describe, expect, it } from "vitest";
import type { ZabbixItem } from "@auzui/zabbix-client";
import { buildMetricMatrix, columnItemIds, rowItemIds, MAX_MATRIX_COLUMNS } from "../matrix";

function mkItem(overrides: Partial<ZabbixItem> & { itemid: string }): ZabbixItem {
  return {
    hostid: "1",
    name: "CPU load",
    key_: "system.cpu.load",
    value_type: "0",
    units: "",
    ...overrides,
  };
}

function hostItem(itemid: string, hostid: string, hostName: string, name: string, key_: string): ZabbixItem {
  return mkItem({ itemid, hostid, name, key_, hosts: [{ hostid, host: hostName, name: hostName }] });
}

describe("buildMetricMatrix", () => {
  it("dedupes metrics by key_+name across hosts and fills cells per host", () => {
    const items = [
      hostItem("1", "10", "web1", "CPU load", "system.cpu.load"),
      hostItem("2", "11", "web2", "CPU load", "system.cpu.load"),
      hostItem("3", "10", "web1", "Memory used", "vm.memory"),
    ];
    const m = buildMetricMatrix(items);
    expect(m.columns.map((c) => c.name)).toEqual(["web1", "web2"]);
    expect(m.rows.map((r) => r.name)).toEqual(["CPU load", "Memory used"]);

    const cpu = m.rows.find((r) => r.name === "CPU load")!;
    expect(cpu.cells.map((c) => c.itemid)).toEqual(["1", "2"]);

    // Memory exists only on web1 → web2 cell is absent (null → dashed/disabled).
    const mem = m.rows.find((r) => r.name === "Memory used")!;
    expect(mem.cells.map((c) => c.itemid)).toEqual(["3", null]);
  });

  it("caps auto-derived columns at MAX_MATRIX_COLUMNS and flags truncation", () => {
    const items = Array.from({ length: MAX_MATRIX_COLUMNS + 3 }, (_, i) =>
      hostItem(`i${i}`, `h${i}`, `host${i}`, "CPU load", "system.cpu.load"),
    );
    const m = buildMetricMatrix(items);
    expect(m.columns).toHaveLength(MAX_MATRIX_COLUMNS);
    expect(m.columnsTruncated).toBe(true);
  });

  it("honors pinned host order and drops pinned hosts without hits", () => {
    const items = [
      hostItem("1", "10", "web1", "CPU load", "system.cpu.load"),
      hostItem("2", "11", "web2", "CPU load", "system.cpu.load"),
    ];
    const m = buildMetricMatrix(items, ["11", "10", "99"]);
    expect(m.columns.map((c) => c.hostid)).toEqual(["11", "10"]);
    const cpu = m.rows[0]!;
    // cells follow the pinned column order (web2 first).
    expect(cpu.cells.map((c) => c.itemid)).toEqual(["2", "1"]);
  });
});

describe("rowItemIds / columnItemIds", () => {
  const items = [
    hostItem("1", "10", "web1", "CPU load", "system.cpu.load"),
    hostItem("2", "11", "web2", "CPU load", "system.cpu.load"),
    hostItem("3", "10", "web1", "Memory used", "vm.memory"),
  ];
  const m = buildMetricMatrix(items);

  it("rowItemIds skips absent cells", () => {
    const mem = m.rows.find((r) => r.name === "Memory used")!;
    expect(rowItemIds(mem)).toEqual(["3"]);
  });

  it("columnItemIds collects present cells of a column", () => {
    expect(columnItemIds(m, 0).sort()).toEqual(["1", "3"]);
    expect(columnItemIds(m, 1)).toEqual(["2"]);
  });
});
