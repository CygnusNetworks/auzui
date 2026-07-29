import type { LogFilter, LogFilterField } from "@auzui/logs";

export interface LogsSearch {
  /** Selected Graylog stream id. */
  stream?: string;
  /** Comma-separated Zabbix host technical names, OR-combined into the query as source:"<host>". */
  host?: string;
  /** Include-filter chips clicked from a log row, encoded like `facility:local0,application_name:sshd`. */
  include?: string;
  /** Exclude-filter chips, same encoding — covers hosts too (the `host` param has no exclude concept). */
  exclude?: string;
}

/** Mirrors features/latest-data/search-params.ts's style: a defensive validator for router search state. */
export function validateLogsSearch(search: Record<string, unknown>): LogsSearch {
  return {
    stream: typeof search.stream === "string" ? search.stream : undefined,
    host: typeof search.host === "string" ? search.host : undefined,
    include: typeof search.include === "string" ? search.include : undefined,
    exclude: typeof search.exclude === "string" ? search.exclude : undefined,
  };
}

const FILTER_FIELDS: ReadonlySet<string> = new Set<LogFilterField>(["source", "facility", "application_name"]);

/**
 * Decodes the `include`/`exclude` URL param into filter chips. Encoding is a
 * flat `field:value,field:value` string — same CSV style as the existing
 * `host`/`sev` params, instead of a JSON blob, so the URL stays readable and
 * shareable. Values are URI-encoded since they may contain ":" or ","
 * (e.g. an application_name); malformed entries (hand-edited URL) are
 * dropped instead of throwing.
 */
export function filtersFromSearch(raw: string | undefined): LogFilter[] {
  if (!raw) return [];
  const result: LogFilter[] = [];
  for (const entry of raw.split(",")) {
    const sep = entry.indexOf(":");
    if (sep < 0) continue;
    const field = entry.slice(0, sep);
    if (!FILTER_FIELDS.has(field)) continue;
    try {
      result.push({ field: field as LogFilterField, value: decodeURIComponent(entry.slice(sep + 1)) });
    } catch {
      // malformed %-escape — drop this one entry, keep the rest.
    }
  }
  return result;
}

/** Encodes filter chips back into the `include`/`exclude` URL search param value. */
export function filtersToSearchValue(filters: LogFilter[]): string | undefined {
  if (filters.length === 0) return undefined;
  return filters.map((f) => `${f.field}:${encodeURIComponent(f.value)}`).join(",");
}
