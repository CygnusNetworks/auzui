/**
 * Static demo data for the public demo build (VITE_DEMO=1). Pure data + pure
 * generator functions — no network access. Everything here is deterministic
 * (seeded PRNG) so the screenshot generator (e2e/screenshots.spec.ts) always
 * captures the same numbers.
 *
 * English sample data, deliberately generous in volume: ~40 hosts across six
 * groups, ~25 problems across every severity, per-host CPU/memory/disk/
 * network items with plausible multi-hour history so host-detail charts,
 * the Explorer heatmap, and the Topology graph all render densely populated
 * screens instead of empty states.
 */
import type {
  ZabbixHost,
  ZabbixHostGroup,
  ZabbixHttpStep,
  ZabbixHttpTest,
  ZabbixItem,
  ZabbixMaintenance,
  ZabbixProblem,
  ZabbixProxy,
  ZabbixTrigger,
} from "@auzui/zabbix-client";
import { webTestKey, webTestStepKey } from "../lib/web-scenarios";

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — same seed on every load/build.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0xa2233701);

function randRange(min: number, max: number): number {
  return min + rng() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(randRange(min, max + 1));
}

function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)]!;
}

/** Fixed "now" so every generated build/screenshot run shows the same relative times. */
export const DEMO_NOW = Math.floor(new Date("2026-07-30T14:00:00Z").getTime() / 1000);

function hoursAgo(h: number): number {
  return DEMO_NOW - h * 3600;
}

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

let nextItemId = 40000;
function itemId(): string {
  return String(nextItemId++);
}
let nextTriggerId = 60000;
function triggerId(): string {
  return String(nextTriggerId++);
}

// ---------------------------------------------------------------------------
// Host groups
// ---------------------------------------------------------------------------

export const demoHostGroups: ZabbixHostGroup[] = [
  { groupid: "20001", name: "Web Servers" },
  { groupid: "20002", name: "Database Servers" },
  { groupid: "20003", name: "Application Servers" },
  { groupid: "20004", name: "Storage" },
  { groupid: "20005", name: "Monitoring & Infra" },
  { groupid: "20006", name: "Network Devices" },
];

interface GroupPlan {
  groupid: string;
  namePrefix: string;
  count: number;
  subnet: string;
  kind: "linux" | "switch";
  template: string;
}

const GROUP_PLAN: GroupPlan[] = [
  { groupid: "20001", namePrefix: "web", count: 10, subnet: "10.10.1", kind: "linux", template: "Linux by Zabbix agent" },
  { groupid: "20002", namePrefix: "db", count: 6, subnet: "10.10.2", kind: "linux", template: "Linux by Zabbix agent" },
  { groupid: "20003", namePrefix: "app", count: 6, subnet: "10.10.5", kind: "linux", template: "Linux by Zabbix agent" },
  { groupid: "20004", namePrefix: "nas", count: 4, subnet: "10.10.3", kind: "linux", template: "Linux by Zabbix agent" },
  { groupid: "20005", namePrefix: "mon", count: 6, subnet: "10.10.4", kind: "linux", template: "Linux by Zabbix agent" },
  { groupid: "20006", namePrefix: "sw", count: 8, subnet: "10.10.0", kind: "switch", template: "Generic SNMP Switch" },
];

// ---------------------------------------------------------------------------
// Item value registry — used by history.get/trend.get to synthesize plausible
// time series for any itemid handed out below.
// ---------------------------------------------------------------------------

export type SeriesKind =
  | "cpu"
  | "load"
  | "memory-pct"
  | "disk-pct"
  | "net-bps"
  | "icmp-rtt"
  | "icmp-loss"
  | "counter"
  | "status"
  | "web-response-time"
  | "web-fail";

interface SeriesSpec {
  kind: SeriesKind;
  base: number;
  amplitude: number;
  unit: string;
  valueType: ZabbixItem["value_type"];
}

export const seriesRegistry = new Map<string, SeriesSpec>();

function registerSeries(id: string, spec: SeriesSpec): void {
  seriesRegistry.set(id, spec);
}

/** Deterministic pseudo-random offset per item, so every item's wave looks a little different. */
function itemSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}

function waveValue(spec: SeriesSpec, seed: number, tSeconds: number): number {
  const period = spec.kind === "net-bps" ? 900 : 3600 * 6;
  const phase = (seed % 1000) / 1000;
  const local = mulberry32(seed ^ Math.floor(tSeconds / 300));
  const noise = (local() - 0.5) * spec.amplitude * 0.35;
  const wave = Math.sin((tSeconds / period + phase) * Math.PI * 2) * spec.amplitude;
  let v = spec.base + wave + noise;
  if (spec.kind === "disk-pct") {
    // Slow upward drift instead of oscillation — disks fill, they don't breathe.
    const daysSinceEpoch = tSeconds / 86400;
    v = spec.base + (daysSinceEpoch % 30) * 0.4 + noise * 0.3;
  }
  if (spec.kind === "net-bps") v = Math.max(0, v);
  if (spec.kind === "counter" || spec.kind === "status") v = Math.max(0, Math.round(v));
  if (spec.kind === "web-response-time") v = Math.max(0.005, v);
  if (spec.kind === "web-fail") v = Math.max(0, Math.round(v));
  if (spec.kind === "cpu" || spec.kind === "memory-pct" || spec.kind === "disk-pct") {
    v = Math.min(99.5, Math.max(0.2, v));
  }
  return v;
}

/** Generates `points` (clock, value) samples for one item between from/till (unix seconds). */
export function generateHistory(
  itemid: string,
  from: number,
  till: number,
  points = 120,
): { clock: number; value: number }[] {
  const spec = seriesRegistry.get(itemid);
  if (!spec) return [];
  const seed = itemSeed(itemid);
  const step = Math.max(1, Math.floor((till - from) / points));
  const out: { clock: number; value: number }[] = [];
  for (let t = from; t <= till; t += step) {
    out.push({ clock: t, value: waveValue(spec, seed, t) });
  }
  return out;
}

function lastValueFor(id: string): string {
  const spec = seriesRegistry.get(id);
  if (!spec) return "0";
  const v = waveValue(spec, itemSeed(id), DEMO_NOW);
  return spec.valueType === "3" ? String(Math.round(v)) : v.toFixed(2);
}

// ---------------------------------------------------------------------------
// Hosts + items
// ---------------------------------------------------------------------------

export const demoHosts: ZabbixHost[] = [];
export const demoItems: ZabbixItem[] = [];
/** hostid -> parentTemplates name, used by handlers to answer trigger.get expandExpression etc. */
export const demoHostTemplate = new Map<string, string>();

let hostCounter = 1;

