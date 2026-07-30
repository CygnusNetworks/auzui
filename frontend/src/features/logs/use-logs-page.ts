import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { LogFilter, LogSearchResult, LogSource } from "@auzui/logs";

/** Server-side page size for the logs pager (PLAN task 3: "50 pro Seite"). */
export const PAGE_SIZE = 50;
const LIVE_REFRESH_MS = 30_000;

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
 * Globale Stream-Suche (POST /api/logs/search) mit echter Seiten-Navigation
 * (PLAN Aufgabe 3): eine Seite = ein `useQuery` mit offset = (page-1)·PAGE_SIZE.
 * Ersetzt das frühere useInfiniteQuery/"Mehr laden". `placeholderData` behält
 * die vorherige Seite sichtbar, während gewechselt oder (auf Seite 1) live
 * nachgeladen wird — kein "Lade Logs…"-Flackern.
 *
 * Live-Modus: nur auf Seite 1 aktiv (der aufrufende RangePicker schiebt dann
 * das Zeitfenster); auf Seite > 1 pausiert Live, damit die Offsets stabil
 * bleiben (Hinweis in der Pager-Kopfzeile).
 */
export function useLogSearch(
  source: LogSource,
  params: {
    streamId: string | undefined;
    servers: string[];
    query: string;
    range: { from: number; to: number };
    include: LogFilter[];
    exclude: LogFilter[];
    page: number;
    live: boolean;
  },
) {
  const livePage1 = params.live && params.page === 1;
  return useQuery<LogSearchResult>({
    queryKey: [
      "log-search",
      params.streamId,
      params.servers,
      params.query,
      params.range.from,
      params.range.to,
      params.include,
      params.exclude,
      params.page,
    ],
    queryFn: ({ signal }) =>
      source.search({
        query: params.query || undefined,
        streamIds: params.streamId ? [params.streamId] : undefined,
        servers: params.servers.length > 0 ? params.servers : undefined,
        from: params.range.from,
        to: params.range.to,
        limit: PAGE_SIZE,
        offset: (params.page - 1) * PAGE_SIZE,
        include: params.include,
        exclude: params.exclude,
        signal,
      }),
    enabled: source.enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    refetchInterval: livePage1 ? LIVE_REFRESH_MS : false,
  });
}

/** Team-weite gespeicherte Filter-Sets (eigene + geteilte), PLAN Aufgabe 1. */
export function useFilterSets(source: LogSource) {
  return useQuery({
    queryKey: ["log-filter-sets"],
    queryFn: ({ signal }) => source.listFilterSets(signal),
    enabled: source.enabled,
    staleTime: 30_000,
  });
}
