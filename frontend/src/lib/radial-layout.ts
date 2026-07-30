/**
 * Deterministic radial layout for the Fokus-Bühne (Entwurf 3 "Cluster +
 * Fokus"): the selected cluster's hub sits in the center, its hosts are
 * placed on a circle around it. No force simulation here — angle = index/N,
 * so the layout never "jiggles" and reordering (e.g. more problems arrive)
 * only rotates existing points rather than re-simulating everything.
 *
 * Problem hosts are ordered first (worst severity first), then OK hosts, both
 * clockwise starting at 12 o'clock (PLAN.md: "Problem-Hosts zuerst im
 * Uhrzeigersinn"). Above OK_COLLAPSE_THRESHOLD OK-hosts, the caller collapses
 * the OK tail into a single "+N OK" node (see shouldCollapseOkHosts) —
 * placed as the last point on the circle.
 */
import type { Severity } from "./severity";

/** Above this many OK (problem-free) hosts, collapse them into one "+N OK" node (PLAN.md: "> ~24 OK-Hosts"). */
export const OK_COLLAPSE_THRESHOLD = 24;

export interface RadialLayoutHost {
  id: string;
  severity: Severity | undefined;
}

export interface RadialPosition {
  id: string;
  x: number;
  y: number;
  /** Radians, 0 = 12 o'clock, increasing clockwise (screen space: y-down). */
  angle: number;
}

/**
 * Orders hosts for the circle: defined severity first (worst → mildest),
 * then OK hosts (undefined severity), each group stable on its original
 * relative order (so re-renders with the same input never reshuffle).
 */
export function orderHostsForRadial(hosts: RadialLayoutHost[]): RadialLayoutHost[] {
  const problems = hosts.filter((h) => h.severity !== undefined);
  const ok = hosts.filter((h) => h.severity === undefined);
  problems.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));
  return [...problems, ...ok];
}

/** True once the OK-host count exceeds the collapse threshold — caller replaces the OK tail with one summary node. */
export function shouldCollapseOkHosts(okCount: number, threshold = OK_COLLAPSE_THRESHOLD): boolean {
  return okCount > threshold;
}

/** Lower/upper bound of the circle radius (world units) — see radialRadius. */
export const MIN_RADIAL_RADIUS = 200;
export const MAX_RADIAL_RADIUS = 420;
/** Target arc length between two neighbouring nodes on the circle (world units) — drives radialRadius. */
export const RADIAL_ARC_PER_NODE = 11;

/**
 * Circle radius that scales with the number of visible nodes so neighbours keep
 * ~RADIAL_ARC_PER_NODE of arc between them (r = n·arc / 2π), clamped to
 * [MIN_RADIAL_RADIUS, MAX_RADIAL_RADIUS]. Large clusters get a bigger ring
 * instead of cramming ~200 dots onto a fixed 200px circle. Pure/deterministic.
 */
export function radialRadius(n: number, arcPerNode = RADIAL_ARC_PER_NODE): number {
  const circumferenceBased = (n * arcPerNode) / (2 * Math.PI);
  return Math.max(MIN_RADIAL_RADIUS, Math.min(MAX_RADIAL_RADIUS, circumferenceBased));
}

/** Above this many visible nodes, only problem hosts and the hovered node keep an always-on text label (rest fall back to the hover tooltip). */
export const LABEL_DENSITY_THRESHOLD = 40;

/**
 * Whether a node's always-on text label should be rendered. Below the density
 * threshold everything is labelled; above it only problem hosts and the
 * currently hovered node keep a label so a dense OK ring stops overlapping into
 * an unreadable blob (the name is still available via the hover tooltip). Pure.
 */
export function shouldRenderLabel(params: {
  visibleCount: number;
  hasProblem: boolean;
  isHovered: boolean;
  threshold?: number;
}): boolean {
  const { visibleCount, hasProblem, isHovered, threshold = LABEL_DENSITY_THRESHOLD } = params;
  if (visibleCount <= threshold) return true;
  return hasProblem || isHovered;
}

/** Base outward label distance beyond a node, and the extra offset for odd-indexed nodes (two-ring stagger). */
export const LABEL_RADIUS_OFFSET = 22;
export const LABEL_RADIUS_STAGGER = 16;

