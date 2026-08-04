/** Shape of the Web Scenarios page's URL search params — teilbare Filter-Links. */
export interface WebScenariosSearch {
  /** Selected httptestid for the detail panel. */
  scenario?: string;
  /** Free-text filter across scenario name, host, and step URLs. */
  q?: string;
}

export function validateWebScenariosSearch(search: Record<string, unknown>): WebScenariosSearch {
  const result: WebScenariosSearch = {};
  if (typeof search.scenario === "string") result.scenario = search.scenario;
  if (typeof search.q === "string") result.q = search.q;
  return result;
}
