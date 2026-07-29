import { useQuery } from "@tanstack/react-query";
import type { LogSearchResult, LogSource } from "@auzui/logs";

/**
 * Host-scoped Graylog search (PLAN.md Abschnitt H) — range-coupled to the
 * Deep-Dive's global chart range, refetches when it changes. `extraQuery` is
 * the free-text filter, debounced by the caller before it lands here.
 */
export function useHostLogs(
  source: LogSource,
  hostId: string | undefined,
  range: { from: number; to: number },
  extraQuery: string,
) {
  return useQuery<LogSearchResult>({
    queryKey: ["host-logs", hostId, range.from, range.to, extraQuery],
    queryFn: ({ signal }) =>
      source.hostLogs(hostId!, {
        from: range.from,
        to: range.to,
        limit: 100,
        extraQuery: extraQuery || undefined,
        signal,
      }),
    enabled: source.enabled && Boolean(hostId),
    staleTime: 15_000,
  });
}