/**
 * Extra distance a node's label sits beyond the node itself, alternating
 * between two rings for even/odd indices so adjacent labels no longer land on
 * the same radius and collide. Returns world units (caller divides by scale).
 * Pure/deterministic.
 */
export function labelRadiusOffset(index: number, base = LABEL_RADIUS_OFFSET, stagger = LABEL_RADIUS_STAGGER): number {
  return base + (index % 2 !== 0 ? stagger : 0);
}

/**
 * Computes one point per host on a circle of `radius` around the origin
 * (hub sits at (0,0) — caller translates). Angle = index/N * 2π, offset so
 * index 0 is at 12 o'clock and it proceeds clockwise in SVG's y-down space.
 */
export function computeRadialPositions(ids: string[], radius: number): RadialPosition[] {
  const n = ids.length;
  if (n === 0) return [];
  return ids.map((id, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { id, x: radius * Math.cos(angle), y: radius * Math.sin(angle), angle };
  });
}

/* ------------------------------------------------------------------ *
 * Semantisches Zoom (freigegebener Entwurf für große Cluster)
 *
 * Der Riesen-Cluster „Direkt überwacht" ist problem-dominiert (fast jeder
 * Host trägt ein Low-Severity-Problem), darum greift der reine OK-Collapse
 * dort nicht. Statt dessen bündeln wir Hosts nach Namensfamilie zu
 * Meta-Knoten und koppeln den Detailgrad an den Zoom. Alles hier ist pure,
 * deterministische Logik (unit-getestet); FocusStage.tsx rendert nur.
 * ------------------------------------------------------------------ */

/** Trennzeichen, an denen eine Namensfamilie „abgeschnitten" wird (Präfix bis zum letzten Treffer). */
const NAME_SEPARATORS = new Set(["-", ".", "_"]);
/** Mindestgröße einer Namensfamilie — kleinere Gruppen fallen auf Domain/„Sonstige" zurück. */
export const NAME_FAMILY_MIN_SIZE = 4;
/** i18n-freier Schlüssel der Auffang-Familie; FocusStage mappt ihn auf „Sonstige"/„Other". */
export const MISC_FAMILY_KEY = "__misc__";

export type NameFamilyKind = "prefix" | "domain" | "misc";

export interface FamilyMemberHost {
  id: string;
  label: string;
  severity: Severity | undefined;
}

export interface NameFamily {
  /** Gruppierungsschlüssel: Präfix inkl. Trenner ("vpn-wrt-"), Domain ("stw-bonn.de") oder MISC_FAMILY_KEY. */
  key: string;
  /** Anzeigename für den Meta-Knoten ("vpn-wrt-…", "*.stw-bonn.de"); MISC bleibt als Key und wird vom Aufrufer übersetzt. */
  label: string;
  kind: NameFamilyKind;
  hosts: FamilyMemberHost[];
}

/**
 * Präfix-Kandidaten eines Labels, jeweils inkl. des abschließenden Trenners,
 * von lang nach kurz. "vpn-wrt-01" → ["vpn-wrt-", "vpn-"]. "web01.stw-bonn.de"
 * → ["web01.stw-bonn.", "web01.stw-", "web01."]. Der volle Labelname zählt nie.
 */
function prefixCandidates(label: string): string[] {
  const out: string[] = [];
  for (let i = label.length - 1; i >= 1; i--) {
    if (NAME_SEPARATORS.has(label[i]!)) out.push(label.slice(0, i + 1));
  }
  return out;
}

/** Domain-Suffix = alles nach dem ersten Punkt ("web01.stw-bonn.de" → "stw-bonn.de"); undefined ohne Punkt. */
function domainSuffix(label: string): string | undefined {
  const dot = label.indexOf(".");
  return dot >= 0 && dot < label.length - 1 ? label.slice(dot + 1) : undefined;
}

/**
 * Bündelt Cluster-Hosts nach Namensfamilie (pure, deterministisch):
 *   1. längster gemeinsamer Präfix bis zum letzten Trenner, Mindestgröße `minSize`,
 *   2. Fallback Domain-Suffix (nach dem ersten Punkt), gleiche Mindestgröße,
 *   3. Rest → eine Familie MISC_FAMILY_KEY ("Sonstige").
 * Die Reihenfolge ist severity-unabhängig (Präfix- vor Domain-Familien, je
 * alphabetisch, „Sonstige" zuletzt) — so wandern Familien-Positionen nicht,
 * wenn sich nur Schweregrade ändern (kein Layout-Zappeln). Hosts behalten
 * innerhalb ihrer Familie die Eingabereihenfolge.
 */
