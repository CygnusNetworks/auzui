/**
 * Mirrors features/explorer/search-params.ts's style: a defensive validator
 * for router search state. Redesign "Cluster + Fokus": three evidence tabs
 * (+ optional Geomap) instead of a graph/map switch, plus the selected
 * cluster so a focus view is shareable/bookmarkable. Deliberately named
 * `tab`/`cluster` (not `sev`) — the Problems page already owns `sev` and the
 * two must not collide when navigating between pages.
 */
export type TopologyTab = "maps" | "l3" | "proxies" | "geo";

export interface TopologySearch {
  /** Defaults to "maps" (Zabbix-Maps) when absent/invalid. */
  tab?: TopologyTab;
  /** Selected cluster id within the current tab, e.g. "subnet:10.0.0.0/24", "proxy:5", "map:10". */
  cluster?: string;
}

const VALID_TABS: TopologyTab[] = ["maps", "l3", "proxies", "geo"];

export function validateTopologySearch(search: Record<string, unknown>): TopologySearch {
  const tab = VALID_TABS.includes(search.tab as TopologyTab) ? (search.tab as TopologyTab) : undefined;
  const cluster = typeof search.cluster === "string" && search.cluster.length > 0 ? search.cluster : undefined;
  return { tab, cluster };
}
