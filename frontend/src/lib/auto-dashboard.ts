/**
 * Auto-Dashboard-Engine (PLAN.md Phase 2, Abschnitt D) — reine Funktionen,
 * kein Netzwerkzugriff. Aus host.get/item.get/trigger.get wird ein
 * deterministisches Sektionen-Layout für den Host Deep-Dive gebaut, ohne
 * dass je eine Dashboard-Config gelesen oder geschrieben wird.
 *
 * Konsolidierungs-Pipeline (viele Items → wenige Charts), in Reihenfolge:
 *  1. Text-/Boolean-Items landen in der Status-Sektion (kein Chart).
 *  2. Interface-getaggte Items werden je Interface zu einem 2-Serien-Chart
 *     (in/out) gruppiert — ein Chart pro physischem Port/NIC.
 *  3. Feste semantische Bündel (CPU-Util-Aufschlüsselung, Load, Memory)
 *     schlagen zu, bevor irgendetwas anderes die Items sieht.
 *  4. Was übrig bleibt, geht durch die generische Instanz-Familien-Bildung:
 *     Richtungspaare (in/out, rx/tx, …) verschmelzen zu einer Instanz,
 *     Instanzen mit gleichem Namensstamm/gleicher Unit aber unterschiedlichen
 *     LLD-Parametern (Container, Mounts, Cores, Sensoren) verschmelzen zu
 *     einem Multi-Serien-Chart, oben gedeckelt bei MAX_CHARTS_PER_SECTION.
 */
import type { ZabbixHost, ZabbixItem, ZabbixTrigger } from "@auzui/zabbix-client";
import type { TimeChartThreshold } from "../components/charts/TimeChart";
import { NO_COMPONENT_SECTION, isNumericItem, isTextItem } from "./latest-items";

export type ItemViz = "area" | "line" | "gauge" | "capacity" | "counter";

export interface ItemClassification {
  section: string;
  viz: ItemViz;
}

/** Max charts shown per section before collapsing the rest behind "N weitere anzeigen". */
export const MAX_CHARTS_PER_SECTION = 8;

/** Key-Pattern-Fallback aus PLAN.md D.1 — Reihenfolge ist die Prüfreihenfolge. */
const KEY_PATTERN_SECTIONS: { re: RegExp; section: string; viz: ItemViz }[] = [
  { re: /^net\.if\./, section: "network", viz: "area" },
  { re: /^vfs\.fs\./, section: "storage", viz: "capacity" },
  { re: /^vfs\.dev\./, section: "storage", viz: "line" },
  { re: /^system\.cpu\./, section: "cpu", viz: "line" },
  { re: /^vm\.memory\./, section: "memory", viz: "line" },
  { re: /^proc\./, section: "process", viz: "line" },
  { re: /^sensor\./, section: "sensor", viz: "line" },
];

/** Strips a Zabbix "!" literal-unit prefix so classification sees the real unit. */
function bareUnit(units: string | undefined): string {
  const u = (units ?? "").trim();
  return u.startsWith("!") ? u.slice(1).trim() : u;
}

/** units → viz, PLAN.md D.2: bps/Bps→area, %→line (0-100), B→capacity, s→line, °C→line, uptime→counter. */
function vizFromUnit(units: string | undefined): ItemViz | undefined {
  const unit = bareUnit(units);
  if (unit === "bps" || unit === "Bps") return "area";
  if (unit === "%") return "line";
  if (unit === "B") return "capacity";
  if (unit === "s" || unit === "ms") return "line";
  if (unit === "°C" || unit === "C") return "line";
  if (unit === "uptime") return "counter";
  return undefined;
}

/** units → ein sektionsartiger Fallback-Name, falls nichts anderes vorliegt. */
function sectionFromUnit(units: string | undefined): string | undefined {
  const unit = bareUnit(units);
  if (unit === "°C" || unit === "C") return "temperature";
  if (unit === "uptime") return "system";
  return undefined;
}

/**
 * Klassifiziert ein Item nach PLAN.md D.1: component-Tag → units → key_-Pattern.
 * Der Tag gewinnt für den Sektionsnamen immer; die Visualisierung richtet
 * sich weiterhin primär nach der Unit (auch bei getaggten Items), mit dem
 * Key-Pattern als letztem Fallback.
 */