export function deriveNameFamilies(hosts: FamilyMemberHost[], minSize = NAME_FAMILY_MIN_SIZE): NameFamily[] {
  // 1) Globale Häufigkeit jedes Präfix-Kandidaten.
  const candidateCount = new Map<string, number>();
  for (const h of hosts) {
    for (const c of prefixCandidates(h.label)) candidateCount.set(c, (candidateCount.get(c) ?? 0) + 1);
  }
  // Vorläufige Zuordnung: längster Kandidat mit globaler Häufigkeit ≥ minSize.
  const tentative = new Map<string, string | undefined>(); // host.id → prefix key
  const prefixGroups = new Map<string, FamilyMemberHost[]>();
  for (const h of hosts) {
    const key = prefixCandidates(h.label).find((c) => (candidateCount.get(c) ?? 0) >= minSize);
    tentative.set(h.id, key);
    if (key) (prefixGroups.get(key) ?? prefixGroups.set(key, []).get(key)!).push(h);
  }

  const prefixFamilies: NameFamily[] = [];
  const leftover: FamilyMemberHost[] = [];
  // Re-Validierung: nur Gruppen die TATSÄCHLICH ≥ minSize Mitglieder gewählt
  // haben werden Familien (verhindert Mini-Gruppen an kurzen Präfixen).
  for (const h of hosts) {
    const key = tentative.get(h.id);
    if (key && (prefixGroups.get(key)?.length ?? 0) >= minSize) continue;
    leftover.push(h);
  }
  for (const [key, members] of prefixGroups) {
    if (members.length >= minSize) prefixFamilies.push({ key, label: `${key}…`, kind: "prefix", hosts: members });
  }

  // 2) Domain-Fallback für den Rest.
  const domainGroups = new Map<string, FamilyMemberHost[]>();
  const misc: FamilyMemberHost[] = [];
  for (const h of leftover) {
    const dom = domainSuffix(h.label);
    if (dom) (domainGroups.get(dom) ?? domainGroups.set(dom, []).get(dom)!).push(h);
    else misc.push(h);
  }
  const domainFamilies: NameFamily[] = [];
  for (const [dom, members] of domainGroups) {
    if (members.length >= minSize) domainFamilies.push({ key: dom, label: `*.${dom}`, kind: "domain", hosts: members });
    else misc.push(...members);
  }

  // 3) „Sonstige".
  prefixFamilies.sort((a, b) => a.key.localeCompare(b.key));
  domainFamilies.sort((a, b) => a.key.localeCompare(b.key));
  const families = [...prefixFamilies, ...domainFamilies];
  if (misc.length > 0) families.push({ key: MISC_FAMILY_KEY, label: MISC_FAMILY_KEY, kind: "misc", hosts: misc });
  return families;
}

/**
 * Ab dieser Severity bleibt ein Host auf JEDER Detail-Ebene ein Einzelpunkt mit
 * Label (Average+, Zabbix ≥ 3). Hosts mit Severity ≤ Warning dürfen in
 * Familien-Meta-Knoten aufgehen — der Meta-Knoten zeigt ihren Schweregrad über
 * Ring + Badge. Genau das ist der Kniff für den problem-dominierten Cluster.
 */
export const FAMILY_STANDALONE_MIN_SEVERITY: Severity = 3;

/** True, wenn `severity` einen Host zum permanenten Einzelpunkt macht (≥ Average). Pure. */
export function staysStandalone(severity: Severity | undefined, min: Severity = FAMILY_STANDALONE_MIN_SEVERITY): boolean {
  return severity !== undefined && severity >= min;
}

export interface SemanticRingEntry {
  kind: "host" | "family";
  /** host.id, bzw. `family:${key}`. */
  id: string;
  /** Nur bei kind === "host": der Einzel-Host (Severity ≥ Average). */
  host?: FamilyMemberHost;
  /** Nur bei kind === "family": die Familie. */
  family?: NameFamily;
  /** Nur bei kind === "family": die vom Meta-Knoten vertretenen (nicht-standalone) Mitglieder. */
  represented?: FamilyMemberHost[];
}

