export interface MetricsSearch {
  /** Comma-separated itemids selected for the compare overlay — teilbar per Link. */
  items?: string;
}

/** Mirrors features/latest-data/search-params.ts's style: a defensive validator for router search state. */
export function validateMetricsSearch(search: Record<string, unknown>): MetricsSearch {
  return { items: typeof search.items === "string" ? search.items : undefined };
}
