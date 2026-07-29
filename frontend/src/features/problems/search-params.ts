import { ALL_SEVERITIES, parseSeverities, type Severity } from "../../lib/severity";

/** Shape of the Problems page's URL search params — teilbare Filter-Links. */
export interface ProblemsSearch {
  /** Comma-separated severities, e.g. "5,4,3". Absent = all severities. */
  sev?: string;
  /** "0" = also show acknowledged problems; absent/"1" = only unacknowledged (default). */
  unack?: string;
  /** "1" = also show suppressed problems; absent = hide them (default). */
  suppressed?: string;
  /** Selected eventid for the detail panel. */
  event?: string;
  /** Restrict to one host's problems (set by the ⌘K palette). */
  host?: string;
}

export function validateProblemsSearch(search: Record<string, unknown>): ProblemsSearch {
  const result: ProblemsSearch = {};
  if (typeof search.sev === "string") result.sev = search.sev;
  if (typeof search.unack === "string") result.unack = search.unack;
  if (typeof search.suppressed === "string") result.suppressed = search.suppressed;
  if (typeof search.event === "string") result.event = search.event;
  if (typeof search.host === "string") result.host = search.host;
  return result;
}

export function severitiesFromSearch(search: ProblemsSearch): Severity[] {
  return search.sev !== undefined ? parseSeverities(search.sev) : [...ALL_SEVERITIES];
}

export function severitiesToSearchValue(severities: Severity[]): string | undefined {
  if (severities.length === ALL_SEVERITIES.length) return undefined;
  return severities.length > 0 ? severities.join(",") : "none";
}
