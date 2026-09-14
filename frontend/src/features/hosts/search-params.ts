/** Shape of the Hosts page's URL search params — teilbare Filter-Links (CONTRACT.md section 3). */
export interface HostsSearch {
  /**
   * Host group filter. Named `groupid` (not `group`) because Docker and
   * Explorer already own a `group` param with incompatible types — TanStack
   * Router types search reducers against the full cross-route schema
   * (see features/docker/search-params.ts).
   */
  groupid?: string;
}

export function validateHostsSearch(search: Record<string, unknown>): HostsSearch {
  const result: HostsSearch = {};
  if (typeof search.groupid === "string" && search.groupid) result.groupid = search.groupid;
  else if (typeof search.groupid === "number") result.groupid = String(search.groupid);
  return result;
}