export function classifyItem(item: Pick<ZabbixItem, "key_" | "units" | "tags">): ItemClassification {
  const tag = item.tags?.find((t) => t.tag === "component");
  const keyMatch = KEY_PATTERN_SECTIONS.find((p) => p.re.test(item.key_));
  const unitViz = vizFromUnit(item.units);

  if (tag?.value) {
    return { section: tag.value, viz: unitViz ?? keyMatch?.viz ?? "line" };
  }

  const unitSection = sectionFromUnit(item.units);
  if (unitSection) {
    return { section: unitSection, viz: unitViz ?? "line" };
  }

  if (keyMatch) {
    return { section: keyMatch.section, viz: unitViz ?? keyMatch.viz };
  }

  return { section: NO_COMPONENT_SECTION, viz: unitViz ?? "line" };
}

function severityFromPriority(priority: string): NonNullable<TimeChartThreshold["severity"]> {
  const n = Number(priority);
  if (n >= 4) return "high";
  if (n === 3) return "avg";
  if (n === 2) return "warn";
  return "info";
}

/** `max(/host/key,10m)>75` → operator + value; also matches `<`, `<=`, `>=`. */
const THRESHOLD_RE = /([<>]=?)\s*(-?[\d.]+)/;

/**
 * Extrahiert Schwellwerte aus trigger.get (expandExpression:true) für ein
 * bestimmtes Item — PLAN.md D.3. Trigger→Item-Zuordnung über trigger.items;
 * pro passendem Trigger wird der erste Vergleichsoperator in der
 * (expandierten) Expression als Schwellwert übernommen, die Severity kommt
 * aus trigger.priority.
 */
export function extractThresholds(triggers: ZabbixTrigger[], itemid: string): TimeChartThreshold[] {
  const thresholds: TimeChartThreshold[] = [];
  for (const trigger of triggers) {
    if (!trigger.items?.some((i) => i.itemid === itemid)) continue;
    const match = THRESHOLD_RE.exec(trigger.expression);
    if (!match) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    thresholds.push({
      value,
      label: trigger.description,
      severity: severityFromPriority(trigger.priority),
    });
  }
  return thresholds;
}

export interface DashboardChart {
  id: string;
  title: string;
  viz: ItemViz;
  /** 1 Item normally; 2+ for a direction pair or an instance-family chart. */
  items: ZabbixItem[];
  /** Per-series label, aligned with `items` (only meaningful when items.length > 1). */
  seriesLabels: string[];
  thresholds: TimeChartThreshold[];
}

export interface DashboardSection {
  section: string;
  charts: DashboardChart[];
  /** Sections that should render collapsed on first paint (the noisy "container" section). */
  defaultCollapsed?: boolean;
}

export interface Dashboard {
  sections: DashboardSection[];
  /** value_type 1/2/4 items plus boolean/state value_type 3 items — rendered as a Key/Value "Status" list, no chart. */
  textItems: ZabbixItem[];
  generatedFromItemCount: number;
}

// ---------------------------------------------------------------------------
// Key parsing (PLAN.md D.1: parseItemKey)
// ---------------------------------------------------------------------------

export interface ParsedItemKey {
  /** The key_ up to (excluding) the first "[". */
  base: string;
  /** CSV-aware params from inside "[...]" — respects quoted strings and nested brackets. Empty when there's no "[...]". */
  params: string[];
}

/**
 * Splits a Zabbix item key_ into its base (`net.if.in` from `net.if.in[eth0]`)
 * and its params. Param splitting is CSV-aware: quoted strings (with
 * backslash-escaped quotes) protect embedded commas, and bracket depth is
 * tracked so a nested `[...]` inside a param doesn't split early.
 */
