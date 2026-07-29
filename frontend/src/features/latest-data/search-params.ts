export interface LatestDataSearch {
  host?: string;
  /**
   * Selected nav rubric id, e.g. "bundle:load", "family:net-if:eth0",
   * "component:Sonstige", or the pinned "facts" section. Persisted so a
   * reload/shared link keeps the chosen rubric (Entwurf B).
   */
  section?: string;
}

/** Mirrors features/problems/search-params.ts's style: a defensive validator for router search state. */
export function validateLatestDataSearch(search: Record<string, unknown>): LatestDataSearch {
  return {
    host: typeof search.host === "string" ? search.host : undefined,
    section: typeof search.section === "string" ? search.section : undefined,
  };
}
