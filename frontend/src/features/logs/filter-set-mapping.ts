import type { LogFilter, LogFilterSetPayload } from "@auzui/logs";
import { filtersFromSearch, filtersToSearchValue, parseServersParam } from "./search-params";

/**
 * The complete filter selection of the logs toolbar, assembled from the URL
 * search params plus the local max-level chip. A saved filter set (PLAN task 1)
 * is exactly this, serialized to the gateway's LogFilterSetPayload.
 */
export interface CurrentFilters {
  /** Host technical names (source includes), from `?host=`. */
  hosts: string[];
  /** Generic include chips (facility/application_name), from `?include=`. */
  include: LogFilter[];
  /** Exclude chips, from `?exclude=`. */
  exclude: LogFilter[];
  /** Selected stream id, from `?stream=`. */
  stream?: string;
  /** Selected server ids, from `?servers=`. */
  servers: string[];
  /** Max syslog level chip. */
  level?: number;
}

/** Search-param subset a filter set restores when applied. */
export interface AppliedSearch {
  stream?: string;
  host?: string;
  include?: string;
  exclude?: string;
  servers?: string;
}

/** Serializes the current toolbar selection into a gateway filter-set payload. */
export function currentToPayload(cur: CurrentFilters): LogFilterSetPayload {
  return {
    include: [
      ...cur.hosts.map((h) => ({ field: "source" as const, value: h })),
      ...cur.include,
    ],
    exclude: cur.exclude,
    streams: cur.stream ? [cur.stream] : null,
    servers: cur.servers.length > 0 ? cur.servers : null,
    level: cur.level ?? null,
  };
}

/**
 * Splits a stored payload back into URL search params (+ the max level, which
 * lives in component state). Source-field includes go back to `?host=`, the
 * rest to `?include=` — mirroring how the toolbar encodes them.
 */
export function payloadToSearch(payload: LogFilterSetPayload): {
  search: AppliedSearch;
  level: number | undefined;
} {
  const hosts = payload.include.filter((f) => f.field === "source").map((f) => f.value);
  const generic = payload.include.filter((f) => f.field !== "source");
  return {
    search: {
      stream: payload.streams?.[0],
      host: hosts.length > 0 ? hosts.join(",") : undefined,
      include: filtersToSearchValue(generic),
      exclude: filtersToSearchValue(payload.exclude),
      servers:
        payload.servers && payload.servers.length > 0 ? payload.servers.join(",") : undefined,
    },
    level: payload.level ?? undefined,
  };
}

/** Rebuilds CurrentFilters from raw search-param values + a max level. */
export function currentFromSearch(
  search: {
    host?: string;
    include?: string;
    exclude?: string;
    stream?: string;
    servers?: string;
  },
  level: number | undefined,
): CurrentFilters {
  return {
    hosts: search.host
      ? search.host
          .split(",")
          .map((h) => h.trim())
          .filter(Boolean)
      : [],
    include: filtersFromSearch(search.include),
    exclude: filtersFromSearch(search.exclude),
    stream: search.stream,
    servers: parseServersParam(search.servers),
    level,
  };
}

function normalize(payload: LogFilterSetPayload): string {
  const filters = (fs: LogFilter[]) =>
    [...fs].map((f) => `${f.field}:${f.value}`).sort();
  return JSON.stringify({
    include: filters(payload.include),
    exclude: filters(payload.exclude),
    streams: [...(payload.streams ?? [])].sort(),
    servers: [...(payload.servers ?? [])].sort(),
    level: payload.level ?? null,
  });
}

/** Order-insensitive equality between two payloads (for the "modified" flag). */
export function payloadsEqual(a: LogFilterSetPayload, b: LogFilterSetPayload): boolean {
  return normalize(a) === normalize(b);
}
