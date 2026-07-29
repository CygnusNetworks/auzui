/**
 * Auto-Dashboard-Engine (PLAN.md Phase 2, Abschnitt D) — reine Funktionen,
 * kein Netzwerkzugriff. Aus host.get/item.get/trigger.get wird ein
 * deterministisches Sektionen-Layout für den Host Deep-Dive gebaut, ohne
 * dass je eine Dashboard-Config gelesen oder geschrieben wird.
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
  { re: /^system\.cpu\./, section: "cpu", viz: "line" },
  { re: /^vm\.memory\./, section: "memory", viz: "line" },
  { re: /^proc\./, section: "process", viz: "line" },
  { re: /^sensor\./, section: "sensor", viz: "line" },
];

/** units → viz, PLAN.md D.2: bps/Bps→area, %→line (0-100), B→capacity, s→line, °C→line, uptime→counter. */
function vizFromUnit(units: string | undefined): ItemViz | undefined {
  const unit = (units ?? "").trim();
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
  const unit = (units ?? "").trim();
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
  /** 1 Item normally; 2 for an in/out interface pair. */
  items: ZabbixItem[];
  /** Per-series label, aligned with `items` (only meaningful when items.length > 1). */
  seriesLabels: string[];
  thresholds: TimeChartThreshold[];
}

export interface DashboardSection {
  section: string;
  charts: DashboardChart[];
}

export interface Dashboard {
  sections: DashboardSection[];
  /** value_type 1/2/4 items — rendered as a Key/Value "Status" list, no chart. */
  textItems: ZabbixItem[];
  generatedFromItemCount: number;
}

function ifaceSeriesLabel(item: ZabbixItem): string {
  if (item.key_.startsWith("net.if.in")) return "in";
  if (item.key_.startsWith("net.if.out")) return "out";
  return item.name;
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

function rolePriority(host: Pick<ZabbixHost, "parentTemplates">): string[] {
  const names = (host.parentTemplates ?? []).map((t) => t.name).join(" ").toLowerCase();
  if (/docker/.test(names)) return ["container"];
  if (/switch|snmp/.test(names)) return ["network"];
  if (/linux/.test(names)) return ["cpu", "memory", "storage", "network"];
  return [];
}

function orderSections(sectionNames: string[], priority: string[]): string[] {
  const rest = sectionNames.filter((s) => s !== NO_COMPONENT_SECTION && !priority.includes(s)).sort();
  const prioritized = priority.filter((s) => sectionNames.includes(s));
  const ordered = [...prioritized, ...rest];
  if (sectionNames.includes(NO_COMPONENT_SECTION)) ordered.push(NO_COMPONENT_SECTION);
  return ordered;
}

/**
 * Baut das deterministische Auto-Dashboard: Sektionen je component-Klasse,
 * Rollen-Preset aus den Host-Templates, Interface-Items zu Multi-Serien-
 * Charts gruppiert, Schwellwerte aus Triggern, max MAX_CHARTS_PER_SECTION
 * Charts sichtbar (Rest bleibt in `charts`, die UI blendet ab dem Limit ein
 * "N weitere anzeigen" ein statt hier schon zu kappen — reine Funktion, keine
 * UI-Zustände).
 */
export function buildDashboard(
  host: Pick<ZabbixHost, "parentTemplates">,
  items: ZabbixItem[],
  triggers: ZabbixTrigger[],
): Dashboard {
  const textItems = items.filter(isTextItem);
  const numericItems = items.filter(isNumericItem);

  const ifaceItems = numericItems.filter((i) => i.tags?.some((t) => t.tag === "interface"));
  const plainItems = numericItems.filter((i) => !i.tags?.some((t) => t.tag === "interface"));

  const bySection = new Map<string, DashboardChart[]>();

  function pushChart(section: string, chart: DashboardChart) {
    const list = bySection.get(section);
    if (list) list.push(chart);
    else bySection.set(section, [chart]);
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

  for (const item of plainItems) {
    const { section, viz } = classifyItem(item);
    pushChart(section, {
      id: item.itemid,
      title: item.name,
      viz,
      items: [item],
      seriesLabels: [item.name],
      thresholds: extractThresholds(triggers, item.itemid),
    });
  }

  const priority = rolePriority(host);
  const orderedSectionNames = orderSections([...bySection.keys()], priority);

  const sections: DashboardSection[] = orderedSectionNames.map((section) => ({
    section,
    charts: [...bySection.get(section)!].sort((a, b) => a.title.localeCompare(b.title)),
  }));

  return {
    sections,
    textItems,
    generatedFromItemCount: items.length,
  };
}