function addLinuxHost(groupid: string, groupName: string, namePrefix: string, idx: number, subnet: string): ZabbixHost {
  const hostid = String(10000 + hostCounter++);
  const name = `${namePrefix}-${String(idx).padStart(2, "0")}`;
  const ip = `${subnet}.${10 + idx}`;
  const host: ZabbixHost = {
    hostid,
    host: name,
    name,
    status: "0",
    maintenance_status: "0",
    interfaces: [
      { interfaceid: `${hostid}1`, ip, dns: `${name}.demo.internal`, useip: "1", port: "10050", type: "1" },
    ],
    parentTemplates: [{ templateid: "10001", name: "Linux by Zabbix agent" }],
    hostgroups: [{ groupid, name: groupName }],
    inventory: { os: pick(["Ubuntu 22.04 LTS", "Debian 12", "Rocky Linux 9", "Ubuntu 24.04 LTS"]), location: pick(["DC1 / Rack A3", "DC1 / Rack B1", "DC2 / Rack C2"]) },
  };
  demoHosts.push(host);
  demoHostTemplate.set(hostid, "linux");

  const cpuBase = randRange(15, 55);
  const memBase = randRange(35, 75);
  const diskBase = randRange(20, 55);
  const netBase = randRange(5_000_000, 250_000_000);

  const items: [string, string, ZabbixItem["value_type"], string, SeriesKind, number, number][] = [
    ["system.cpu.util", "CPU utilization", "0", "%", "cpu", cpuBase, 18],
    ["system.cpu.util[,user]", "CPU user time", "0", "%", "cpu", cpuBase * 0.6, 10],
    ["system.cpu.util[,system]", "CPU system time", "0", "%", "cpu", cpuBase * 0.25, 6],
    ["system.cpu.util[,iowait]", "CPU iowait time", "0", "%", "cpu", cpuBase * 0.08, 3],
    ["system.cpu.util[,idle]", "CPU idle time", "0", "%", "cpu", 100 - cpuBase, 18],
    ["system.cpu.load[all,avg1]", "Load average (1m avg)", "0", "", "load", randRange(0.2, 2.5), 0.8],
    ["system.cpu.load[all,avg5]", "Load average (5m avg)", "0", "", "load", randRange(0.2, 2.2), 0.6],
    ["system.cpu.load[all,avg15]", "Load average (15m avg)", "0", "", "load", randRange(0.2, 2.0), 0.5],
    ["vm.memory.size[total]", "Total memory", "3", "B", "counter", 34_359_738_368, 0],
    ["vm.memory.size[available]", "Available memory", "3", "B", "counter", 34_359_738_368 * (1 - memBase / 100), 2_000_000_000],
    ["vm.memory.size[used]", "Used memory", "3", "B", "counter", 34_359_738_368 * (memBase / 100), 2_000_000_000],
    ["vfs.fs.size[/,total]", "Filesystem / total", "3", "B", "counter", 214_748_364_800, 0],
    ["vfs.fs.size[/,used]", "Filesystem / used", "3", "B", "counter", 214_748_364_800 * (diskBase / 100), 4_000_000_000],
    ["vfs.fs.size[/,free]", "Filesystem / free", "3", "B", "counter", 214_748_364_800 * (1 - diskBase / 100), 4_000_000_000],
    ["vfs.fs.size[/,pused]", "Filesystem / % used", "0", "%", "disk-pct", diskBase, 6],
    ["net.if.in[\"eth0\"]", "Interface eth0: Incoming traffic", "0", "bps", "net-bps", netBase, netBase * 0.6],
    ["net.if.out[\"eth0\"]", "Interface eth0: Outgoing traffic", "0", "bps", "net-bps", netBase * 0.4, netBase * 0.3],
    ["icmppingsec", "ICMP ping RTT", "0", "s", "icmp-rtt", randRange(0.001, 0.02), 0.005],
    ["icmppingloss", "ICMP ping loss", "0", "%", "icmp-loss", randRange(0, 0.5), 0.3],
    ["icmpping", "ICMP ping status", "3", "", "status", 1, 0],
  ];

  for (const [key, label, valueType, units, kind, base, amplitude] of items) {
    const id = itemId();
    registerSeries(id, { kind, base, amplitude, unit: units, valueType });
    demoItems.push({
      itemid: id,
      hostid,
      name: label,
      key_: key,
      value_type: valueType,
      units,
      lastvalue: lastValueFor(id),
      lastclock: String(DEMO_NOW - randInt(5, 90)),
      tags: [],
      status: "0",
      state: "0",
    });
  }
  return host;
}

function addSwitchHost(groupid: string, groupName: string, namePrefix: string, idx: number, subnet: string): ZabbixHost {
  const hostid = String(10000 + hostCounter++);
  const name = `${namePrefix}-${String(idx).padStart(2, "0")}`;
  const ip = `${subnet}.${idx}`;
  const host: ZabbixHost = {
    hostid,
    host: name,
    name,
    status: "0",
    maintenance_status: "0",
    interfaces: [{ interfaceid: `${hostid}1`, ip, dns: "", useip: "1", port: "161", type: "2" }],
    parentTemplates: [{ templateid: "10002", name: "Generic SNMP Switch" }],
    hostgroups: [{ groupid, name: groupName }],
    inventory: { os: "Cisco IOS", location: pick(["DC1 / Core", "DC1 / Access A", "DC2 / Access B"]) },
  };
  demoHosts.push(host);
  demoHostTemplate.set(hostid, "switch");

  const ports = idx <= 2 ? ["10101", "10102", "10103", "10104"] : ["10101", "10102"];
  for (const port of ports) {
    const inBase = randRange(1_000_000, 900_000_000);
    const specs: [string, string, ZabbixItem["value_type"], string, SeriesKind, number, number][] = [
      [`net.if.in[ifHCInOctets,${port}]`, `Port ${port}: Incoming traffic`, "3", "bps", "net-bps", inBase, inBase * 0.5],
      [`net.if.out[ifHCOutOctets,${port}]`, `Port ${port}: Outgoing traffic`, "3", "bps", "net-bps", inBase * 0.35, inBase * 0.2],
      [`net.if.in[ifInErrors,${port}]`, `Port ${port}: Errors in`, "3", "", "counter", 0, 0],
      [`net.if.out[ifOutErrors,${port}]`, `Port ${port}: Errors out`, "3", "", "counter", 0, 0],
      [`net.if.status[ifOperStatus,${port}]`, `Port ${port}: Status`, "3", "", "status", 1, 0],
    ];
    for (const [key, label, valueType, units, kind, base, amplitude] of specs) {
      const id = itemId();
      registerSeries(id, { kind, base, amplitude, unit: units, valueType });
      demoItems.push({
        itemid: id,
        hostid,
        name: label,
        key_: key,
        value_type: valueType,
        units,
        lastvalue: lastValueFor(id),
        lastclock: String(DEMO_NOW - randInt(5, 90)),
        tags: [],
        status: "0",
        state: "0",
      });
    }
  }
  const pingId = itemId();
  registerSeries(pingId, { kind: "icmp-rtt", base: randRange(0.001, 0.01), amplitude: 0.003, unit: "s", valueType: "0" });
  demoItems.push({
    itemid: pingId,
    hostid,
    name: "ICMP ping RTT",
    key_: "icmppingsec",
    value_type: "0",
    units: "s",
    lastvalue: lastValueFor(pingId),
    lastclock: String(DEMO_NOW - randInt(5, 90)),
    tags: [],
    status: "0",
    state: "0",
  });
  return host;
}

for (const plan of GROUP_PLAN) {
  const group = demoHostGroups.find((g) => g.groupid === plan.groupid)!;
  for (let i = 1; i <= plan.count; i++) {
    if (plan.kind === "linux") addLinuxHost(plan.groupid, group.name, plan.namePrefix, i, plan.subnet);
    else addSwitchHost(plan.groupid, group.name, plan.namePrefix, i, plan.subnet);
  }
}

// A couple of hosts run behind a monitoring proxy — used by the Topology page's proxy clustering.
export const demoProxies: ZabbixProxy[] = [{ proxyid: "50001", name: "proxy-dc2" }];
for (const host of demoHosts.filter((h) => h.hostgroups?.[0]?.groupid === "20004")) {
  host.proxyid = "50001";
}

/** One host explicitly put into maintenance (see demoMaintenances below). */
const hostInMaintenance = demoHosts.find((h) => h.host === "db-02")!;
hostInMaintenance.maintenance_status = "1";
hostInMaintenance.maintenanceid = "90001";

// ---------------------------------------------------------------------------
// Problems + triggers
// ---------------------------------------------------------------------------

interface ProblemSpec {
  name: string;
  severity: "0" | "1" | "2" | "3" | "4" | "5";
  hostname: string;
  ageHours: number;
  acknowledged: "0" | "1";
  opdata?: string;
}

