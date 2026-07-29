/**
 * Metrik-Browser (PLAN.md Phase 2 / Entwurf 4) — reine Facetten-Ableitung aus
 * bereits geladenen item.get-Ergebnissen, kein Netzwerkzugriff.
 */
import type { ZabbixItem } from "@auzui/zabbix-client";

export interface FacetCount {
  value: string;
  count: number;
}

function deriveFacet(items: ZabbixItem[], pick: (item: ZabbixItem) => string | undefined): FacetCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = pick(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** component-Tag-Werte über die geladenen Items, absteigend nach Häufigkeit. */
export function deriveComponentFacet(items: ZabbixItem[]): FacetCount[] {
  return deriveFacet(items, (item) => item.tags?.find((t) => t.tag === "component")?.value);
}

/** units-Werte über die geladenen Items, absteigend nach Häufigkeit. */
export function deriveUnitFacet(items: ZabbixItem[]): FacetCount[] {
  return deriveFacet(items, (item) => item.units?.trim() || undefined);
}

export interface MetricsFacetSelection {
  component?: string;
  unit?: string;
}

/** Wendet die (clientseitigen) component/unit-Facetten auf bereits geladene Items an. */
export function filterItemsByFacets(items: ZabbixItem[], facets: MetricsFacetSelection): ZabbixItem[] {
  return items.filter((item) => {
    if (facets.component) {
      const tag = item.tags?.find((t) => t.tag === "component")?.value;
      if (tag !== facets.component) return false;
    }
    if (facets.unit && (item.units ?? "").trim() !== facets.unit) return false;
    return true;
  });
}

/** Sucht nur ab 2 Zeichen ODER wenn Host/Gruppe explizit gewählt ist. */
export function shouldSearchItems(query: string, hostId: string | undefined, groupId: string | undefined): boolean {
  return query.trim().length >= 2 || Boolean(hostId) || Boolean(groupId);
}

/** parst ?items=id,id aus der URL in eine geordnete, deduplizierte Liste. */
export function parseItemIds(csv: string | undefined): string[] {
  if (!csv) return [];
  return [...new Set(csv.split(",").map((s) => s.trim()).filter(Boolean))];
}
