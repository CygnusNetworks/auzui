import { describe, expect, it } from "vitest";
import type { ZabbixHost, ZabbixItem } from "@auzui/zabbix-client";
import { buildSections, linuxTemplate, resolveTemplate, switchTemplate, windowsTemplate } from "../display-templates";

function mkItem(overrides: Partial<ZabbixItem> = {}): ZabbixItem {
  return {
    itemid: overrides.itemid ?? "1",
    hostid: "10",
    name: overrides.name ?? overrides.key_ ?? "Item",
    key_: "some.key",
    value_type: "0",
    units: "",
    ...overrides,
  };
}

describe("resolveTemplate", () => {
  it("picks the Linux template from the host's parent template names", () => {
    const host: Pick<ZabbixHost, "parentTemplates"> = {
      parentTemplates: [{ templateid: "1", name: "Cygnus Linux by Zabbix agent" }],
    };
    expect(resolveTemplate(host, [])?.id).toBe("linux");
  });

  it("picks the Windows template from the host's parent template names", () => {
    const host: Pick<ZabbixHost, "parentTemplates"> = {
      parentTemplates: [{ templateid: "1", name: "Windows by Zabbix agent" }],
    };
    expect(resolveTemplate(host, [])?.id).toBe("windows");
  });

  it("picks the switch template for an SNMP host template name", () => {
    const host: Pick<ZabbixHost, "parentTemplates"> = {
      parentTemplates: [{ templateid: "1", name: "Brocade/Foundry Stackable by SNMP" }],
    };
    expect(resolveTemplate(host, [])?.id).toBe("switch");
  });

  it("falls back to keyPatterns hit-rate when the host has no matching parent template", () => {
    const items = [
      mkItem({ itemid: "1", key_: "vm.memory.size[total]" }),
      mkItem({ itemid: "2", key_: "system.cpu.load[percpu,avg1]" }),
      mkItem({ itemid: "3", key_: "vfs.fs.size[/,free]" }),
    ];
    expect(resolveTemplate(undefined, items)?.id).toBe("linux");
  });

  it("returns undefined when nothing clears the fallback threshold", () => {
    const items = [mkItem({ itemid: "1", key_: "custom.app.metric" })];
    expect(resolveTemplate(undefined, items)).toBeUndefined();
  });

  it("returns undefined for an empty item list and no parent templates", () => {
    expect(resolveTemplate(undefined, [])).toBeUndefined();
  });
});

describe("buildSections — bundles", () => {
  it("consolidates system.cpu.load avg1/5/15 into one Load bundle section", () => {
    const items = [
      mkItem({ itemid: "1", key_: "system.cpu.load[percpu,avg1]" }),
      mkItem({ itemid: "2", key_: "system.cpu.load[percpu,avg5]" }),
      mkItem({ itemid: "3", key_: "system.cpu.load[percpu,avg15]" }),
    ];
    const sections = buildSections(linuxTemplate, items);
    const load = sections.find((s) => s.id === "bundle:load");
    expect(load).toBeDefined();
    expect(load!.items.map((i) => i.seriesLabel)).toEqual(["1m", "5m", "15m"]);
    expect(load!.navGroup).toBe("System");
  });

  it("consolidates CPU-Times sub-metrics into one bundle section", () => {
    const items = [
      mkItem({ itemid: "1", key_: "system.cpu.util[,user]" }),
      mkItem({ itemid: "2", key_: "system.cpu.util[,system]" }),
      mkItem({ itemid: "3", key_: "system.cpu.util[,iowait]" }),
    ];
    const sections = buildSections(linuxTemplate, items);
    const cpu = sections.find((s) => s.id === "bundle:cpu-times");
    expect(cpu!.items.map((i) => i.seriesLabel)).toEqual(["User", "System", "IO Wait"]);
  });

  it("consolidates memory total/available/used into one bundle section", () => {
    const items = [
      mkItem({ itemid: "1", key_: "vm.memory.size[total]" }),
      mkItem({ itemid: "2", key_: "vm.memory.size[available]" }),
      mkItem({ itemid: "3", key_: "vm.memory.size[used]" }),
    ];
    const sections = buildSections(linuxTemplate, items);
    const memory = sections.find((s) => s.id === "bundle:memory");
    expect(memory!.items.map((i) => i.seriesLabel)).toEqual(["Total", "Available", "Used"]);
  });

  it("consolidates ICMP v4+v6 checks into one bundle section", () => {
    const items = [
      mkItem({ itemid: "1", key_: "icmpping" }),
      mkItem({ itemid: "2", key_: "icmppingsec" }),
      mkItem({ itemid: "3", key_: "icmppingloss" }),
      mkItem({ itemid: "4", key_: "icmpping6" }),
    ];
    const sections = buildSections(linuxTemplate, items);
    const icmp = sections.find((s) => s.id === "bundle:icmp");
    expect(icmp!.items).toHaveLength(4);
  });

  it("assigns line/stat/status display roles to the ICMP bundle items", () => {
    const items = [
      mkItem({ itemid: "1", key_: "icmppingsec" }),
      mkItem({ itemid: "2", key_: "icmppingloss" }),
      mkItem({ itemid: "3", key_: "icmpping" }),
    ];
    const icmp = buildSections(linuxTemplate, items).find((s) => s.id === "bundle:icmp")!;
    const roleByKey = new Map(icmp.items.map((si) => [si.item.key_, si.displayRole]));
    expect(roleByKey.get("icmppingsec")).toBe("line");
    expect(roleByKey.get("icmppingloss")).toBe("stat");
    expect(roleByKey.get("icmpping")).toBe("status");
  });

  it("keeps a constant-0 ICMP packet-loss item bound to the ICMP bundle (never a free/fact item)", () => {
    // Regression: a packet-loss series that is a flat 0 must stay in the
    // bundle — buildSections matches it regardless of its (constant) value, so
    // it is one of the template-claimed items the facts view must exclude.
    const loss = mkItem({
      itemid: "1",
      key_: "icmppingloss",
      lastvalue: "0",
      prevvalue: "0",
    });
    const sections = buildSections(linuxTemplate, [loss]);
    const icmp = sections.find((s) => s.id === "bundle:icmp");
    expect(icmp).toBeDefined();
    expect(icmp!.items.map((si) => si.item.itemid)).toContain("1");
    // and it must NOT have leaked into a leftover component section
    expect(sections.some((s) => s.kind === "component")).toBe(false);
  });
});

