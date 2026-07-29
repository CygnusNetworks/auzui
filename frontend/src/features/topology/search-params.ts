/** Mirrors features/explorer/search-params.ts's style: a defensive validator for router search state. */
export interface TopologySearch {
  /** "map" switches to the Geomap-Modus; absent/anything else = Graph. */
  view?: "map";
}

export function validateTopologySearch(search: Record<string, unknown>): TopologySearch {
  return { view: search.view === "map" ? "map" : undefined };
}
