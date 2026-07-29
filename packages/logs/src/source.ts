export interface LogStream {
  id: string;
  title: string;
  description: string;
  disabled: boolean;
  isDefault: boolean;
}

export interface LogMessage {
  /** Unix seconds (fractional for sub-second precision). */
  timestamp: number;
  source: string;
  message: string;
  level?: number;
  facility?: string;
  streamIds?: string[];
  fields: Record<string, unknown>;
}

export interface LogSearchParams {
  /** Lucene query string. */
  query?: string;
  streamIds?: string[];
  /** Unix seconds. */
  from: number;
  /** Unix seconds. */
  to: number;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface LogSearchResult {
  messages: LogMessage[];
  total: number;
  /** For host-scoped searches: which source aliases actually matched. */
  matchedSources?: string[];
}

/**
 * Abstraction over the optional log backend (PLAN.md section H). The SPA asks
 * /api/logs/status once; when disabled it gets a NullLogSource and every
 * log UI surface simply does not render.
 */
export interface LogSource {
  readonly enabled: boolean;
  streams(signal?: AbortSignal): Promise<LogStream[]>;
  search(params: LogSearchParams): Promise<LogSearchResult>;
  /** Host-scoped search; the gateway resolves the Zabbix host → source mapping. */
  hostLogs(hostid: string, params: Omit<LogSearchParams, "query"> & { extraQuery?: string }): Promise<LogSearchResult>;
}