describe("buildSections — family display roles", () => {
  it("marks an interface oper-status series as a status badge, in/out as lines", () => {
    const items = [
      mkItem({ itemid: "1", key_: "net.if.in[eth0]" }),
      mkItem({ itemid: "2", key_: "net.if.status[eth0]" }),
    ];
    const eth0 = buildSections(linuxTemplate, items).find((s) => s.id === "family:net-if:eth0")!;
    const roleByKey = new Map(eth0.items.map((si) => [si.item.key_, si.displayRole]));
    expect(roleByKey.get("net.if.in[eth0]")).toBe("line");
    expect(roleByKey.get("net.if.status[eth0]")).toBe("status");
  });
});

describe("buildSections — net.if instance extraction (quoted keys + mode suffixes)", () => {
  it("groups in/out/dropped/errors of a quoted interface into ONE family, stripping quotes", () => {
    // The real Zabbix agent keys from the screenshot: the interface name is a
    // quoted first parameter, dropped/errors are mode parameters after it.
    const items = [
      mkItem({ itemid: "1", key_: 'net.if.in["eth0"]' }),
      mkItem({ itemid: "2", key_: 'net.if.out["eth0"]' }),
      mkItem({ itemid: "3", key_: 'net.if.in["eth0",dropped]' }),
      mkItem({ itemid: "4", key_: 'net.if.out["eth0",dropped]' }),
      mkItem({ itemid: "5", key_: 'net.if.in["eth0",errors]' }),
      mkItem({ itemid: "6", key_: 'net.if.out["eth0",errors]' }),
    ];
    const sections = buildSections(linuxTemplate, items);
    const eth0 = sections.filter((s) => s.id.startsWith("family:net-if:"));
    expect(eth0).toHaveLength(1);
    expect(eth0[0]!.id).toBe("family:net-if:eth0");
    expect(eth0[0]!.label).toBe("Interface eth0");
    expect(eth0[0]!.items).toHaveLength(6);
    expect(sections.some((s) => s.kind === "component")).toBe(false);
  });

  it("assigns roles/labels and renders dropped/errors as stat tiles", () => {
    const items = [
      mkItem({ itemid: "1", key_: 'net.if.in["eth0"]' }),
      mkItem({ itemid: "2", key_: 'net.if.in["eth0",dropped]' }),
      mkItem({ itemid: "3", key_: 'net.if.out["eth0",errors]' }),
    ];
    const eth0 = buildSections(linuxTemplate, items).find((s) => s.id === "family:net-if:eth0")!;
    const byKey = new Map(eth0.items.map((si) => [si.item.key_, si]));
    expect(byKey.get('net.if.in["eth0"]')!.seriesRole).toBe("in");
    expect(byKey.get('net.if.in["eth0"]')!.displayRole).toBe("line");
    expect(byKey.get('net.if.in["eth0",dropped]')!.seriesRole).toBe("dropped");
    expect(byKey.get('net.if.in["eth0",dropped]')!.displayRole).toBe("stat");
    expect(byKey.get('net.if.in["eth0",dropped]')!.seriesLabel).toBe("Dropped in");
    expect(byKey.get('net.if.out["eth0",errors]')!.seriesRole).toBe("errors");
    expect(byKey.get('net.if.out["eth0",errors]')!.displayRole).toBe("stat");
    expect(byKey.get('net.if.out["eth0",errors]')!.seriesLabel).toBe("Errors out");
  });

  it("still handles unquoted interface names and status", () => {
    const items = [
      mkItem({ itemid: "1", key_: "net.if.in[eth0]" }),
      mkItem({ itemid: "2", key_: "net.if.status[eth0]" }),
    ];
    const eth0 = buildSections(linuxTemplate, items).find((s) => s.id === "family:net-if:eth0")!;
    expect(eth0.items).toHaveLength(2);
    const status = eth0.items.find((si) => si.item.key_ === "net.if.status[eth0]")!;
    expect(status.displayRole).toBe("status");
  });
});

