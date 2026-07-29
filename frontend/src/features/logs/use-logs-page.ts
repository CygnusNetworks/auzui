import { useQuery } from "@tanstack/react-query";
import type { LogSearchResult, LogSource } from "@auzui/logs";

/** Streamliste für den Stream-Browser (PLAN.md Abschnitt H), links in der Seite. */
export function useLogStreams(source: LogSource) {
  return useQuery({
    queryKey: ["log-streams"],
    queryFn: ({ signal }) => source.streams(signal),
    enabled: source.enabled,
    staleTime: 60_000,
  });
}

/**
 * Globale Stream-Suche (POST /api/logs/search) — anders als useHostLogs
 * (host-detail) ohne Host-Mapping, mit expliziter Stream-Auswahl und
 * kompletter Lucene-Query aus der Query-Leiste + Level-Chips.
 */
export function useLogSearch(
  source: LogSource,
  params: { streamId: string | undefined; query: string; range: { from: number; to: number } },
) {
  return useQuery<LogSearchResult>({
    queryKey: ["log-search", params.streamId, params.query, params.range.from, params.range.to],
    queryFn: ({ signal }) =>
      source.search({
        query: params.query || undefined,
        streamIds: params.streamId ? [params.streamId] : undefined,
        from: params.range.from,
        to: params.range.to,
        limit: 150,
        signal,
      }),
    enabled: source.enabled,
    staleTime: 15_000,
  });
}
