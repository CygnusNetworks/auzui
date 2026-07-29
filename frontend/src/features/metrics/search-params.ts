export interface MetricsSearch {
  /** Comma-separated itemids selected for the graph tray — teilbar per Link. */
  items?: string;
  /** Raw Query-Bar text (tokens + free text), persisted so the whole search is shareable. */
  q?: string;
}

/** Mirrors features/latest-data/search-params.ts's style: a defensive validator for router search state. */
export function validateMetricsSearch(search: Record<string, unknown>): MetricsSearch {
  return {
    items: typeof search.items === "string" ? search.items : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  };
}
