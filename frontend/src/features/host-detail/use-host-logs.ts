import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import type { LogSearchResult, LogSource } from "@auzui/logs";

const PAGE_SIZE = 100;

/**
 * Host-scoped Graylog search (PLAN.md Abschnitt H) — range-coupled to the
 * Deep-Dive's global chart range, refetches when it changes. `extraQuery` is
 * the free-text filter, debounced by the caller before it lands here.
 *
 * useInfiniteQuery so "Mehr laden" can page further back via offset;
 * `placeholderData: keepPreviousData` keeps the current page visible while a
 * range change (e.g. a chart brush, or the live 30s window slide) refetches,
 * instead of flashing the loading state.
 */
export function useHostLogs(
  source: LogSource,
  hostId: string | undefined,
  range: { from: number; to: number },
  extraQuery: string,
  servers: string[] = [],
  pageSize: number = PAGE_SIZE,
) {
  return useInfiniteQuery<LogSearchResult>({
    queryKey: ["host-logs", hostId, range.from, range.to, extraQuery, servers, pageSize],
    queryFn: ({ signal, pageParam }) =>
      source.hostLogs(hostId!, {
        from: range.from,
        to: range.to,
        limit: pageSize,
        offset: pageParam as number,
        extraQuery: extraQuery || undefined,
        servers: servers.length > 0 ? servers : undefined,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.messages.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    enabled: source.enabled && Boolean(hostId),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}
