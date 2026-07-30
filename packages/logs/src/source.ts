export interface LogStream {
  id: string;
  title: string;
  description: string;
  disabled: boolean;
  isDefault: boolean;
  /** Which Graylog server this stream lives on (multi-server setups). */
  serverId?: string;
  serverLabel?: string;
}

/** A configured Graylog backend, as exposed by GET /api/logs/servers (no tokens). */
export interface LogServer {
  id: string;
  label: string;
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
  /** Origin Graylog server (multi-server setups); tagged onto every row. */
  serverId?: string;
  serverLabel?: string;
  fields: Record<string, unknown>;
}

export interface LogSearchParams {
  /** Lucene query string. */
  query?: string;
  streamIds?: string[];
  /** Restrict the query to these Graylog server ids (default: all servers). */
  servers?: string[];
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
  /** Per-server failures in a multi-server search (partial results). */
  errors?: LogServerError[];
}

export interface LogServerError {
  serverId: string;
  error: string;
}

/** The filter selection persisted inside a saved filter set. */
export interface LogFilterSetPayload {
  include: LogFilter[];
  exclude: LogFilter[];
  streams?: string[] | null;
  servers?: string[] | null;
  level?: number | null;
}

/** A team-wide saved filter set (PLAN task 1). */
export interface LogFilterSet {
  id: string;
  name: string;
  owner: string;
  shared: boolean;
  filters: LogFilterSetPayload;
  created: string;
  updated: string;
}

/** Body for creating/updating a filter set. */
export interface LogFilterSetInput {
  name: string;
  shared: boolean;
  filters: LogFilterSetPayload;
}

/**
 * Abstraction over the optional log backend (PLAN.md section H). The SPA asks
 * /api/logs/status once; when disabled it gets a NullLogSource and every
 * log UI surface simply does not render.
 */
export interface LogSource {
  readonly enabled: boolean;
  /** Configured Graylog servers; length > 1 unlocks the multi-server UI. */
  servers(signal?: AbortSignal): Promise<LogServer[]>;
  streams(signal?: AbortSignal): Promise<LogStream[]>;
  search(params: LogSearchParams): Promise<LogSearchResult>;
  /** Host-scoped search; the gateway resolves the Zabbix host → source mapping. */
  hostLogs(hostid: string, params: Omit<LogSearchParams, "query"> & { extraQuery?: string }): Promise<LogSearchResult>;
  /** Team-wide saved filter sets (own + shared). */
  listFilterSets(signal?: AbortSignal): Promise<LogFilterSet[]>;
  createFilterSet(input: LogFilterSetInput): Promise<LogFilterSet>;
  /** Update a set — the gateway rejects (403) unless the caller is its owner. */
  updateFilterSet(id: string, input: LogFilterSetInput): Promise<LogFilterSet>;
  deleteFilterSet(id: string): Promise<void>;
}
