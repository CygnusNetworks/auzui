import type { ZabbixHost, ZabbixItem } from "@auzui/zabbix-client";
import { groupItemsByComponent, resolveItemName } from "../latest-items";
import { linuxTemplate } from "./linux";
import { windowsTemplate } from "./windows";
import { switchTemplate } from "./switch";
import type { DisplayTemplate, SectionSeriesItem, SeriesRole, TemplateSection } from "./types";

export * from "./types";
export { linuxTemplate } from "./linux";
export { windowsTemplate } from "./windows";
export { switchTemplate } from "./switch";

/** Built-in templates shipped with auzui, in match-priority order. */
export const DEFAULT_TEMPLATES: DisplayTemplate[] = [linuxTemplate, windowsTemplate, switchTemplate];

/** Minimum key-pattern hit-rate (fraction of a host's items) for the keyPatterns fallback to accept a template. */
const KEY_PATTERN_FALLBACK_THRESHOLD = 0.05;

const roleLabels: Record<SeriesRole, string> = {
  in: "In",
  out: "Out",
  errors: "Errors",
  status: "Status",
  value: "Value",
};

/** Compiles a template's regex string, swallowing invalid patterns (data may come from a future free-text editor). */
function safeRegex(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

/**
 * Picks the display template for a host: first by its Zabbix parent
 * template names (host.get selectParentTemplates), scored by how many of a
 * candidate template's `match.templateNames` patterns hit; falls back to
 * `match.keyPatterns` hit-rate over the host's items when no template name
 * matches (or the host has no parent templates loaded). Returns undefined
 * when nothing clears the fallback threshold — callers then show plain
 * component-tag sections only, same as before this feature existed.
 */
export function resolveTemplate(
  host: Pick<ZabbixHost, "parentTemplates"> | undefined,
  items: ZabbixItem[],
  templates: DisplayTemplate[] = DEFAULT_TEMPLATES,
): DisplayTemplate | undefined {
  const templateNames = host?.parentTemplates?.map((t) => t.name) ?? [];

  if (templateNames.length > 0) {
    let best: { template: DisplayTemplate; score: number } | undefined;
    for (const template of templates) {
      const patterns = template.match.templateNames ?? [];
      const score = patterns.filter((p) => {
        const re = safeRegex(p);
        return re ? templateNames.some((name) => re.test(name)) : false;
      }).length;
      if (score > 0 && (!best || score > best.score)) best = { template, score };
    }
    if (best) return best.template;
  }

  if (items.length === 0) return undefined;

  let best: { template: DisplayTemplate; rate: number } | undefined;
  for (const template of templates) {
    const patterns = (template.match.keyPatterns ?? [])
      .map(safeRegex)
      .filter((re): re is RegExp => re !== undefined);
    if (patterns.length === 0) continue;
    const hits = items.filter((item) => patterns.some((re) => re.test(item.key_))).length;
    const rate = hits / items.length;
    if (rate > 0 && (!best || rate > best.rate)) best = { template, rate };
  }
  if (best && best.rate >= KEY_PATTERN_FALLBACK_THRESHOLD) return best.template;
  return undefined;
}

/**
 * Binds a resolved template's bundles/families onto a host's items, plus a
 * "component" section per PLAN.md's existing groupItemsByComponent for
 * whatever isn't claimed by the template. Each item is bound into at most
 * one section — the first bundle/family match wins, in template
 * declaration order, and everything left over falls through to the
 * component-tag grouping (same behavior as before this feature existed).
 */
export function buildSections(template: DisplayTemplate | undefined, items: ZabbixItem[]): TemplateSection[] {
  const sections: TemplateSection[] = [];
  const claimed = new Set<string>();

  if (template) {
    for (const bundle of template.bundles) {
      const compiled = bundle.items.map((bi) => ({ ...bi, re: safeRegex(bi.keyPattern) }));
      const bound: SectionSeriesItem[] = [];
      for (const item of items) {
        if (claimed.has(item.itemid)) continue;
        const match = compiled.find((c) => c.re?.test(item.key_));
        if (!match) continue;
        bound.push({ item, seriesLabel: match.seriesLabel, displayRole: match.role ?? "line" });
        claimed.add(item.itemid);
      }
      if (bound.length > 0) {
        sections.push({
          id: `bundle:${bundle.id}`,
          kind: "bundle",
          navGroup: bundle.navGroup,
          label: bundle.label,
          items: bound,
        });
      }
    }

    for (const family of template.families) {
      const compiled = family.keyPatterns.map((kp) => ({ ...kp, re: safeRegex(kp.pattern) }));
      const byInstance = new Map<string, SectionSeriesItem[]>();
      for (const item of items) {
        if (claimed.has(item.itemid)) continue;
        for (const kp of compiled) {
          const m = kp.re?.exec(item.key_);
          if (!m) continue;
          const instance = m[1] ?? "";
          const list = byInstance.get(instance) ?? [];
          list.push({
            item,
            seriesLabel: kp.seriesLabel ?? roleLabels[kp.seriesRole],
            seriesRole: kp.seriesRole,
            // Generic: an interface/oper-status series renders as an up/down
            // badge, everything else (in/out/errors/value) as a chart line.
            displayRole: kp.seriesRole === "status" ? "status" : "line",
          });
          byInstance.set(instance, list);
          claimed.add(item.itemid);
          break;
        }
      }
      for (const [instance, bound] of [...byInstance.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        sections.push({
          id: `family:${family.id}:${instance}`,
          kind: "family",
          navGroup: family.navGroup,
          label: family.labelPattern.replace("{instance}", instance),
          items: bound,
        });
      }
    }
  }

  const leftover = items.filter((item) => !claimed.has(item.itemid));
  for (const { component, items: componentItems } of groupItemsByComponent(leftover)) {
    sections.push({
      id: `component:${component}`,
      kind: "component",
      navGroup: component,
      label: component,
      items: componentItems.map((item) => ({ item, seriesLabel: resolveItemName(item) })),
    });
  }

  return sections;
}
