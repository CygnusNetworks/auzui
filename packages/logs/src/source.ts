export interface LogStream {
  id: string;
  title: string;
  description: string;
  disabled: boolean;
  isDefault: boolean;
}

/** The fixed set of fields a log row can be include/exclude-filtered by (PLAN.md section H). */
export type LogFilterField = "source" | "facility" | "application_name";

/** One include or exclude filter chip; `mode` says which. */
export interface LogFilter {
  field: LogFilterField;
  value: string;
}

export interface LogMessage {
  /** Stable id for React list keys — Graylog message id, or a gateway-derived fallback. */
  id?: string;
  /** Unix seconds (fractional for sub-second precision). */
  timestamp: number;
  source: string;
  message: string;
  level?: number;
  facility?: string;
  /** Numeric syslog facility (RFC 5424 table 7); resolved to a name in the UI. */
  facilityNum?: number;
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
  /** Include filter chips (source/facility/application_name), ANDed with `query`. */
  include?: LogFilter[];
  /** Exclude filter chips, translated to `NOT field:"value"` by the gateway. */
  exclude?: LogFilter[];
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
