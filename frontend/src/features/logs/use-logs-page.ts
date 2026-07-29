import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { LogFilter, LogSearchResult, LogSource } from "@auzui/logs";

const PAGE_SIZE = 150;

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
 *
 * useInfiniteQuery statt useQuery: die Graylog-API liefert `total`, sodass
 * "Mehr laden" per offset nachfolgende Seiten anhängen kann, ohne die
 * bereits geladenen Zeilen zu verlieren. `placeholderData` behält die
 * vorherige Seite sichtbar, während der Live-Modus im Hintergrund neu lädt
 * (kein "Lade Logs…"-Flackern bei jedem 30s-Refresh).
 */
export function useLogSearch(
  source: LogSource,
  params: {
    streamId: string | undefined;
    query: string;
    range: { from: number; to: number };
    include: LogFilter[];
    exclude: LogFilter[];
  },
) {
  return useInfiniteQuery<LogSearchResult>({
    queryKey: [
      "log-search",
      params.streamId,
      params.query,
      params.range.from,
      params.range.to,
      params.include,
      params.exclude,
    ],
    queryFn: ({ signal, pageParam }) =>
      source.search({
        query: params.query || undefined,
        streamIds: params.streamId ? [params.streamId] : undefined,
        from: params.range.from,
        to: params.range.to,
        limit: PAGE_SIZE,
        offset: pageParam as number,
        include: params.include,
        exclude: params.exclude,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.messages.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    enabled: source.enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}
