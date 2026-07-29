/**
 * Zabbix severity model (0..5) and the visual mapping onto the design tokens
 * from docs/design/mock.html. Disaster+High are the "hot" lanes and sort
 * first; lanes are only rendered when non-empty (see ProblemsPage).
 */

export type Severity = 0 | 1 | 2 | 3 | 4 | 5;

export const ALL_SEVERITIES: readonly Severity[] = [5, 4, 3, 2, 1, 0];

export const SEVERITY_LABEL: Record<Severity, string> = {
  5: "Disaster",
  4: "High",
  3: "Average",
  2: "Warning",
  1: "Info",
  0: "Not classified",
};

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

export const SEVERITY_FILTER_LABEL: Record<SeverityFilter, string> = {
  all: "Alle",
  problems: "Nur Probleme",
  warn: "≥ Warning",
  high: "≥ High",
};

/** `severity` undefined means "no active problem" — only "all" passes those through. */
export function matchesSeverityFilter(severity: Severity | undefined, filter: SeverityFilter): boolean {
  if (filter === "all") return true;
  if (severity === undefined) return false;
  if (filter === "warn") return severity >= 2;
  if (filter === "high") return severity >= 4;
  return true; // "problems": any defined severity
}
