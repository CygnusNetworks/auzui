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
    items: item ? [{ itemid: item.itemid, key_: item.key_, name: item.name, value_type: item.value_type }] : [],
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
    const no = String(idx + 1);
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
      key_: webTestStepKey("time", spec.name, no),
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
      key_: webTestStepKey("rspcode", spec.name, no),
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
// Auth
// ---------------------------------------------------------------------------

export const DEMO_TOKEN = "demo-session-token";
export const DEMO_USERNAME = "demo";
