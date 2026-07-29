/**
 * Zabbix severity model (0..5) and the visual mapping onto the design tokens
 * from docs/design/mock.html. Disaster+High are the "hot" lanes and sort
 * first; lanes are only rendered when non-empty (see ProblemsPage).
 */
import type { Locale } from "./i18n";
import { de } from "../locales/de";
import { en } from "../locales/en";

export type Severity = 0 | 1 | 2 | 3 | 4 | 5;

export const ALL_SEVERITIES: readonly Severity[] = [5, 4, 3, 2, 1, 0];

const SEVERITY_LABEL_CATALOG: Record<Locale, Record<Severity, string>> = {
  de: de.problems.severity,
  en: en.problems.severity,
};

/** Localized severity label (Zabbix's Disaster..Not classified scale). Defaults to "de". */
export function severityLabel(severity: Severity, locale: Locale = "de"): string {
  return SEVERITY_LABEL_CATALOG[locale][severity];
}

/** @deprecated kept for call-sites/tests not yet passing a locale; always German. */
export const SEVERITY_LABEL: Record<Severity, string> = SEVERITY_LABEL_CATALOG.de;

/** Tailwind utility class suffix — maps to the `--color-sev-*` tokens. */
export const SEVERITY_TOKEN: Record<Severity, string> = {
  5: "sev-disaster",
  4: "sev-high",
  3: "sev-avg",
  2: "sev-warn",
  1: "sev-info",
  0: "ink-muted",
};

export function severityFromWire(value: string): Severity {
  const n = Number(value);
  if (n >= 0 && n <= 5) return n as Severity;
  return 0;
}

export function parseSeverities(csv: string | undefined): Severity[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => Number(s))
    .filter((n): n is Severity => n >= 0 && n <= 5);
}

/** Topology filter bar thresholds (PLAN.md: "Alle | Nur Probleme | ≥ Warning | ≥ High"). */
export type SeverityFilter = "all" | "problems" | "warn" | "high";

const SEVERITY_FILTER_LABEL_CATALOG: Record<Locale, Record<SeverityFilter, string>> = {
  de: de.problems.severityFilter,
  en: en.problems.severityFilter,
};

/** Localized severity-filter label. Defaults to "de". */
export function severityFilterLabel(filter: SeverityFilter, locale: Locale = "de"): string {
  return SEVERITY_FILTER_LABEL_CATALOG[locale][filter];
}

/** @deprecated kept for call-sites/tests not yet passing a locale; always German. */
export const SEVERITY_FILTER_LABEL: Record<SeverityFilter, string> = SEVERITY_FILTER_LABEL_CATALOG.de;

const SEVERITY_DOT_TOKEN: Record<number, string> = {
  5: "var(--color-sev-disaster)",
  4: "var(--color-sev-high)",
  3: "var(--color-sev-avg)",
  2: "var(--color-sev-warn)",
  1: "var(--color-sev-info)",
  0: "var(--color-ink-muted)",
};

/** CSS color for a severity dot/marker — undefined (no active problem) renders as the OK token. Shared across topology's cluster list/stage views and the legacy Graph/Map views. */
export function severityDotColor(severity: Severity | undefined): string {
  if (severity === undefined) return "var(--color-sev-ok)";
  return SEVERITY_DOT_TOKEN[severity] ?? "var(--color-sev-ok)";
}

/** `severity` undefined means "no active problem" — only "all" passes those through. */
export function matchesSeverityFilter(severity: Severity | undefined, filter: SeverityFilter): boolean {
  if (filter === "all") return true;
  if (severity === undefined) return false;
  if (filter === "warn") return severity >= 2;
  if (filter === "high") return severity >= 4;
  return true; // "problems": any defined severity
}
