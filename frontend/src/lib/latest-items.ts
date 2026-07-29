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