/**
 * Baut die Ebene-1-Ringbelegung: erst alle Standalone-Hosts (Severity ≥
 * Average, schwerste zuerst, stabil), dann je ein Meta-Knoten pro Familie, die
 * noch nicht-standalone Mitglieder hat. Familien deren Mitglieder alle
 * standalone sind erzeugen keinen Meta-Knoten (sie sind schon als Einzelpunkte
 * vertreten). Deterministisch (Familienreihenfolge aus deriveNameFamilies).
 */
export function buildSemanticRing(
  families: NameFamily[],
  minStandaloneSeverity: Severity = FAMILY_STANDALONE_MIN_SEVERITY,
): SemanticRingEntry[] {
  const standalone: FamilyMemberHost[] = [];
  const metaEntries: SemanticRingEntry[] = [];
  for (const family of families) {
    const represented: FamilyMemberHost[] = [];
    for (const h of family.hosts) {
      if (staysStandalone(h.severity, minStandaloneSeverity)) standalone.push(h);
      else represented.push(h);
    }
    if (represented.length > 0) {
      metaEntries.push({ kind: "family", id: `family:${family.key}`, family, represented });
    }
  }
  standalone.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));
  const hostEntries: SemanticRingEntry[] = standalone.map((host) => ({ kind: "host", id: host.id, host }));
  return [...hostEntries, ...metaEntries];
}

/** Schwerste Severity unter den vom Meta-Knoten vertretenen Hosts (für dessen Severity-Ring); undefined = alle OK. */
export function representedWorstSeverity(hosts: FamilyMemberHost[]): Severity | undefined {
  let worst: Severity | undefined;
  for (const h of hosts) if (h.severity !== undefined && (worst === undefined || h.severity > worst)) worst = h.severity;
  return worst;
}

/** Anzahl der vertretenen Hosts mit aktivem Problem (für die Zähler-Badge am Meta-Knoten). */
export function representedProblemCount(hosts: FamilyMemberHost[]): number {
  return hosts.reduce((n, h) => n + (h.severity !== undefined ? 1 : 0), 0);
}

/** Severity-Verteilung (schwerste zuerst) + OK-Anzahl für den Meta-Knoten-Tooltip. Pure. */
export function severityDistribution(hosts: FamilyMemberHost[]): { entries: { severity: Severity; count: number }[]; okCount: number } {
  const counts = new Map<Severity, number>();
  let okCount = 0;
  for (const h of hosts) {
    if (h.severity === undefined) okCount++;
    else counts.set(h.severity, (counts.get(h.severity) ?? 0) + 1);
  }
  const entries = [...counts.entries()]
    .map(([severity, count]) => ({ severity, count }))
    .sort((a, b) => b.severity - a.severity);
  return { entries, okCount };
}

/** Meta-Knoten-Radius (px) ~ √Anzahl, mit Sockel und Deckel. Pure/deterministisch. */
export const META_NODE_MIN_R = 9;
export const META_NODE_MAX_R = 30;
export const META_NODE_R_PER_SQRT = 3.2;
export function metaNodeRadius(count: number, base = META_NODE_MIN_R, perSqrt = META_NODE_R_PER_SQRT, max = META_NODE_MAX_R): number {
  return Math.min(max, base + perSqrt * Math.sqrt(Math.max(0, count)));
}

export type DetailLevel = 1 | 2 | 3;
/** Ab diesem Vielfachen der Fit-Skalierung expandiert die fokussierte Familie (Ebene 2). */
export const DETAIL_LEVEL_2_ZOOM = 1.6;
/** Ab diesem Vielfachen expandieren alle Familien und alle Labels erscheinen (Ebene 3). */
export const DETAIL_LEVEL_3_ZOOM = 4;

/**
 * Detail-Ebene aus dem aktuellen Zoom relativ zur Fit-Skalierung. `scale` und
 * `fitScale` sind absolute Skalierungen (initial.w / viewBox.w); maßgeblich ist
 * ihr Verhältnis. Pure/deterministisch, robust gegen fitScale ≤ 0. */
export function detailLevelForZoom(scale: number, fitScale: number): DetailLevel {
  const rel = Number.isFinite(fitScale) && fitScale > 0 ? scale / fitScale : 1;
  if (rel >= DETAIL_LEVEL_3_ZOOM) return 3;
  if (rel >= DETAIL_LEVEL_2_ZOOM) return 2;
  return 1;
}
