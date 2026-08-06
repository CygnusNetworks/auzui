import { describe, expect, it } from "vitest";
import type { ZabbixItem } from "@auzui/zabbix-client";
import type { Dashboard, DashboardChart, DashboardSection } from "../../../lib/auto-dashboard";
import { filterDashboard } from "../dashboard-filter";

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

function mkChart(overrides: Partial<DashboardChart> = {}): DashboardChart {
  return {
    id: "chart-1",
    title: "Chart",
    viz: "line",
    items: [mkItem()],
    seriesLabels: ["Item"],
    thresholds: [],
    ...overrides,
  };
}

function mkSection(overrides: Partial<DashboardSection> = {}): DashboardSection {
  return {
    section: "cpu",
    charts: [mkChart()],
    ...overrides,
  };
}

function mkDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    sections: [mkSection()],
    textItems: [],
    generatedFromItemCount: 5,
    ...overrides,
  };
}

describe("filterDashboard", () => {
  it("returns the identical reference when text is empty and no template filter is set", () => {
    const dashboard = mkDashboard();
    expect(filterDashboard(dashboard, { text: "" })).toBe(dashboard);
    expect(filterDashboard(dashboard, { text: "   " })).toBe(dashboard);
  });

  it("matches on chart title (case-insensitive)", () => {
    const dashboard = mkDashboard({
      sections: [mkSection({ charts: [mkChart({ title: "CPU Utilization" })] })],
    });
    const filtered = filterDashboard(dashboard, { text: "utiliz" });
    expect(filtered.sections[0]!.charts).toHaveLength(1);

    const noMatch = filterDashboard(dashboard, { text: "memory" });
    expect(noMatch.sections).toHaveLength(0);
  });

  it("matches on a series label", () => {
    const dashboard = mkDashboard({
      sections: [
        mkSection({
          charts: [mkChart({ title: "Load", seriesLabels: ["avg1", "avg5"], items: [mkItem(), mkItem({ itemid: "2" })] })],
        }),
      ],
    });
    const filtered = filterDashboard(dashboard, { text: "avg5" });
    expect(filtered.sections[0]!.charts).toHaveLength(1);
  });

  it("matches on item name or key_", () => {
    const dashboard = mkDashboard({
      sections: [
        mkSection({
          charts: [mkChart({ title: "Chart", items: [mkItem({ name: "Free Memory", key_: "vm.memory.size[free]" })] })],
        }),
      ],
    });
    expect(filterDashboard(dashboard, { text: "free memory" }).sections[0]!.charts).toHaveLength(1);
    expect(filterDashboard(dashboard, { text: "vm.memory.size" }).sections[0]!.charts).toHaveLength(1);
    expect(filterDashboard(dashboard, { text: "nonexistent" }).sections).toHaveLength(0);
  });

  it("keeps all charts of a section when the section name matches", () => {
    const dashboard = mkDashboard({
      sections: [
        mkSection({
          section: "network",
          charts: [mkChart({ title: "eth0" }), mkChart({ id: "chart-2", title: "eth1" })],
        }),
      ],
    });
    const filtered = filterDashboard(dashboard, { text: "network" });
    expect(filtered.sections[0]!.charts).toHaveLength(2);
  });

  it("matches textItems by name or key_", () => {
    const dashboard = mkDashboard({
      sections: [],
      textItems: [
        mkItem({ itemid: "t1", name: "Agent Version", key_: "agent.version" }),
        mkItem({ itemid: "t2", name: "OS", key_: "system.os" }),
      ],
    });
    const filtered = filterDashboard(dashboard, { text: "agent" });
    expect(filtered.textItems.map((i) => i.itemid)).toEqual(["t1"]);
  });

  it("applies the template filter to charts and textItems", () => {
    const dashboard = mkDashboard({
      sections: [
        mkSection({
          charts: [
            mkChart({ id: "c1", items: [mkItem({ itemid: "i1" })] }),
            mkChart({ id: "c2", items: [mkItem({ itemid: "i2" })] }),
          ],
        }),
      ],
      textItems: [mkItem({ itemid: "t1" }), mkItem({ itemid: "t2" })],
    });
    const filtered = filterDashboard(dashboard, { text: "", templateItemIds: new Set(["i1", "t1"]) });
    expect(filtered.sections[0]!.charts.map((c) => c.id)).toEqual(["c1"]);
    expect(filtered.textItems.map((i) => i.itemid)).toEqual(["t1"]);
  });

  it("ANDs the text and template filters", () => {
    const dashboard = mkDashboard({
      sections: [
        mkSection({
          charts: [
            mkChart({ id: "c1", title: "CPU", items: [mkItem({ itemid: "i1" })] }),
            mkChart({ id: "c2", title: "CPU other", items: [mkItem({ itemid: "i2" })] }),
          ],
        }),
      ],
    });
    // Matches text on both, but template filter narrows to i1 only.
    const filtered = filterDashboard(dashboard, { text: "cpu", templateItemIds: new Set(["i1"]) });
    expect(filtered.sections[0]!.charts.map((c) => c.id)).toEqual(["c1"]);
  });

  it("drops sections with no remaining charts and returns an empty dashboard when nothing matches", () => {
    const dashboard = mkDashboard({
      sections: [mkSection({ charts: [mkChart({ title: "CPU" })] })],
      textItems: [mkItem({ name: "OS" })],
    });
    const filtered = filterDashboard(dashboard, { text: "nothing-matches-this" });
    expect(filtered.sections).toHaveLength(0);
    expect(filtered.textItems).toHaveLength(0);
    expect(filtered.generatedFromItemCount).toBe(dashboard.generatedFromItemCount);
  });
});
