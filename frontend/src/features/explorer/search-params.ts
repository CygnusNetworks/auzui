export interface ExplorerSearch {
  /** Selected hostgroup id — presence switches Ebene 1 → Ebene 2. */
  group?: string;
}

/** Mirrors features/latest-data/search-params.ts's style: a defensive validator for router search state. */
export function validateExplorerSearch(search: Record<string, unknown>): ExplorerSearch {
  return { group: typeof search.group === "string" ? search.group : undefined };
}
