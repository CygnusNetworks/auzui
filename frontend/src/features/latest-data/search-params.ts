export interface LatestDataSearch {
  host?: string;
}

/** Mirrors features/problems/search-params.ts's style: a defensive validator for router search state. */
export function validateLatestDataSearch(search: Record<string, unknown>): LatestDataSearch {
  return { host: typeof search.host === "string" ? search.host : undefined };
}
