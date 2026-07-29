export interface LogsSearch {
  /** Selected Graylog stream id. */
  stream?: string;
  /** Comma-separated Zabbix host technical names, OR-combined into the query as source:"<host>". */
  host?: string;
}

/** Mirrors features/latest-data/search-params.ts's style: a defensive validator for router search state. */
export function validateLogsSearch(search: Record<string, unknown>): LogsSearch {
  return {
    stream: typeof search.stream === "string" ? search.stream : undefined,
    host: typeof search.host === "string" ? search.host : undefined,
  };
}