const PROBLEM_SPECS: ProblemSpec[] = [
  { name: "High CPU utilization", severity: "5", hostname: "db-01", ageHours: 0.3, acknowledged: "0", opdata: "value=97.4%" },
  { name: "Disk space is critically low on /", severity: "5", hostname: "nas-02", ageHours: 1.2, acknowledged: "0", opdata: "value=97.8%" },
  { name: "No ping response", severity: "5", hostname: "sw-04", ageHours: 0.1, acknowledged: "0" },
  { name: "Zabbix agent is not available", severity: "4", hostname: "app-03", ageHours: 2.5, acknowledged: "0" },
  { name: "High memory utilization", severity: "4", hostname: "web-07", ageHours: 4.0, acknowledged: "1", opdata: "value=91.2%" },
  { name: "Disk read/write request responses are too high", severity: "4", hostname: "nas-01", ageHours: 6.5, acknowledged: "0" },
  { name: "Interface eth0: High bandwidth usage", severity: "4", hostname: "web-01", ageHours: 3.1, acknowledged: "0" },
  { name: "Too many processes running", severity: "4", hostname: "app-01", ageHours: 8.0, acknowledged: "1" },
  { name: "SSL certificate expires soon", severity: "3", hostname: "web-02", ageHours: 30.0, acknowledged: "0" },
  { name: "High CPU load", severity: "3", hostname: "app-05", ageHours: 5.4, acknowledged: "0" },
  { name: "Interface eth0: Link down", severity: "3", hostname: "sw-06", ageHours: 12.0, acknowledged: "1" },
  { name: "Database replication lag is high", severity: "3", hostname: "db-04", ageHours: 1.8, acknowledged: "0" },
  { name: "Filesystem /var space is low", severity: "3", hostname: "web-05", ageHours: 15.0, acknowledged: "0" },
  { name: "High swap usage", severity: "3", hostname: "app-02", ageHours: 9.0, acknowledged: "0" },
  { name: "Uncommitted transaction count is high", severity: "3", hostname: "db-03", ageHours: 2.2, acknowledged: "1" },
  { name: "Time is out of sync", severity: "2", hostname: "mon-02", ageHours: 20.0, acknowledged: "0" },
  { name: "Configuration cache utilization is high", severity: "2", hostname: "mon-01", ageHours: 44.0, acknowledged: "0" },
  { name: "High number of TCP retransmits", severity: "2", hostname: "web-04", ageHours: 3.6, acknowledged: "0" },
  { name: "High number of open files", severity: "2", hostname: "db-05", ageHours: 7.7, acknowledged: "1" },
  { name: "Interface eth0: Errors detected", severity: "2", hostname: "sw-02", ageHours: 26.0, acknowledged: "0" },
  { name: "License usage nearing limit", severity: "1", hostname: "mon-04", ageHours: 50.0, acknowledged: "0" },
  { name: "New host discovered", severity: "1", hostname: "mon-05", ageHours: 60.0, acknowledged: "0" },
  { name: "Backup job finished with warnings", severity: "1", hostname: "nas-03", ageHours: 18.0, acknowledged: "1" },
  { name: "Package updates available", severity: "0", hostname: "web-09", ageHours: 70.0, acknowledged: "0" },
  { name: "Informational: scheduled reboot pending", severity: "0", hostname: "app-06", ageHours: 5.0, acknowledged: "0" },
];

export const demoProblems: ZabbixProblem[] = [];
export const demoTriggers: ZabbixTrigger[] = [];

// Trigger mit "manual close" (Zabbix manual_close=1) — der Close-Button im
// DetailPanel erscheint im Demo-Modus nur für diese Probleme.
const MANUAL_CLOSE_NAMES = new Set([
  "SSL certificate expires soon",
  "Backup job finished with warnings",
  "Package updates available",
  "Informational: scheduled reboot pending",
  "New host discovered",
]);

let nextEventId = 800000;
for (const spec of PROBLEM_SPECS) {
  const host = demoHosts.find((h) => h.host === spec.hostname);
  if (!host) continue;
  const item = demoItems.find((it) => it.hostid === host.hostid);
  const trigid = triggerId();
  const eventid = String(nextEventId++);
  demoTriggers.push({
    triggerid: trigid,
    description: spec.name,
    expression: `{${host.host}:${item?.key_ ?? "system.cpu.util"}.last()}>80`,
    priority: spec.severity,
    value: "1",
    status: "0",
    manual_close: MANUAL_CLOSE_NAMES.has(spec.name) ? "1" : "0",
    hosts: [{ hostid: host.hostid, host: host.host }],
    items: item
      ? [
          {
            itemid: item.itemid,
            key_: item.key_,
            name: item.name,
            value_type: item.value_type,
            lastvalue: item.lastvalue,
            lastclock: item.lastclock,
            units: item.units,
          },
        ]
      : [],
  });
  demoProblems.push({
    eventid,
    objectid: trigid,
    name: spec.name,
    severity: spec.severity,
    clock: String(hoursAgo(spec.ageHours)),
    acknowledged: spec.acknowledged,
    suppressed: "0",
    opdata: spec.opdata,
    tags: [
      { tag: "scope", value: pick(["availability", "performance", "capacity"]) },
      { tag: "component", value: pick(["cpu", "memory", "storage", "network", "database"]) },
    ],
  });
}

// ---------------------------------------------------------------------------
// Maintenance windows
// ---------------------------------------------------------------------------

export const demoMaintenances: ZabbixMaintenance[] = [
  {
    maintenanceid: "90001",
    name: "DB failover test",
    active_since: String(DEMO_NOW - 3600),
    active_till: String(DEMO_NOW + 3600 * 2),
    maintenance_type: "0",
    description: "Planned failover exercise for the primary/replica pair.",
    hosts: [{ hostid: hostInMaintenance.hostid, host: hostInMaintenance.host, name: hostInMaintenance.name }],
    timeperiods: [{ timeperiod_type: "0", period: String(3600 * 3), start_date: String(DEMO_NOW - 3600) }],
  },
  {
    maintenanceid: "90002",
    name: "Weekly patch window",
    active_since: String(DEMO_NOW - 86400 * 3),
    active_till: String(DEMO_NOW + 86400 * 300),
    maintenance_type: "0",
    description: "Recurring OS patching window, Sunday nights.",
    hostgroups: [demoHostGroups[0]!, demoHostGroups[2]!],
    timeperiods: [{ timeperiod_type: "3", period: String(3600 * 2), every: "1", dayofweek: "64", start_time: "79200" }],
  },
  {
    maintenanceid: "90003",
    name: "Network switch firmware upgrade",
    active_since: String(DEMO_NOW + 86400 * 2),
    active_till: String(DEMO_NOW + 86400 * 2 + 3600 * 4),
    maintenance_type: "1",
    description: "Firmware rollout for the access-layer switches.",
    hostgroups: [demoHostGroups[5]!],
    timeperiods: [{ timeperiod_type: "0", period: String(3600 * 4), start_date: String(DEMO_NOW + 86400 * 2) }],
  },
  {
    maintenanceid: "90004",
    name: "Storage array maintenance (completed)",
    active_since: String(DEMO_NOW - 86400 * 10),
    active_till: String(DEMO_NOW - 86400 * 9),
    maintenance_type: "0",
    description: "Firmware update on the NAS cluster.",
    hostgroups: [demoHostGroups[3]!],
    timeperiods: [{ timeperiod_type: "0", period: String(3600 * 6), start_date: String(DEMO_NOW - 86400 * 10) }],
  },
];

// ---------------------------------------------------------------------------
// Web scenarios (httptest) — one auto-created item per Zabbix web-monitoring
// signal (web.test.fail/error/time/rspcode), matched by scenario/step name.
// ---------------------------------------------------------------------------

interface DemoStepSpec {
  name: string;
  url: string;
  /** Seconds. */
  timeout: number;
}

interface DemoScenarioSpec {
  name: string;
  hostname: string;
  steps: DemoStepSpec[];
  outcome: "ok" | "degraded" | "failed";
}

const SCENARIO_SPECS: DemoScenarioSpec[] = [
  {
    name: "Checkout flow",
    hostname: "web-01",
    outcome: "ok",
    steps: [
      { name: "Homepage", url: "https://shop.example.com/", timeout: 10 },
      { name: "Add to cart", url: "https://shop.example.com/cart/add", timeout: 10 },
      { name: "Login", url: "https://shop.example.com/session", timeout: 10 },
      { name: "Place order", url: "https://shop.example.com/checkout/submit", timeout: 10 },
    ],
  },
  {
    name: "Payment gateway",
    hostname: "web-01",
    outcome: "failed",
    steps: [
      { name: "Reach gateway", url: "https://pay.example.com/health", timeout: 5 },
      { name: "Auth token exchange", url: "https://pay.example.com/oauth/token", timeout: 3 },
    ],
  },
  {
    name: "Homepage uptime",
    hostname: "web-02",
    outcome: "ok",
    steps: [{ name: "Homepage", url: "https://www.example.com/", timeout: 10 }],
  },
  {
    name: "Admin login",
    hostname: "app-03",
    outcome: "ok",
    steps: [
      { name: "Login form", url: "https://admin.example.com/login", timeout: 10 },
      { name: "Authenticate", url: "https://admin.example.com/login", timeout: 10 },
    ],
  },
  {
    name: "API health",
    hostname: "app-05",
    outcome: "ok",
    steps: [{ name: "Health probe", url: "https://api.example.com/v1/health", timeout: 5 }],
  },
  {
    name: "Docs site",
    hostname: "web-04",
    outcome: "degraded",
    steps: [{ name: "Homepage", url: "https://docs.example.com/", timeout: 1 }],
  },
  {
    name: "Marketing site",
    hostname: "web-05",
    outcome: "ok",
    steps: [{ name: "Homepage", url: "https://example.com/", timeout: 10 }],
  },
  {
    name: "Support portal",
    hostname: "app-02",
    outcome: "ok",
    steps: [
      { name: "Homepage", url: "https://support.example.com/", timeout: 10 },
      { name: "Search ticket", url: "https://support.example.com/search?q=test", timeout: 10 },
      { name: "View article", url: "https://support.example.com/kb/12345", timeout: 10 },
    ],
  },
];