export function parseItemKey(key_: string): ParsedItemKey {
  const bracketIdx = key_.indexOf("[");
  if (bracketIdx === -1 || !key_.endsWith("]")) {
    return { base: key_, params: [] };
  }
  const base = key_.slice(0, bracketIdx);
  const inner = key_.slice(bracketIdx + 1, -1);

  const params: string[] = [];
  let current = "";
  let depth = 0;
  let inQuotes = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (inQuotes) {
      if (c === "\\" && inner[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        continue;
      }
      current += c;
      continue;
    }
    if (c === '"' && current === "") {
      inQuotes = true;
      continue;
    }
    if (c === "[") {
      depth++;
      current += c;
      continue;
    }
    if (c === "]") {
      depth--;
      current += c;
      continue;
    }
    if (c === "," && depth === 0) {
      params.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  params.push(current);
  return { base, params };
}

// ---------------------------------------------------------------------------
// Direction pairing (PLAN.md D.2: pairKey)
// ---------------------------------------------------------------------------

const DIRECTION_WORDS = new Set([
  "in",
  "out",
  "rx",
  "tx",
  "read",
  "write",
  "sent",
  "received",
  "recv",
  "down",
  "up",
]);

/**
 * Normalizes a key base by replacing a direction word (in|out|rx|tx|read|
 * write|sent|received|recv|down|up) in its *last* dot-separated component
 * with "⇄" — matched as a whole underscore-delimited segment so
 * `docker.networks.rx_bytes` → `docker.networks.⇄_bytes` without touching
 * "bytes". Items whose pairKey and params match are the two directions of
 * the same pair. Returns `base` unchanged when no direction word is found.
 */
export function pairKey(base: string): string {
  const parts = base.split(".");
  const last = parts[parts.length - 1] ?? "";
  const segs = last.split("_");
  let found = false;
  const newSegs = segs.map((seg) => {
    if (!found && DIRECTION_WORDS.has(seg.toLowerCase())) {
      found = true;
      return "⇄";
    }
    return seg;
  });
  if (!found) return base;
  parts[parts.length - 1] = newSegs.join("_");
  return parts.join(".");
}

/** Returns the direction word matched by `pairKey` (lowercased), or undefined if there is none. */
export function directionLabel(base: string): string | undefined {
  const last = base.split(".").pop() ?? "";
  for (const seg of last.split("_")) {
    if (DIRECTION_WORDS.has(seg.toLowerCase())) return seg.toLowerCase();
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Boolean/state items (PLAN.md D.6)
// ---------------------------------------------------------------------------

const BOOLEAN_KEY_WORDS = new Set(["state", "status", "paused", "running"]);

/**
 * PLAN.md D.6: value_type 3 (uint) items whose key_ has a "state"/"status"/
 * "paused"/"running" path component (e.g. docker.container_info.state.paused)
 * are 0/1 booleans, not chart-worthy history — they belong in the Status
 * Key/Value section instead. Pure key heuristic, no lastvalue-magic.
 */
export function isBooleanStateItem(item: Pick<ZabbixItem, "key_" | "value_type">): boolean {
  if (item.value_type !== "3") return false;
  const { base } = parseItemKey(item.key_);
  return base.split(".").some((seg) => BOOLEAN_KEY_WORDS.has(seg.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Semantic bundles (PLAN.md D.5) — fixed rule table, data not code-per-case.
// ---------------------------------------------------------------------------

interface SemanticBundleRule {
  id: string;
  title: string;
  test: (base: string, params: string[]) => boolean;
  /** Returns the series label, or undefined to drop the item entirely (e.g. cpu "idle"). */
  seriesLabel: (base: string, params: string[]) => string | undefined;
}

const CPU_TYPE_LABELS: Record<string, string> = {
  user: "User",
  system: "System",
  iowait: "IO Wait",
  steal: "Steal",
  nice: "Nice",
  softirq: "SoftIRQ",
  interrupt: "Interrupt",
};

const MEMORY_TYPE_LABELS: Record<string, string> = {
  available: "Available",
  total: "Total",
  used: "Used",
  free: "Free",
  shared: "Shared",
  buffers: "Buffers",
  cached: "Cached",
};

const SEMANTIC_BUNDLE_RULES: SemanticBundleRule[] = [
  {
    id: "cpu-util",
    title: "CPU Utilization",
    // Requires the type param (system.cpu.util[,user]) — a bare/percpu-index
    // form with a single param isn't a type breakdown, leave it as-is.
    test: (base, params) => base === "system.cpu.util" && params.length >= 2,
    seriesLabel: (_base, params) => {
      const type = (params[1] ?? params[0] ?? "").trim().toLowerCase();
      if (!type || type === "idle") return undefined;
      return CPU_TYPE_LABELS[type] ?? type;
    },
  },
  {
    id: "load",
    title: "Load",
    test: (base) => base === "system.cpu.load" || base === "system.load",
    seriesLabel: (_base, params) => {
      const avg = params.find((p) => /^avg\d+$/i.test(p.trim()));
      return (avg ?? params[params.length - 1] ?? "Load").trim();
    },
  },
  {
    id: "memory",
    title: "Memory",
    test: (base, params) => base === "vm.memory.size" && !/^p(available|used)$/i.test((params[0] ?? "").trim()),
    seriesLabel: (_base, params) => {
      const type = (params[0] ?? "").trim().toLowerCase();
      return MEMORY_TYPE_LABELS[type] ?? params[0] ?? "Memory";
    },
  },
  {
    id: "memory-percent",
    title: "Memory %",
    test: (base, params) => base === "vm.memory.size" && /^p(available|used)$/i.test((params[0] ?? "").trim()),
    seriesLabel: (_base, params) => ((params[0] ?? "").trim().toLowerCase() === "pavailable" ? "Available %" : "Used %"),
  },
];

/**
 * Applies the fixed semantic-bundle rule table (PLAN.md D.5): known
 * multi-instance key families (CPU util breakdown, load averages, memory
 * size breakdown) collapse into one chart each, grouped additionally by
 * section so a component-tag override still lands the bundle in the right
 * place. Items matched by a rule but whose seriesLabel returns undefined
 * (cpu "idle") are still consumed — dropped entirely, not charted and not
 * left for the later instance-family grouping stage.
 */
function applySemanticBundles(
  items: ZabbixItem[],
  triggers: ZabbixTrigger[],
): { chartsBySection: Map<string, DashboardChart[]>; consumedIds: Set<string> } {
  const consumedIds = new Set<string>();
  const groups = new Map<
    string,
    { rule: SemanticBundleRule; section: string; items: ZabbixItem[]; labels: string[] }
  >();

  for (const item of items) {
    const { base, params } = parseItemKey(item.key_);
    const rule = SEMANTIC_BUNDLE_RULES.find((r) => r.test(base, params));
    if (!rule) continue;
    consumedIds.add(item.itemid);
    const label = rule.seriesLabel(base, params);
    if (label === undefined) continue;
    const section = classifyItem(item).section;
    const key = `${rule.id}|${section}`;
    let group = groups.get(key);
    if (!group) {
      group = { rule, section, items: [], labels: [] };
      groups.set(key, group);
    }
    group.items.push(item);
    group.labels.push(label);
  }

  const chartsBySection = new Map<string, DashboardChart[]>();
  for (const group of groups.values()) {
    const chart: DashboardChart = {
      id: `bundle:${group.rule.id}:${group.section}`,
      title: group.rule.title,
      viz: "line",
      items: group.items,
      seriesLabels: group.labels,
      thresholds: group.items.flatMap((it) => extractThresholds(triggers, it.itemid)),
    };
    const list = chartsBySection.get(group.section);
    if (list) list.push(chart);
    else chartsBySection.set(group.section, [chart]);
  }

  return { chartsBySection, consumedIds };
}

// ---------------------------------------------------------------------------
// Instance families (PLAN.md D.3) — direction pairing + LLD-instance grouping.
// ---------------------------------------------------------------------------

interface Instance {
  pairBase: string;
  units: string;
  params: string[];
  items: ZabbixItem[];
  directionLabels: string[];
}

function instanceLastValue(inst: Instance): number {
  let max = 0;
  for (const item of inst.items) {
    const v = Math.abs(Number(item.lastvalue ?? 0));
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

function instanceLabel(inst: Instance): string {
  // Keep the raw params verbatim — do NOT strip a leading "/", or the root
  // mountpoint "/" (vfs.fs.size[/,used]) collapses to an empty label and the
  // instance visually merges with others. Empty params (e.g. an unspecified
  // first CSV field) are dropped, "/" is not empty and stays.
  const parts = inst.params.filter((p) => p.trim() !== "");
  return parts.join(" ") || inst.items[0]!.name;
}

/**
 * Longest common prefix across names, but never cut mid-token. A raw common
 * prefix produces garbage titles like "FS [" (from "FS [/]" + "FS [/var]") or
 * "sd" (from "sda" + "sdb"); when the cut lands inside an alphanumeric run
 * (alnum on both sides of the boundary) the prefix is meaningless, so we fall
 * back to the first full name. Otherwise the prefix is trimmed of trailing
 * separators/brackets. Only used for genuine multi-series family charts —
 * split-per-instance families (filesystems, disks) build their titles from the
 * instance token instead and never reach this.
 */
function commonStem(names: string[]): string {
  if (names.length === 0) return "";
  let len = names[0]!.length;
  for (const name of names.slice(1)) {
    let i = 0;
    while (i < len && i < name.length && names[0]![i] === name[i]) i++;
    len = i;
  }
  const prefix = names[0]!.slice(0, len);
  const before = prefix.slice(-1);
  const after = names.find((n) => n.length > len)?.[len] ?? "";
  const midWord = /[A-Za-z0-9]/.test(before) && /[A-Za-z0-9]/.test(after);
  const trimmed = prefix.replace(/[\s\-:/_[\]().]+$/, "");
  if (midWord || trimmed === "") return names[0]!;
  return trimmed;
}

/**
 * LLD families whose instances are independent resources (each with its own
 * scale and identity) and therefore must get their OWN chart with the full
 * instance name in the title — instead of being overlaid as many series in one
 * shared family chart, which is what produced the "FS ["/"sd" truncated titles
 * and the "/" mountpoint getting merged into a neighbour. `title` builds the
 * chart title from the instance token (the LLD key param, e.g. "/var/lib/x" or
 * "sda"). Deliberately data-not-code so the heuristic is easy to extend.
 */
interface SplitFamily {
  re: RegExp;
  title: (instanceToken: string, repItem: ZabbixItem) => string;
}

const SPLIT_FAMILIES: SplitFamily[] = [
  // Filesystems: keep the mountpoint verbatim (incl. the leading "/").
  { re: /^vfs\.fs\./, title: (tok) => `FS [${tok}]` },
  // Block devices: "vfs.dev.read[sda,…]" → pairBase "vfs.dev.⇄"; drop the "/".
  { re: /^vfs\.dev\./, title: (tok) => `Disk ${tok.replace(/^\//, "")}` },
  // Docker per-container items: the item name ("Container /x: CPU usage") is
  // the clearest title and, sorted, groups all of one container's charts.
  { re: /^docker\.container/, title: (_tok, item) => item.name },
];

function splitFamilyFor(pairBase: string): SplitFamily | undefined {
  return SPLIT_FAMILIES.find((f) => f.re.test(pairBase));
}

/** The LLD instance token of a key's params — the first non-empty param (mountpoint/device/container). */
function instanceToken(params: string[]): string {
  return params.find((p) => p.trim() !== "") ?? "";
}

/** Zabbix Docker-template container items (docker.container_info/_stats[...]) plus tag/name fallbacks. */
const CONTAINER_TAG_VALUES = new Set(["container", "containers"]);

/**
 * Whether an item belongs to a container (Docker) rather than the host itself.
 * On Docker hosts these items number in the hundreds and otherwise flood the
 * core sections; buildDashboard corrals them into one collapsed "container"
 * section. Heuristic (easy to tweak): a `docker.container*` key, or a
 * component tag of container(s), or a "Container <name>" item name.
 */
export function isContainerItem(item: Pick<ZabbixItem, "key_" | "name" | "tags">): boolean {
  const { base } = parseItemKey(item.key_);
  if (/^docker\.container/.test(base)) return true;
  const component = item.tags?.find((t) => t.tag === "component")?.value?.toLowerCase();
  if (component && CONTAINER_TAG_VALUES.has(component)) return true;
  return /\bcontainer\s+\S/i.test(item.name ?? "");
}

/** Section that holds every container chart; ordered after the core sections and collapsed by default. */
export const CONTAINER_SECTION = "container";

/**
 * Groups items that share a base after direction-pair normalization
 * (PLAN.md D.2/D.3): items with the same pairKey+params merge into one
 * "instance" (an in/out or rx/tx pair → 2 series). Instances that
 * additionally share pairKey+units but differ in params (LLD instances —
 * containers, filesystems, cores, sensors) merge further into one
 * multi-series "instance family" chart, capped at MAX_CHARTS_PER_SECTION
 * instances ranked by lastvalue, with the rest noted as "(+N weitere)" in
 * the title. A family with only one instance renders as a plain
 * (optionally 2-series) chart instead of a family chart.
 */
export function buildInstanceFamilyCharts(items: ZabbixItem[], triggers: ZabbixTrigger[]): DashboardChart[] {
  const byInstanceKey = new Map<string, Instance>();
  for (const item of items) {
    const { base, params } = parseItemKey(item.key_);
    const pairBase = pairKey(base);
    const instKey = `${pairBase}${params.join(" ")}`;
    let inst = byInstanceKey.get(instKey);
    if (!inst) {
      inst = { pairBase, units: item.units ?? "", params, items: [], directionLabels: [] };
      byInstanceKey.set(instKey, inst);
    }
    inst.items.push(item);
    inst.directionLabels.push(directionLabel(base) ?? item.name);
  }

  const byFamilyKey = new Map<string, Instance[]>();
  for (const inst of byInstanceKey.values()) {
    const famKey = `${inst.pairBase}${inst.units}`;
    const list = byFamilyKey.get(famKey);
    if (list) list.push(inst);
    else byFamilyKey.set(famKey, [inst]);
  }

  const charts: DashboardChart[] = [];
  for (const [famKey, instances] of byFamilyKey) {
    // Split families (filesystems, disks, containers): one chart per LLD
    // instance (grouped by instance token so a direction pair or a used/total
    // pair on the SAME mountpoint stays together), each with its full name in
    // the title — never overlaid into one truncated-title family chart.
    const split = splitFamilyFor(instances[0]!.pairBase);
    if (split) {
      const byToken = new Map<string, Instance[]>();
      for (const inst of instances) {
        const tok = instanceToken(inst.params);
        const list = byToken.get(tok);
        if (list) list.push(inst);
        else byToken.set(tok, [inst]);
      }
      for (const [tok, tokInstances] of byToken) {
        const chartItems: ZabbixItem[] = [];
        const seriesLabels: string[] = [];
        for (const inst of tokInstances) {
          const paired = inst.items.length > 1;
          const rest = inst.params.filter((p) => p.trim() !== "" && p !== tok);
          inst.items.forEach((it, i) => {
            chartItems.push(it);
            seriesLabels.push(paired ? inst.directionLabels[i]! : rest.join(" ") || it.name);
          });
        }
        const rep = chartItems[0]!;
        charts.push({
          id: `split:${famKey}:${tok}`,
          title: split.title(tok, rep),
          viz: classifyItem(rep).viz,
          items: chartItems,
          seriesLabels,
          thresholds: chartItems.flatMap((it) => extractThresholds(triggers, it.itemid)),
        });
      }
      continue;
    }

    if (instances.length === 1) {
      const inst = instances[0]!;
      const first = inst.items[0]!;
      const paired = inst.items.length > 1;
      charts.push({
        id: first.itemid,
        title: paired ? commonStem(inst.items.map((it) => it.name)) : first.name,
        viz: classifyItem(first).viz,
        items: inst.items,
        seriesLabels: paired ? inst.directionLabels : [first.name],
        thresholds: inst.items.flatMap((it) => extractThresholds(triggers, it.itemid)),
      });
      continue;
    }

    const ranked = [...instances].sort((a, b) => instanceLastValue(b) - instanceLastValue(a));
    const shown = ranked.slice(0, MAX_CHARTS_PER_SECTION);
    const hiddenCount = ranked.length - shown.length;

    const chartItems: ZabbixItem[] = [];
    const seriesLabels: string[] = [];
    for (const inst of shown) {
      const label = instanceLabel(inst);
      inst.items.forEach((it, i) => {
        chartItems.push(it);
        seriesLabels.push(inst.items.length > 1 ? `${label} (${inst.directionLabels[i]})` : label);
      });
    }

    const stem = commonStem(instances.map((inst) => inst.items[0]!.name));
    charts.push({
      id: `family:${famKey}`,
      title: hiddenCount > 0 ? `${stem} (+${hiddenCount} weitere)` : stem,
      viz: classifyItem(shown[0]!.items[0]!).viz,
      items: chartItems,
      seriesLabels,
      thresholds: chartItems.flatMap((it) => extractThresholds(triggers, it.itemid)),
    });
  }
  return charts;
}

// ---------------------------------------------------------------------------
// Interface grouping (PLAN.md D.4)
// ---------------------------------------------------------------------------

function ifaceSeriesLabel(item: ZabbixItem): string {
  const { base } = parseItemKey(item.key_);
  return directionLabel(base) ?? item.name;
}

/** Groups interface-tagged items by their interface name into one multi-series chart per port. */
function groupInterfaceItems(items: ZabbixItem[]): DashboardChart[] {
  const byInterface = new Map<string, ZabbixItem[]>();
  for (const item of items) {
    const iface = item.tags?.find((t) => t.tag === "interface")?.value ?? item.name;
    const list = byInterface.get(iface);
    if (list) list.push(item);
    else byInterface.set(iface, [item]);
  }
  return [...byInterface.entries()].map(([iface, ifaceItems]) => ({
    id: `iface:${iface}`,
    title: `Interface ${iface}`,
    viz: "area" as const,
    items: ifaceItems,
    seriesLabels: ifaceItems.map(ifaceSeriesLabel),
    thresholds: [],
  }));
}

/**
 * PLAN.md D.4: with more than 12 interfaces in a section, interfaces with
 * traffic (any item lastvalue > 0) are sorted first so the section's
 * MAX_CHARTS_PER_SECTION visible slots favor active ports — the rest sit
 * behind the section's existing "N weitere anzeigen" expander. At or below
 * 12 interfaces, alphabetical order is kept. Non-interface charts always
 * sort alphabetically by title after the interface charts.
 */
function sortSectionCharts(charts: DashboardChart[]): DashboardChart[] {
  const ifaceCharts = charts.filter((c) => c.id.startsWith("iface:"));
  const otherCharts = charts
    .filter((c) => !c.id.startsWith("iface:"))
    .sort((a, b) => a.title.localeCompare(b.title));

  if (ifaceCharts.length > 12) {
    const hasTraffic = (c: DashboardChart) => c.items.some((i) => Number(i.lastvalue) > 0);
    ifaceCharts.sort((a, b) => {
      const at = hasTraffic(a);
      const bt = hasTraffic(b);
      if (at !== bt) return at ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
  } else {
    ifaceCharts.sort((a, b) => a.title.localeCompare(b.title));
  }

  return [...ifaceCharts, ...otherCharts];
}

/** Fixed lead order for the core sections, independent of host role (PLAN feedback #4). */
const SECTION_PRIORITY = ["cpu", "memory", "network", "storage"];

/**
 * Maps assorted component-tag / key-derived section names onto the canonical
 * core-section names so the priority order is robust against de/en and
 * abbreviated tag values (net→network, disk/fs→storage, ram→memory, …). Only
 * affects ORDERING; the section keeps its original display name.
 */
const SECTION_ALIASES: Record<string, string> = {
  cpu: "cpu",
  processor: "cpu",
  prozessor: "cpu",
  memory: "memory",
  mem: "memory",
  ram: "memory",
  arbeitsspeicher: "memory",
  network: "network",
  net: "network",
  networking: "network",
  netzwerk: "network",
  storage: "storage",
  disk: "storage",
  disks: "storage",
  fs: "storage",
  filesystem: "storage",
  datentraeger: "storage",
};

function canonicalSection(name: string): string {
  return SECTION_ALIASES[name.toLowerCase()] ?? name.toLowerCase();
}

/**
 * Deterministic section order (PLAN feedback #4): the core sections cpu,
 * memory, network, storage first — always, in that fixed order regardless of
 * host role — then every other section alphabetically (the collapsed
 * "container" section sorts in here by name), with NO_COMPONENT_SECTION
 * ("Sonstige") always pinned last.
 */
export function orderSections(sectionNames: string[]): string[] {
  const rank = new Map(SECTION_PRIORITY.map((s, i) => [s, i]));
  const ordered = sectionNames
    .filter((s) => s !== NO_COMPONENT_SECTION)
    .sort((a, b) => {
      const ra = rank.get(canonicalSection(a)) ?? Number.POSITIVE_INFINITY;
      const rb = rank.get(canonicalSection(b)) ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });
  if (sectionNames.includes(NO_COMPONENT_SECTION)) ordered.push(NO_COMPONENT_SECTION);
  return ordered;
}

/**
 * Baut das deterministische Auto-Dashboard: Text-/Boolean-Items in die
 * Status-Sektion, Interface-Items je Port zu einem 2-Serien-Chart,
 * semantische Bündel (CPU/Load/Memory) vorab konsumiert, alles übrige durch
 * die generische Instanz-Familien-Bildung (Richtungspaare + LLD-Instanzen).
 * Container-Items werden in eine eigene, standardmäßig eingeklappte
 * "container"-Sektion ausgelagert. Sektionen folgen der festen Ordnung
 * cpu/memory/network/storage zuerst, dann alphabetisch (orderSections); Charts
 * je Sektion sind sortiert (Interfaces zuerst, bei vielen davon nach Traffic),
 * max MAX_CHARTS_PER_SECTION sichtbar (Rest bleibt in `charts`, die UI
 * blendet ab dem Limit ein "N weitere anzeigen" ein statt hier schon zu
 * kappen — reine Funktion, keine UI-Zustände).
 */
export function buildDashboard(
  _host: Pick<ZabbixHost, "parentTemplates">,
  items: ZabbixItem[],
  triggers: ZabbixTrigger[],
): Dashboard {
  const textItems = items.filter((i) => isTextItem(i) || isBooleanStateItem(i));
  const numericItems = items.filter((i) => isNumericItem(i) && !isBooleanStateItem(i));

  // Container (Docker) items never mix into the core sections — they get their
  // own collapsed "container" section below, built from the same pipeline.
  const containerItems = numericItems.filter(isContainerItem);
  const hostItems = numericItems.filter((i) => !isContainerItem(i));

  const ifaceItems = hostItems.filter((i) => i.tags?.some((t) => t.tag === "interface"));
  const restItems = hostItems.filter((i) => !i.tags?.some((t) => t.tag === "interface"));

  const { chartsBySection: bundleChartsBySection, consumedIds } = applySemanticBundles(restItems, triggers);
  const plainItems = restItems.filter((i) => !consumedIds.has(i.itemid));

  const bySection = new Map<string, DashboardChart[]>();
  function pushChart(section: string, chart: DashboardChart) {
    const list = bySection.get(section);
    if (list) list.push(chart);
    else bySection.set(section, [chart]);
  }

  for (const [section, charts] of bundleChartsBySection) {
    for (const chart of charts) pushChart(section, chart);
  }

  // Interface items grouped per section (usually all "network", but respect
  // whatever classifyItem says for the first item in the group).
  const ifaceBySection = new Map<string, ZabbixItem[]>();
  for (const item of ifaceItems) {
    const { section } = classifyItem(item);
    const list = ifaceBySection.get(section);
    if (list) list.push(item);
    else ifaceBySection.set(section, [item]);
  }
  for (const [section, sectionIfaceItems] of ifaceBySection) {
    for (const chart of groupInterfaceItems(sectionIfaceItems)) {
      pushChart(section, {
        ...chart,
        thresholds: extractThresholds(triggers, chart.items[0]!.itemid),
      });
    }
  }

  const plainBySection = new Map<string, ZabbixItem[]>();
  for (const item of plainItems) {
    const { section } = classifyItem(item);
    const list = plainBySection.get(section);
    if (list) list.push(item);
    else plainBySection.set(section, [item]);
  }
  for (const [section, sectionItems] of plainBySection) {
    for (const chart of buildInstanceFamilyCharts(sectionItems, triggers)) pushChart(section, chart);
  }

  // All container charts land in one section, grouped/sorted by title (which,
  // for docker items, starts with the container name — see SPLIT_FAMILIES).
  for (const chart of buildInstanceFamilyCharts(containerItems, triggers)) {
    pushChart(CONTAINER_SECTION, chart);
  }

  const orderedSectionNames = orderSections([...bySection.keys()]);

  const sections: DashboardSection[] = orderedSectionNames.map((section) => ({
    section,
    charts: sortSectionCharts(bySection.get(section)!),
    ...(section === CONTAINER_SECTION ? { defaultCollapsed: true } : {}),
  }));

  return {
    sections,
    textItems,
    generatedFromItemCount: items.length,
  };
}
