import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import { joinProblemsWithTriggers, type EnrichedProblem } from "../../lib/problems";

const POLL_INTERVAL_MS = 30_000;

/**
 * problem.get (all active problems) joined with trigger.get (host identity +
 * expanded expression + first item, batched by triggerid). Polls every 30s,
 * paused while the tab is hidden (TanStack Query default for
 * refetchIntervalInBackground).
 */
export function useProblems() {
  const problemsQuery = useQuery({
    queryKey: ["problems"],
    queryFn: () =>
      zabbixApi.problemGet({
        output: "extend",
        selectTags: "extend",
        sortfield: "eventid",
        sortorder: "DESC",
        limit: 1001,
      }),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const triggerIds = useMemo(
    () => [...new Set((problemsQuery.data ?? []).map((p) => p.objectid))],
    [problemsQuery.data],
  );

  const triggersQuery = useQuery({
    queryKey: ["problem-triggers", triggerIds],
    queryFn: () =>
      zabbixApi.triggerGet({
        triggerids: triggerIds,
        selectHosts: "extend",
        selectItems: "extend",
        expandExpression: true,
      }),
    enabled: triggerIds.length > 0,
    // Trigger metadata (host, expression, item) barely changes; avoid
    // refetching it on every 30s problems poll.
    staleTime: 5 * 60_000,
  });

  const enriched: EnrichedProblem[] = useMemo(() => {
    if (!problemsQuery.data) return [];
    return joinProblemsWithTriggers(problemsQuery.data, triggersQuery.data ?? []);
  }, [problemsQuery.data, triggersQuery.data]);

  return {
    problems: enriched,
    isLoading: problemsQuery.isLoading || (triggerIds.length > 0 && triggersQuery.isLoading),
    isError: problemsQuery.isError || triggersQuery.isError,
    error: problemsQuery.error ?? triggersQuery.error,
    refetch: problemsQuery.refetch,
  };
}