export const demoHttpTests: ZabbixHttpTest[] = [];

let nextHttptestId = 70001;
let nextHttpstepId = 71001;

for (const spec of SCENARIO_SPECS) {
  const host = demoHosts.find((h) => h.host === spec.hostname);
  if (!host) continue;
  const httptestid = String(nextHttptestId++);

  const steps: ZabbixHttpStep[] = spec.steps.map((st, idx) => ({
    httpstepid: String(nextHttpstepId++),
    httptestid,
    name: st.name,
    no: String(idx + 1),
    url: st.url,
    timeout: String(st.timeout),
    status_codes: "200",
  }));

  demoHttpTests.push({
    httptestid,
    name: spec.name,
    hostid: host.hostid,
    delay: "1m",
    retries: "1",
    status: "0",
    agent: "auzui-demo",
    steps,
    hosts: [{ hostid: host.hostid, host: host.host, name: host.name }],
  });

  const failStepIndex = spec.outcome === "failed" ? spec.steps.length - 1 : -1;
  const failValue = failStepIndex >= 0 ? failStepIndex + 1 : 0;

  const failId = itemId();
  registerSeries(failId, {
    kind: "web-fail",
    base: spec.outcome === "failed" ? 0.35 : spec.outcome === "degraded" ? 0.03 : 0.005,
    amplitude: spec.outcome === "failed" ? 0.9 : 0.05,
    unit: "",
    valueType: "3",
  });
  demoItems.push({
    itemid: failId,
    hostid: host.hostid,
    name: `Failed step of scenario "${spec.name}"`,
    key_: webTestKey("fail", spec.name),
    value_type: "3",
    units: "",
    lastvalue: String(failValue),
    lastclock: String(DEMO_NOW - randInt(5, 60)),
    tags: [],
    status: "0",
    state: "0",
  });

  if (spec.outcome === "failed") {
    demoItems.push({
      itemid: itemId(),
      hostid: host.hostid,
      name: `Last error message of scenario "${spec.name}"`,
      key_: webTestKey("error", spec.name),
      value_type: "1",
      units: "",
      lastvalue: "connect timed out after 3000 ms",
      lastclock: String(DEMO_NOW - randInt(5, 60)),
      tags: [],
      status: "0",
      state: "0",
    });
  }

  spec.steps.forEach((st, idx) => {
    const failingStep = spec.outcome === "failed" && idx === failStepIndex;
    const degraded = spec.outcome === "degraded";

    const timeId = itemId();
    const baseSeconds = failingStep
      ? st.timeout * 1.1
      : degraded
        ? st.timeout * 0.78
        : randRange(0.04, 0.25);
    registerSeries(timeId, {
      kind: "web-response-time",
      base: baseSeconds,
      amplitude: failingStep ? st.timeout * 0.5 : degraded ? st.timeout * 0.25 : baseSeconds * 0.35,
      unit: "s",
      valueType: "0",
    });
    demoItems.push({
      itemid: timeId,
      hostid: host.hostid,
      name: `Response time for step "${st.name}" of scenario "${spec.name}"`,
      key_: webTestStepKey("time", spec.name, st.name),
      value_type: "0",
      units: "s",
      lastvalue: failingStep ? String(st.timeout) : lastValueFor(timeId),
      lastclock: String(DEMO_NOW - randInt(5, 60)),
      tags: [],
      status: "0",
      state: "0",
    });

    demoItems.push({
      itemid: itemId(),
      hostid: host.hostid,
      name: `Response code for step "${st.name}" of scenario "${spec.name}"`,
      key_: webTestStepKey("rspcode", spec.name, st.name),
      value_type: "3",
      units: "",
      lastvalue: failingStep ? "0" : "200",
      lastclock: String(DEMO_NOW - randInt(5, 60)),
      tags: [],
      status: "0",
      state: "0",
    });
  });
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export interface DemoLogMessage {
  id: string;
  timestamp: number;
  source: string;
  message: string;
  level: number;
  facility: string;
  facility_num: number;
  fields: Record<string, unknown>;
}

const LOG_TEMPLATES: { level: number; facility: string; facility_num: number; app: string; msg: string }[] = [
  { level: 6, facility: "daemon", facility_num: 3, app: "sshd", msg: "Accepted publickey for deploy from 10.10.1.44 port 51344" },
  { level: 6, facility: "daemon", facility_num: 3, app: "systemd", msg: "Started nginx.service - A high performance web server." },
  { level: 4, facility: "daemon", facility_num: 3, app: "nginx", msg: "upstream timed out (110: Connection timed out) while reading response header" },
  { level: 3, facility: "local0", facility_num: 16, app: "app-server", msg: "Unhandled exception: NullReferenceException in OrderProcessor.Process" },
  { level: 6, facility: "cron", facility_num: 9, app: "CRON", msg: "(root) CMD (/usr/local/bin/backup.sh --incremental)" },
  { level: 2, facility: "kern", facility_num: 0, app: "kernel", msg: "Out of memory: Killed process 18422 (java) total-vm:6123456kB" },
  { level: 6, facility: "auth", facility_num: 4, app: "sudo", msg: "deploy : TTY=pts/0 ; PWD=/srv/app ; COMMAND=/usr/bin/systemctl restart app" },
  { level: 5, facility: "daemon", facility_num: 3, app: "postgresql", msg: "checkpoint starting: time" },
  { level: 4, facility: "daemon", facility_num: 3, app: "postgresql", msg: "duration: 4213.221 ms  statement: SELECT * FROM orders WHERE customer_id = $1" },
  { level: 6, facility: "local1", facility_num: 17, app: "haproxy", msg: "10.10.1.9:51022 [30/Jul/2026] web-frontend web-backend/web-03 0/0/1/12/13 200 612 - -" },
  { level: 3, facility: "local1", facility_num: 17, app: "haproxy", msg: "Server web-backend/web-05 is DOWN, reason: Layer4 timeout" },
  { level: 6, facility: "daemon", facility_num: 3, app: "docker", msg: "Container app-worker-3 started" },
  { level: 4, facility: "daemon", facility_num: 3, app: "docker", msg: "Container app-worker-3 exited with code 137" },
  { level: 6, facility: "syslog", facility_num: 5, app: "rsyslogd", msg: "action 'action-0' resumed (module 'builtin:omfwd')" },
  { level: 2, facility: "kern", facility_num: 0, app: "kernel", msg: "eth0: link down" },
  { level: 6, facility: "kern", facility_num: 0, app: "kernel", msg: "eth0: link up, 1000Mbps full duplex" },
  { level: 5, facility: "daemon", facility_num: 3, app: "zabbix_agent2", msg: "active check configuration update from Zabbix Server ended" },
  { level: 6, facility: "auth", facility_num: 4, app: "sshd", msg: "Received disconnect from 10.10.1.44 port 51344:11: disconnected by user" },
  { level: 3, facility: "local0", facility_num: 16, app: "app-server", msg: "Payment gateway request failed: timeout after 30000ms" },
  { level: 6, facility: "daemon", facility_num: 3, app: "nginx", msg: "GET /api/v2/orders?status=open HTTP/1.1 200" },
];

export const demoLogMessages: DemoLogMessage[] = [];
{
  const sources = demoHosts.filter((h) => h.hostgroups?.[0]?.groupid !== "20006").map((h) => h.host);
  const total = 600;
  for (let i = 0; i < total; i++) {
    const tmpl = LOG_TEMPLATES[i % LOG_TEMPLATES.length]!;
    const source = sources[randInt(0, sources.length - 1)]!;
    const ts = DEMO_NOW - i * randRange(8, 45);
    demoLogMessages.push({
      id: `demo-${i}`,
      timestamp: ts,
      source,
      message: tmpl.msg,
      level: tmpl.level,
      facility: tmpl.facility,
      facility_num: tmpl.facility_num,
      fields: { application_name: tmpl.app },
    });
  }
  demoLogMessages.sort((a, b) => b.timestamp - a.timestamp);
}

export const demoLogServers = [{ id: "gl1", label: "Graylog EU" }];
export const demoLogStreams = [
  { id: "stream-app", title: "Application logs", description: "Backend + frontend services", disabled: false, is_default: true },
  { id: "stream-infra", title: "Infrastructure logs", description: "OS + network devices", disabled: false, is_default: true },
  { id: "stream-security", title: "Security & auth", description: "sudo/ssh/auth events", disabled: false, is_default: false },
];

export interface DemoFilterSet {
  id: string;
  name: string;
  owner: string;
  shared: boolean;
  filters: {
    include: { field: string; value: string }[];
    exclude: { field: string; value: string }[];
    streams: string[] | null;
    servers: string[] | null;
    level: number | null;
  };
  created: string;
  updated: string;
}

export const demoFilterSets: DemoFilterSet[] = [
  {
    id: "fs-1",
    name: "Errors and above",
    owner: "demo",
    shared: true,
    filters: { include: [], exclude: [], streams: null, servers: null, level: 3 },
    created: new Date((DEMO_NOW - 86400 * 30) * 1000).toISOString(),
    updated: new Date((DEMO_NOW - 86400 * 10) * 1000).toISOString(),
  },
  {
    id: "fs-2",
    name: "Web tier only",
    owner: "demo",
    shared: false,
    filters: {
      include: [{ field: "application_name", value: "nginx" }],
      exclude: [],
      streams: ["stream-app"],
      servers: null,
      level: null,
    },
    created: new Date((DEMO_NOW - 86400 * 5) * 1000).toISOString(),
    updated: new Date((DEMO_NOW - 86400 * 5) * 1000).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Docker (optional plugin) — auzui-docker-plan.md Phase 4. Four hosts (one
// normal/writable, one readonly, one SSH+compose, one unreachable so the
// `errors` fan-out entries have something to show), containers spanning
// every Docker state plus two compose stacks for the "group by stack" view.
// Wire shapes here are deliberately snake_case/Docker-native — these are
// mocks of the GATEWAY's raw JSON (docker_routes.py/docker_hosts.py), which
// GatewayDockerSource (packages/docker) then maps to camelCase, exactly like
// the Zabbix mock data above mirrors the Zabbix API's own field names.
// ---------------------------------------------------------------------------

/** Deterministic 12-hex-char id from a seed string — good enough to look
 * like a Docker short id without needing real randomness. */
function hexId(seed: string): string {
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < seed.length; i++) {
    h1 = (h1 * 31 + seed.charCodeAt(i)) | 0;
    h2 = (h2 * 131 + seed.charCodeAt(i)) | 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return (hex(h1) + hex(h2)).slice(0, 12);
}

/** Deterministic fake `sha256:<64 hex>` digest from a seed string. */
function fakeDigest(seed: string): string {
  const chunks = ["a", "b", "c", "d", "e", "f"].map((suffix) => hexId(seed + suffix));
  return `sha256:${chunks.join("").slice(0, 64).padEnd(64, "0")}`;
}

export interface DemoDockerPort {
  private: number;
  public: number | null;
  type: string;
  ip: string;
}

export type DemoDockerUpdateStatus = "current" | "outdated" | "unknown";

export interface DemoDockerContainer {
  id: string;
  host_id: string;
  name: string;
  names: string[];
  image: string;
  tag: string;
  image_id: string;
  state: "running" | "exited" | "paused" | "restarting";
  health: "healthy" | "unhealthy" | "starting" | null;
  status: string;
  created: number;
  ports: DemoDockerPort[];
  project: string;
  service: string;
  compose_working_dir: string;
  compose_config_file: string;
  labels: Record<string, string>;
  mounts: { Source: string; Destination: string; RW: boolean; Type: string }[];
  env: string[];
  restart_policy: string;
  /** Registry-update status this container's image carries in /updates. */
  updateStatus: DemoDockerUpdateStatus;
}

export interface DemoDockerHost {
  id: string;
  label: string;
  readonly: boolean;
  compose: boolean;
  zabbix_host: string;
  engine_version: string;
  /** Marks the "everything about this host fails" demo host. */
  unreachable?: boolean;
}

export const demoDockerHosts: DemoDockerHost[] = [
  { id: "prod-a", label: "prod-a", readonly: false, compose: false, zabbix_host: "web-01", engine_version: "26.1.4" },
  { id: "prod-b", label: "prod-b", readonly: true, compose: false, zabbix_host: "web-02", engine_version: "26.1.4" },
  { id: "edge", label: "edge (ssh)", readonly: false, compose: true, zabbix_host: "app-05", engine_version: "25.0.3" },
  { id: "legacy-01", label: "legacy-01", readonly: false, compose: false, zabbix_host: "", engine_version: "", unreachable: true },
];

const DOCKER_UNREACHABLE_HOST_ID = "legacy-01";

function dockerHostError(hostId: string): { host_id: string; message: string } {
  return {
    host_id: hostId,
    message: "ConnectionError: HTTPConnectionPool(host='10.50.0.9', port=2375): connection refused",
  };
}

interface DockerContainerSpec {
  key: string;
  hostId: string;
  name: string;
  image: string;
  tag: string;
  state: DemoDockerContainer["state"];
  health?: "healthy" | "unhealthy" | "starting";
  ports?: { private: number; public: number | null; type?: string }[];
  project?: string;
  service?: string;
  createdHoursAgo: number;
  updateStatus: DemoDockerUpdateStatus;
  mounts?: { source: string; destination: string; ro?: boolean }[];
  env?: string[];
}

const DOCKER_CONTAINER_SPECS: DockerContainerSpec[] = [
  // prod-a — writable, non-compose host, but three of its containers still
  // carry compose labels ("webshop") so "group by stack" has something to
  // show on a non-SSH host too.
  {
    key: "web-nginx",
    hostId: "prod-a",
    name: "web-nginx",
    image: "nginx",
    tag: "1.27",
    state: "running",
    health: "healthy",
    ports: [{ private: 80, public: 8080 }, { private: 443, public: 8443 }],
    project: "webshop",
    service: "nginx",
    createdHoursAgo: 120,
    updateStatus: "current",
    mounts: [{ source: "/opt/stacks/webshop/nginx.conf", destination: "/etc/nginx/nginx.conf", ro: true }],
  },
  {
    key: "web-app",
    hostId: "prod-a",
    name: "web-app",
    image: "ghcr.io/acme/webapp",
    tag: "v2.3.1",
    state: "running",
    health: "unhealthy",
    ports: [{ private: 3000, public: null }],
    project: "webshop",
    service: "app",
    createdHoursAgo: 120,
    updateStatus: "outdated",
    env: ["NODE_ENV=production", "DATABASE_URL=postgres://app@postgres-main:5432/webshop"],
  },
  {
    key: "web-redis",
    hostId: "prod-a",
    name: "web-redis",
    image: "redis",
    tag: "7",
    state: "running",
    ports: [{ private: 6379, public: null }],
    project: "webshop",
    service: "redis",
    createdHoursAgo: 120,
    updateStatus: "current",
  },
  {
    key: "postgres-main",
    hostId: "prod-a",
    name: "postgres-main",
    image: "postgres",
    tag: "16",
    state: "running",
    health: "healthy",
    ports: [{ private: 5432, public: 5432 }],
    createdHoursAgo: 400,
    updateStatus: "current",
    mounts: [{ source: "prod-a_pgdata", destination: "/var/lib/postgresql/data" }],
  },
  {
    key: "batch-worker",
    hostId: "prod-a",
    name: "batch-worker",
    image: "ghcr.io/acme/worker",
    tag: "v1.0.0",
    state: "exited",
    createdHoursAgo: 48,
    updateStatus: "outdated",
  },
  {
    key: "old-cache",
    hostId: "prod-a",
    name: "old-cache",
    image: "redis",
    tag: "6",
    state: "paused",
    createdHoursAgo: 600,
    updateStatus: "unknown",
  },

  // prod-b — read-only host (socket-proxy with POST=0), standalone containers.
  {
    key: "traefik",
    hostId: "prod-b",
    name: "traefik",
    image: "traefik",
    tag: "v3.1",
    state: "running",
    health: "healthy",
    ports: [{ private: 80, public: 80 }, { private: 443, public: 443 }, { private: 8080, public: null }],
    createdHoursAgo: 300,
    updateStatus: "current",
  },
  {
    key: "grafana",
    hostId: "prod-b",
    name: "grafana",
    image: "grafana/grafana",
    tag: "11.1.0",
    state: "restarting",
    createdHoursAgo: 5,
    updateStatus: "outdated",
  },
  {
    key: "prometheus",
    hostId: "prod-b",
    name: "prometheus",
    image: "prom/prometheus",
    tag: "v2.53.0",
    state: "running",
    ports: [{ private: 9090, public: 9090 }],
    createdHoursAgo: 300,
    updateStatus: "unknown",
  },

  // edge — ssh:// host with compose:true, one full "shop" stack.
  {
    key: "shop-db",
    hostId: "edge",
    name: "shop-db",
    image: "postgres",
    tag: "15",
    state: "running",
    health: "healthy",
    ports: [{ private: 5432, public: 5432 }],
    project: "shop",
    service: "db",
    createdHoursAgo: 200,
    updateStatus: "current",
    mounts: [{ source: "shop_db-data", destination: "/var/lib/postgresql/data" }],
  },
  {
    key: "shop-api",
    hostId: "edge",
    name: "shop-api",
    image: "ghcr.io/acme/shop-api",
    tag: "v4.2.0",
    state: "running",
    ports: [{ private: 8080, public: 8080 }],
    project: "shop",
    service: "api",
    createdHoursAgo: 200,
    updateStatus: "outdated",
  },
  {
    key: "shop-cache",
    hostId: "edge",
    name: "shop-cache",
    image: "redis",
    tag: "7-alpine",
    state: "running",
    project: "shop",
    service: "cache",
    createdHoursAgo: 200,
    updateStatus: "current",
  },
  {
    key: "shop-worker",
    hostId: "edge",
    name: "shop-worker",
    image: "ghcr.io/acme/shop-worker",
    tag: "v4.2.0",
    state: "exited",
    project: "shop",
    service: "worker",
    createdHoursAgo: 20,
    updateStatus: "unknown",
  },
];

function statusTextFor(state: DemoDockerContainer["state"], health: DemoDockerContainer["health"], hoursAgoVal: number): string {
  const healthSuffix = health ? ` (${health === "starting" ? "health: starting" : health})` : "";
  if (state === "running") return `Up ${Math.max(1, Math.round(hoursAgoVal))} hours${healthSuffix}`;
  if (state === "paused") return `Up ${Math.max(1, Math.round(hoursAgoVal))} hours (Paused)`;
  if (state === "restarting") return "Restarting (1) 12 seconds ago";
  return `Exited (0) ${Math.max(1, Math.round(hoursAgoVal))} hours ago`;
}

export const demoDockerContainers: DemoDockerContainer[] = DOCKER_CONTAINER_SPECS.map((spec) => {
  const id = hexId(`${spec.hostId}:${spec.key}`);
  const imageId = fakeDigest(`img:${spec.image}:${spec.tag}`);
  const workingDir = spec.project ? `/opt/stacks/${spec.project}` : "";
  const configFile = spec.project ? `/opt/stacks/${spec.project}/docker-compose.yml` : "";
  const labels: Record<string, string> = spec.project
    ? {
        "com.docker.compose.project": spec.project,
        "com.docker.compose.service": spec.service ?? "",
        "com.docker.compose.project.working_dir": workingDir,
        "com.docker.compose.project.config_files": configFile,
      }
    : {};
  return {
    id,
    host_id: spec.hostId,
    name: spec.name,
    names: [spec.name],
    image: spec.image,
    tag: spec.tag,
    image_id: imageId,
    state: spec.state,
    health: spec.health ?? null,
    status: statusTextFor(spec.state, spec.health ?? null, spec.createdHoursAgo),
    created: hoursAgo(spec.createdHoursAgo),
    ports: spec.state === "exited" ? [] : (spec.ports ?? []).map((p) => ({ private: p.private, public: p.public, type: p.type ?? "tcp", ip: p.public ? "0.0.0.0" : "" })),
    project: spec.project ?? "",
    service: spec.service ?? "",
    compose_working_dir: workingDir,
    compose_config_file: configFile,
    labels,
    mounts: (spec.mounts ?? []).map((m) => ({
      Source: m.source,
      Destination: m.destination,
      RW: !m.ro,
      Type: m.source.startsWith("/") ? "bind" : "volume",
    })),
    env: spec.env ?? [],
    restart_policy: spec.state === "exited" ? "no" : "unless-stopped",
    updateStatus: spec.updateStatus,
  };
});

function findDockerContainer(hostId: string, cid: string): DemoDockerContainer | undefined {
  return demoDockerContainers.find((c) => c.host_id === hostId && c.id === cid);
}

/** Mutable per-container registry-update entry, keyed by container id — pull_recreate flips "outdated" to "current". */
interface DockerUpdateEntry {
  tag: string;
  local_digest: string;
  remote_digest: string;
  status: DemoDockerUpdateStatus;
}

export const demoDockerUpdates = new Map<string, DockerUpdateEntry>(
  demoDockerContainers.map((c) => {
    const localDigest = c.updateStatus === "unknown" ? "" : fakeDigest(`local:${c.id}`);
    const remoteDigest =
      c.updateStatus === "unknown"
        ? ""
        : c.updateStatus === "outdated"
          ? fakeDigest(`remote-newer:${c.id}`)
          : localDigest;
    return [
      c.id,
      { tag: c.tag, local_digest: localDigest, remote_digest: remoteDigest, status: c.updateStatus },
    ];
  }),
);

// -- images / volumes / networks (GET /api/docker/search) -------------------

export interface DemoDockerImageRow {
  host_id: string;
  Id: string;
  RepoTags: string[];
  RepoDigests: string[];
  Size: number;
  /** Unix seconds — /images/json reports Created as an int, unlike /volumes
   * and /networks which use RFC3339 strings. */
  Created: number;
  /** -1 is what Docker returns unless the caller asks for shared sizes, which
   * docker-py's images.list() does not. */
  SharedSize: number;
  Labels: Record<string, string>;
  used_by: string[];
}

export const demoDockerImages: DemoDockerImageRow[] = (() => {
  const byKey = new Map<string, DemoDockerImageRow>();
  for (const c of demoDockerContainers) {
    const key = `${c.host_id}:${c.image}:${c.tag}`;
    const existing = byKey.get(key);
    if (existing) {
      // Several containers can share one image — that is exactly what the
      // used_by column shows, so they accumulate instead of being skipped.
      existing.used_by.push(c.name);
      continue;
    }
    const entry = demoDockerUpdates.get(c.id);
    byKey.set(key, {
      host_id: c.host_id,
      Id: c.image_id,
      RepoTags: [`${c.image}:${c.tag}`],
      RepoDigests: entry?.local_digest ? [`${c.image}@${entry.local_digest}`] : [],
      Size: 40_000_000 + (hexId(key).charCodeAt(0) % 200) * 1_000_000,
      Created: c.created,
      SharedSize: -1,
      Labels: c.project ? { "com.docker.compose.project": c.project } : {},
      used_by: [c.name],
    });
  }
  const rows = [...byKey.values()];
  rows.forEach((row) => row.used_by.sort());
  // One dangling leftover per demo host would be noise; a single one on prod-a
  // is enough to show what an unused, untagged image looks like.
  rows.push({
    host_id: "prod-a",
    Id: fakeDigest("img:dangling:prod-a"),
    RepoTags: [],
    RepoDigests: [],
    Size: 212_000_000,
    Created: DEMO_NOW - 400 * 86_400,
    SharedSize: -1,
    Labels: {},
    used_by: [],
  });
  return rows;
})();

export interface DemoDockerVolumeRow {
  host_id: string;
  Name: string;
  Driver: string;
  Mountpoint: string;
  Scope: string;
  /** RFC3339, like the real /volumes endpoint — the lane shows the age. */
  CreatedAt: string;
  Labels: Record<string, string>;
  /** Containers using this volume — the gateway derives it from each host's
   * container Mounts; the demo states it directly. [] renders as "unused". */
  used_by: string[];
}

/** RFC3339 timestamp `days` before the demo's fixed "now". */
function demoCreatedAt(days: number): string {
  return new Date((DEMO_NOW - days * 86_400) * 1000).toISOString();
}

function volumeRow(
  host_id: string,
  name: string,
  project: string,
  ageDays: number,
  used_by: string[],
): DemoDockerVolumeRow {
  return {
    host_id,
    Name: name,
    Driver: "local",
    Mountpoint: `/var/lib/docker/volumes/${name}/_data`,
    Scope: "local",
    CreatedAt: demoCreatedAt(ageDays),
    Labels: project ? { "com.docker.compose.project": project, "com.docker.compose.volume": name } : {},
    used_by,
  };
}

export const demoDockerVolumes: DemoDockerVolumeRow[] = [
  volumeRow("prod-a", "prod-a_pgdata", "webshop", 280, ["postgres-main"]),
  volumeRow("prod-a", "webshop_nginx-cache", "webshop", 96, ["web-nginx"]),
  // Left behind by a container that is long gone — the case the "unused" tag
  // exists for, and the reason this view is worth having at all.
  volumeRow("prod-a", "webshop_old-uploads", "webshop", 430, []),
  volumeRow("prod-b", "prod-b_grafana-data", "monitoring", 190, ["grafana"]),
  volumeRow("edge", "shop_db-data", "shop", 210, ["shop-db"]),
];

export interface DemoDockerNetworkRow {
  host_id: string;
  Id: string;
  Name: string;
  Driver: string;
  Scope: string;
  /** Same nesting docker-py's Network.attrs uses — the networks lane reads
   * the subnet out of here (lib/docker.ts describeResourceRow). The built-in
   * `host` and `none` networks genuinely have an empty Config. */
  IPAM: { Driver: string; Config: { Subnet: string; Gateway: string }[] };
  /** RFC3339, like the real /networks endpoint. */
  Created: string;
  Internal: boolean;
  EnableIPv6: boolean;
  Attachable: boolean;
  Labels: Record<string, string>;
  used_by: string[];
}

function networkRow(
  host_id: string,
  name: string,
  driver: string,
  subnet: string,
  ageDays: number,
  used_by: string[],
  extra: Partial<DemoDockerNetworkRow> = {},
): DemoDockerNetworkRow {
  const octet = subnet.split(".")[1] ?? "17";
  const project = name.endsWith("_default") ? name.slice(0, -"_default".length) : "";
  return {
    host_id,
    Id: fakeDigest(`net:${host_id}:${name}`).slice(7, 19),
    Name: name,
    Driver: driver,
    Scope: "local",
    IPAM: {
      Driver: "default",
      Config: subnet ? [{ Subnet: subnet, Gateway: `172.${octet}.0.1` }] : [],
    },
    Created: demoCreatedAt(ageDays),
    Internal: false,
    EnableIPv6: false,
    Attachable: false,
    Labels: project ? { "com.docker.compose.project": project, "com.docker.compose.network": "default" } : {},
    used_by,
    ...extra,
  };
}

/**
 * Every Docker host ships three built-in networks — `bridge`, `host` and
 * `none` — on top of whatever compose creates. They are listed here because
 * the real view shows them too, and because `host`/`none` are the rows that
 * exercise the no-subnet path. They are created with the engine, hence the
 * uniformly old age.
 */
function builtinNetworks(host_id: string, bridgeUsers: string[]): DemoDockerNetworkRow[] {
  return [
    networkRow(host_id, "bridge", "bridge", "172.17.0.0/16", 520, bridgeUsers),
    networkRow(host_id, "host", "host", "", 520, []),
    networkRow(host_id, "none", "null", "", 520, [], { Internal: true }),
  ];
}

export const demoDockerNetworks: DemoDockerNetworkRow[] = [
  ...builtinNetworks("prod-a", ["old-cache"]),
  networkRow(
    "prod-a",
    "webshop_default",
    "bridge",
    "172.18.0.0/16",
    280,
    ["batch-worker", "postgres-main", "web-app", "web-nginx", "web-redis"],
    { EnableIPv6: true },
  ),
  ...builtinNetworks("prod-b", []),
  networkRow("prod-b", "monitoring_default", "bridge", "172.20.0.0/16", 190, [
    "grafana",
    "prometheus",
    "traefik",
  ]),
  ...builtinNetworks("edge", []),
  networkRow("edge", "shop_default", "bridge", "172.19.0.0/16", 210, [
    "shop-api",
    "shop-cache",
    "shop-db",
    "shop-worker",
  ]),
];

// -- host summaries (GET /api/docker/hosts) ---------------------------------

export function dockerHostSummary(host: DemoDockerHost): Record<string, unknown> {
  const containers = demoDockerContainers.filter((c) => c.host_id === host.id);
  const running = containers.filter((c) => c.state === "running").length;
  return {
    id: host.id,
    label: host.label,
    readonly: host.readonly,
    compose: host.compose,
    zabbix_host: host.zabbix_host,
    engine_version: host.engine_version,
    containers_running: running,
    containers_stopped: containers.length - running,
    images: demoDockerImages.filter((i) => i.host_id === host.id).length,
  };
}

export function dockerHostsResult(): { hosts: Record<string, unknown>[]; errors: { host_id: string; message: string }[] } {
  return {
    hosts: demoDockerHosts.filter((h) => !h.unreachable).map(dockerHostSummary),
    errors: [dockerHostError(DOCKER_UNREACHABLE_HOST_ID)],
  };
}

export function dockerContainerWire(c: DemoDockerContainer): Record<string, unknown> {
  return {
    id: c.id,
    host_id: c.host_id,
    name: c.name,
    names: c.names,
    image: c.image,
    tag: c.tag,
    image_id: c.image_id,
    state: c.state,
    status: c.status,
    health: c.health,
    created: c.created,
    ports: c.ports,
    project: c.project,
    service: c.service,
    compose_working_dir: c.compose_working_dir,
    labels: c.labels,
  };
}

export function dockerContainersResult(hostIds: string[]): { containers: Record<string, unknown>[]; errors: { host_id: string; message: string }[] } {
  const wanted = hostIds.length > 0 ? hostIds : demoDockerHosts.map((h) => h.id);
  const containers = demoDockerContainers
    .filter((c) => wanted.includes(c.host_id))
    .map(dockerContainerWire);
  const errors = wanted.includes(DOCKER_UNREACHABLE_HOST_ID) ? [dockerHostError(DOCKER_UNREACHABLE_HOST_ID)] : [];
  return { containers, errors };
}

export function dockerInspectFor(c: DemoDockerContainer): Record<string, unknown> {
  return {
    host_id: c.host_id,
    Id: c.id,
    Name: `/${c.name}`,
    Image: c.image_id,
    Created: new Date(c.created * 1000).toISOString(),
    State: {
      Status: c.state,
      Running: c.state === "running",
      Paused: c.state === "paused",
      Restarting: c.state === "restarting",
      Health: c.health ? { Status: c.health, FailingStreak: c.health === "unhealthy" ? 3 : 0 } : undefined,
    },
    Config: {
      Image: `${c.image}:${c.tag}`,
      Env: c.env,
      Labels: c.labels,
      Cmd: null,
      Hostname: c.name,
      WorkingDir: "",
    },
    HostConfig: {
      RestartPolicy: { Name: c.restart_policy, MaximumRetryCount: 0 },
    },
    Mounts: c.mounts,
    NetworkSettings: {
      Networks: {
        [c.project ? `${c.project}_default` : "bridge"]: {
          IPAddress: `172.19.${c.host_id.length}.${(hexId(c.id).charCodeAt(0) % 200) + 2}`,
        },
      },
    },
  };
}

// -- stats (GET single + POST bulk) ------------------------------------------

export interface DemoDockerStats {
  cpu_pct: number;
  mem_used: number;
  mem_limit: number;
  net_rx: number;
  net_tx: number;
  blk_read: number;
  blk_write: number;
}

/** Deterministic-per-container, slightly time-varying stats: a mulberry32
 * PRNG reseeded from (container id, 3s wall-clock bucket) so the live
 * sparkline visibly moves on every poll without ever calling Math.random(). */
export function dockerStatsFor(c: DemoDockerContainer): DemoDockerStats {
  const seed = itemSeed(c.id);
  if (c.state !== "running" && c.state !== "restarting") {
    return { cpu_pct: 0, mem_used: 0, mem_limit: 0, net_rx: 0, net_tx: 0, blk_read: 0, blk_write: 0 };
  }
  const bucket = Math.floor(Date.now() / 3000);
  const local = mulberry32(seed ^ bucket);
  const cpuBase = 4 + (Math.abs(seed) % 35);
  const cpuPct = Math.max(0.1, cpuBase + (local() - 0.5) * 10);
  const memLimit = 268_435_456 * (1 + (Math.abs(seed) % 4)); // 256MiB..1GiB
  const memUsedFraction = 0.2 + ((Math.abs(seed) >>> 3) % 50) / 100;
  const memUsed = Math.floor(memLimit * memUsedFraction * (0.9 + local() * 0.2));
  const netRx = Math.floor((Math.abs(seed) % 500_000) + local() * 200_000);
  const netTx = Math.floor((Math.abs(seed) % 300_000) + local() * 150_000);
  const blkRead = Math.floor((Math.abs(seed) % 2_000_000) + local() * 500_000);
  const blkWrite = Math.floor((Math.abs(seed) % 1_000_000) + local() * 300_000);
  return {
    cpu_pct: Math.round(cpuPct * 100) / 100,
    mem_used: memUsed,
    mem_limit: memLimit,
    net_rx: netRx,
    net_tx: netTx,
    blk_read: blkRead,
    blk_write: blkWrite,
  };
}

// -- logs (GET .../logs) — historical lines with ascending timestamps and
// cursor semantics that actually work: a fixed 5s-apart timeline anchored at
// a far-past epoch (real wall-clock, NOT DEMO_NOW — logs are "live" relative
// to whenever the demo is actually being viewed), so `since=<cursor>` always
// returns only lines strictly after the cursor, and lines keep accruing for
// as long as the tab stays open. -----------------------------------------

const DOCKER_LOG_TEMPLATES: { stream: "stdout" | "stderr"; message: string }[] = [
  { stream: "stdout", message: "GET /healthz 200 3ms" },
  { stream: "stdout", message: "connection established from 10.20.0.14:51044" },
  { stream: "stdout", message: "cache miss for key user:8841, fetching from origin" },
  { stream: "stderr", message: "WARN slow query (812ms): SELECT * FROM orders WHERE status = 'pending'" },
  { stream: "stdout", message: "worker pool: 4/8 busy" },
  { stream: "stderr", message: "ERROR upstream timeout after 5000ms, retrying (1/3)" },
  { stream: "stdout", message: "scheduled job 'cleanup-sessions' completed in 214ms" },
  { stream: "stdout", message: "config reloaded (SIGHUP)" },
  { stream: "stdout", message: "listening on 0.0.0.0:8080" },
  { stream: "stderr", message: "panic recovered: runtime error: invalid memory address or nil pointer dereference" },
  { stream: "stdout", message: "POST /api/v1/orders 201 44ms" },
  { stream: "stdout", message: "checkpoint complete: wrote 128 buffers" },
];

const DOCKER_LOG_STEP_S = 5;
const DOCKER_LOG_EPOCH_S = Math.floor(Date.parse("2020-01-01T00:00:00Z") / 1000);

export interface DemoDockerLogLine {
  ts: number;
  stream: "stdout" | "stderr";
  message: string;
}

function dockerLogLineAt(cid: string, index: number): DemoDockerLogLine {
  const local = mulberry32(itemSeed(`${cid}:${index}`));
  const tmpl = DOCKER_LOG_TEMPLATES[Math.floor(local() * DOCKER_LOG_TEMPLATES.length)]!;
  return { ts: DOCKER_LOG_EPOCH_S + index * DOCKER_LOG_STEP_S, stream: tmpl.stream, message: tmpl.message };
}

/** Pure — exported for unit testing the cursor/since contract. */
export function dockerLogLines(
  cid: string,
  sinceS: number | undefined,
  untilS: number | undefined,
  tail: number | undefined,
): DemoDockerLogLine[] {
  const nowS = Math.floor(Date.now() / 1000);
  const effectiveUntil = Math.min(untilS ?? nowS, nowS);
  const effectiveSince = sinceS ?? effectiveUntil - 3600;
  const startIndex = Math.max(0, Math.floor((effectiveSince - DOCKER_LOG_EPOCH_S) / DOCKER_LOG_STEP_S) + 1);
  const endIndex = Math.floor((effectiveUntil - DOCKER_LOG_EPOCH_S) / DOCKER_LOG_STEP_S);
  const lines: DemoDockerLogLine[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    const line = dockerLogLineAt(cid, i);
    if (line.ts > effectiveSince && line.ts <= effectiveUntil) lines.push(line);
  }
  if (tail && lines.length > tail) return lines.slice(lines.length - tail);
  return lines;
}

// -- compose stacks (GET /stacks/{host}, GET .../config, POST .../action) ---

export interface DemoDockerStackConfig {
  path: string;
  content: string;
}

export const demoDockerStackConfigs: Record<string, DemoDockerStackConfig> = {
  "edge/shop": {
    path: "/opt/stacks/shop/docker-compose.yml",
    content:
      'services:\n  db:\n    image: postgres:15\n    volumes:\n      - shop_db-data:/var/lib/postgresql/data\n    restart: unless-stopped\n  api:\n    image: ghcr.io/acme/shop-api:v4.2.0\n    depends_on: [db, cache]\n    ports:\n      - "8080:8080"\n    restart: unless-stopped\n  cache:\n    image: redis:7-alpine\n    restart: unless-stopped\n  worker:\n    image: ghcr.io/acme/shop-worker:v4.2.0\n    depends_on: [db, cache]\n    restart: "no"\n\nvolumes:\n  shop_db-data:\n',
  },
};

export function dockerComposePsFor(project: string, containers: DemoDockerContainer[]): Record<string, unknown>[] {
  return containers.map((c) => ({
    ID: c.id,
    Name: c.name,
    Image: `${c.image}:${c.tag}`,
    Command: "docker-entrypoint.sh",
    Project: project,
    Service: c.service,
    State: c.state,
    Status: c.status,
    Health: c.health ?? "",
    Publishers: c.ports
      .filter((p) => p.public)
      .map((p) => ({ URL: "0.0.0.0", TargetPort: p.private, PublishedPort: p.public, Protocol: p.type })),
  }));
}

export function dockerStacksResult(hostId: string): { stacks: Record<string, unknown>[]; compose: boolean; errors: unknown[] } {
  const host = demoDockerHosts.find((h) => h.id === hostId);
  const groups = new Map<string, DemoDockerContainer[]>();
  for (const c of demoDockerContainers) {
    if (c.host_id !== hostId || !c.project) continue;
    const list = groups.get(c.project) ?? [];
    list.push(c);
    groups.set(c.project, list);
  }
  const stacks = [...groups.entries()].map(([project, list]) => {
    const stack: Record<string, unknown> = { project, containers: list.map(dockerContainerWire) };
    if (host?.compose) stack.ps = dockerComposePsFor(project, list);
    return stack;
  });
  return { stacks, compose: host?.compose ?? false, errors: [] };
}

/** Mutates demo state so container action mutations are visible in the next
 * query (start -> running, stop -> exited, restart -> running); pull_recreate
 * additionally flips this container's update status back to "current". */
export function applyDockerContainerAction(c: DemoDockerContainer, action: string): Record<string, unknown> {
  if (action === "start" || action === "restart") {
    c.state = "running";
    c.status = statusTextFor("running", c.health, 0);
    return { action, container_id: c.id };
  }
  if (action === "stop") {
    c.state = "exited";
    c.health = null;
    c.status = statusTextFor("exited", null, 0);
    return { action, container_id: c.id };
  }
  if (action === "pull_recreate") {
    const entry = demoDockerUpdates.get(c.id);
    const wasOutdated = entry?.status === "outdated";
    if (entry) {
      entry.status = "current";
      entry.local_digest = entry.remote_digest || entry.local_digest;
    }
    c.state = "running";
    c.health = c.health ? "healthy" : null;
    c.status = statusTextFor("running", c.health, 0);
    return { updated: wasOutdated ?? false, digest: entry?.remote_digest ?? "", container_id: c.id };
  }
  return { action, container_id: c.id };
}

/** Mutates every container of the stack in place for `up`/`restart` (matches
 * the real ComposeRunner semantics closely enough for the demo); `pull` is a
 * read-only dry run that reports success without touching container state. */
export function applyDockerStackAction(hostId: string, project: string, action: string): { stdout: string; stderr: string } {
  const containers = demoDockerContainers.filter((c) => c.host_id === hostId && c.project === project);
  if (action === "up" || action === "restart") {
    for (const c of containers) {
      c.state = "running";
      c.status = statusTextFor("running", c.health, 0);
    }
  }
  const verb = action === "pull" ? "Pulling" : action === "up" ? "Starting" : "Restarting";
  const lines = containers.map((c) => `${verb.toLowerCase()} ${c.service || c.name} ... done`);
  return { stdout: `${verb} ${project}\n${lines.join("\n")}`, stderr: "" };
}

export { findDockerContainer, DOCKER_UNREACHABLE_HOST_ID };

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const DEMO_TOKEN = "demo-session-token";
export const DEMO_USERNAME = "demo";
