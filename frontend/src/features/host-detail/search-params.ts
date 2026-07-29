/** Shape of the Host-Deep-Dive page's URL search params. */
export interface HostDetailSearch {
  /** Unix seconds — initial chart/log range, e.g. set by "Logs ±15 min" from a problem. */
  from?: number;
  to?: number;
}

export function validateHostDetailSearch(search: Record<string, unknown>): HostDetailSearch {
  const result: HostDetailSearch = {};
  if (typeof search.from === "number") result.from = search.from;
  if (typeof search.to === "number") result.to = search.to;
  return result;
}
