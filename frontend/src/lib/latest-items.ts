import type { ZabbixItem } from "@auzui/zabbix-client";

export const NO_COMPONENT_SECTION = "Sonstige";

/** value_type 0 (float) / 3 (uint) — sparkline-eligible, numeric history. */
export function isNumericItem(item: Pick<ZabbixItem, "value_type">): boolean {
  return item.value_type === "0" || item.value_type === "3";
}

/** value_type 1 (char) / 2 (log) / 4 (text) — shown without a sparkline. */
export function isTextItem(item: Pick<ZabbixItem, "value_type">): boolean {
  return item.value_type === "1" || item.value_type === "2" || item.value_type === "4";
}

/**
 * Removes unresolved Zabbix macro tokens (e.g. `{#IFNAME}`, `{HOST.NAME}`,
 * `{$USERMACRO}`) from an item name and tidies the whitespace/punctuation they
 * leave behind, so a name like "Interface {#IFNAME}: Bits received" degrades to
 * "Interface: Bits received" instead of showing the raw macro. Used only as a
 * fallback when Zabbix 7.x's server-resolved `name_resolved` is unavailable.
 */
export function stripUnresolvedMacros(name: string): string {
  return name
    .replace(/\{[^{}]*\}/g, "")
    .replace(/\s+([:,.)\]])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Display name for an item: Zabbix 7.0+ resolves LLD/host/user macros
 * server-side into `name_resolved` — prefer it; otherwise fall back to `name`
 * with any still-unresolved `{…}` macros stripped (see stripUnresolvedMacros).
 */
export function resolveItemName(item: Pick<ZabbixItem, "name" | "name_resolved">): string {
  const resolved = item.name_resolved?.trim();
  if (resolved) return resolved;
  return stripUnresolvedMacros(item.name);
}

export interface ComponentSection {
  component: string;
  items: ZabbixItem[];
}

/**
 * Groups items by their "component" tag (the LLD-driven classification
 * signal from PLAN.md — practically on every item in a real instance);
 * items without that tag land in NO_COMPONENT_SECTION. Sections are sorted
 * alphabetically except "Sonstige", which always sorts last.
 */
export function groupItemsByComponent(items: ZabbixItem[]): ComponentSection[] {
  const byComponent = new Map<string, ZabbixItem[]>();
  for (const item of items) {
    const tag = item.tags?.find((t) => t.tag === "component");
    const key = tag?.value || NO_COMPONENT_SECTION;
    const list = byComponent.get(key);
    if (list) list.push(item);
    else byComponent.set(key, [item]);
  }
  return [...byComponent.entries()]
    .sort(([a], [b]) => {
      if (a === NO_COMPONENT_SECTION) return 1;
      if (b === NO_COMPONENT_SECTION) return -1;
      return a.localeCompare(b);
    })
    .map(([component, sectionItems]) => ({ component, items: sectionItems }));
}