describe("buildSections — families", () => {
  it("groups net.if.* items by interface instance into their own sections", () => {
    const items = [
      mkItem({ itemid: "1", key_: "net.if.in[eth0]" }),
      mkItem({ itemid: "2", key_: "net.if.out[eth0]" }),
      mkItem({ itemid: "3", key_: "net.if.in[wg-zabbix]" }),
      mkItem({ itemid: "4", key_: "net.if.out[wg-zabbix]" }),
    ];
    const sections = buildSections(linuxTemplate, items);
    const eth0 = sections.find((s) => s.id === "family:net-if:eth0");
    const wg = sections.find((s) => s.id === "family:net-if:wg-zabbix");
    expect(eth0).toBeDefined();
    expect(eth0!.label).toBe("Interface eth0");
    expect(eth0!.navGroup).toBe("Netzwerk");
    expect(eth0!.items.map((i) => i.seriesRole)).toEqual(["in", "out"]);
    expect(wg!.label).toBe("Interface wg-zabbix");
  });

  it("groups vfs.fs.* items by mountpoint instance into their own sections", () => {
    const items = [
      mkItem({ itemid: "1", key_: "vfs.fs.size[/,free]" }),
      mkItem({ itemid: "2", key_: "vfs.fs.size[/,used]" }),
      mkItem({ itemid: "3", key_: "vfs.fs.size[/var,free]" }),
    ];
    const sections = buildSections(linuxTemplate, items);
    const root = sections.find((s) => s.id === "family:vfs-fs:/");
    const varFs = sections.find((s) => s.id === "family:vfs-fs:/var");
    expect(root!.items.map((i) => i.seriesLabel)).toEqual(["Free", "Used"]);
    expect(varFs!.items.map((i) => i.seriesLabel)).toEqual(["Free"]);
  });

  it("groups switch SNMP interfaces analogous to the agent family", () => {
    const items = [
      mkItem({ itemid: "1", key_: "net.if.in[ifHCInOctets,10101]" }),
      mkItem({ itemid: "2", key_: "net.if.out[ifHCOutOctets,10101]" }),
    ];
    const sections = buildSections(switchTemplate, items);
    const iface = sections.find((s) => s.id === "family:net-if:10101");
    expect(iface!.items.map((i) => i.seriesRole)).toEqual(["in", "out"]);
  });

  it("windows template shares the same net.if/vfs.fs family key shapes", () => {
    const items = [mkItem({ itemid: "1", key_: "net.if.in[Ethernet0]" })];
    const sections = buildSections(windowsTemplate, items);
    expect(sections.find((s) => s.id === "family:net-if:Ethernet0")).toBeDefined();
  });
});

describe("buildSections — leftover items", () => {
  it("falls through unmatched items to component-tag sections", () => {
    const items = [
      mkItem({ itemid: "1", key_: "agent.version", tags: [{ tag: "component", value: "agent" }] }),
      mkItem({ itemid: "2", key_: "system.hw.cpu.num" }),
    ];
    const sections = buildSections(linuxTemplate, items);
    const agent = sections.find((s) => s.id === "component:agent");
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe("component");
  });

  it("returns only component sections when no template is resolved", () => {
    const items = [mkItem({ itemid: "1", key_: "custom.metric" })];
    const sections = buildSections(undefined, items);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.kind).toBe("component");
  });

  it("returns an empty array for no items and no template", () => {
    expect(buildSections(undefined, [])).toEqual([]);
  });
});
