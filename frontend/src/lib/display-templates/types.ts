/**
 * Data model for "Anzeige-Templates" (display templates) — the Latest-Data
 * page's Entwurf B "Komponenten-Navigator" groups items into consolidated
 * multi-series bundles/families instead of one row per item. Templates are
 * intentionally pure data (no functions, no regex objects — everything is a
 * string) so they could be lifted 1:1 into YAML/JSON once real editing
 * lands; regex strings are compiled by the engine in ./index.ts.
 */

/** What a family key-pattern's matched series represents, for chart/legend styling. */
export type SeriesRole = "in" | "out" | "errors" | "dropped" | "status" | "value";

/**
 * How a bound item is rendered inside a consolidated panel:
 * - "line"   → a series line in the shared chart (default),
 * - "stat"   → a compact value/percent tile beside the chart (e.g. packet loss %),
 * - "status" → an up/down badge from a 0/1 value (e.g. ping / interface status).
 * Generic across templates (bundles and families) so e.g. the ICMP bundle and
 * an interface family can both surface status/percent items without a line.
 */
export type DisplayRole = "line" | "stat" | "status";

export interface DisplayBundleItem {
  /** Regex (as a plain string, no delimiters) tested against item.key_. */
  keyPattern: string;
  /** Legend/series label for this item within the bundle's consolidated chart. */
  seriesLabel: string;
  /** Panel rendering for this item; defaults to "line" when omitted. */
  role?: DisplayRole;
}

export interface DisplayBundle {
  id: string;
  label: string;
  /** Top-level nav group this bundle nests under, e.g. "System", "Netzwerk". */
  navGroup: string;
  items: DisplayBundleItem[];
}

export interface DisplayFamilyKeyPattern {
  /** Regex (as a plain string) tested against item.key_; capture group 1 = instance name (interface, mountpoint, …). */
  pattern: string;
  seriesRole: SeriesRole;
  /** Overrides the default role-based series label (e.g. "Free" instead of the generic "Value"). */
  seriesLabel?: string;
  /**
   * Overrides the panel rendering role. Defaults (in the engine) to "status"
   * for seriesRole "status", "line" otherwise. Set e.g. "stat" for
   * errors/dropped counters that are almost always 0 and are more useful as a
   * compact color-coded tile than as a flat line in the interface's chart.
   */
  displayRole?: DisplayRole;
}

export interface DisplayFamily {
  id: string;
  /** Section label per matched instance; "{instance}" is replaced with the captured name, e.g. "Interface {instance}". */
  labelPattern: string;
  /** Top-level nav group this family's instances nest under, e.g. "Netzwerk", "Storage". */
  navGroup: string;
  keyPatterns: DisplayFamilyKeyPattern[];
}

export interface DisplayTemplateMatch {
  /** Regex strings tested against the host's Zabbix parent template names (host.get selectParentTemplates). */
  templateNames?: string[];
  /** Fallback when no parent template matches: regex strings tested against item key_s, scored by hit-rate. */
  keyPatterns?: string[];
}

export interface DisplayTemplate {
  id: string;
  label: string;
  match: DisplayTemplateMatch;
  bundles: DisplayBundle[];
  families: DisplayFamily[];
}

export type SectionKind = "bundle" | "family" | "component" | "facts";

/** One item bound into a section, with the label/role it takes in that section's chart+legend. */
export interface SectionSeriesItem {
  item: import("@auzui/zabbix-client").ZabbixItem;
  seriesLabel: string;
  seriesRole?: SeriesRole;
  /** Panel rendering role (line/stat/status); defaults to "line" at render time. */
  displayRole?: DisplayRole;
}

export interface TemplateSection {
  /** Stable id for URL persistence, e.g. "bundle:load", "family:net-if:eth0", "component:Sonstige". */
  id: string;
  kind: SectionKind;
  navGroup: string;
  label: string;
  items: SectionSeriesItem[];
}
