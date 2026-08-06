import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import { joinProblemsWithTriggers, type EnrichedProblem } from "../../lib/problems";

const POLL_INTERVAL_MS = 30_000;

/**
 * problem.get (all active problems) joined with trigger.get (host identity +
 * expanded expression + first item, batched by triggerid). Both queries poll
 * every 30s — trigger.get included, since its item data backs the "current
 * value" chip — paused while the tab is hidden (refetchIntervalInBackground:
 * false on both).
 *
 * Sichtbarkeit wie die Zabbix-UI: standardmäßig keine per Maintenance oder
 * manuell supprimierten Probleme, und nur Probleme, deren Trigger aktiv und
 * Host monitored ist (problem.get liefert sonst auch Leichen deaktivierter
 * Hosts/Trigger).
 *
 * `showSuppressed` lässt den `suppressed: false`-Filter weg, sodass auch
 * unterdrückte Probleme geladen werden (Filter-Chip „Unterdrückte anzeigen").
 * Die beiden Varianten sind getrennte Query-Keys, teilen sich aber das
 * `["problems", …]`-Präfix, über das useAcknowledge optimistisch schreibt.
 */
export function useProblems({ showSuppressed = false }: { showSuppressed?: boolean } = {}) {
  const problemsQuery = useQuery({
    queryKey: ["problems", showSuppressed ? "with-suppressed" : "default"],
    queryFn: () =>
      zabbixApi.problemGet({
        output: "extend",
        selectTags: "extend",
        // Ohne Flag wie die Zabbix-UI filtern; mit Flag unterdrückte einschließen.
        ...(showSuppressed ? {} : { suppressed: false }),
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
        monitored: true,
      }),
    enabled: triggerIds.length > 0,
    // items[].lastvalue backs the Problems page's "current value" chip, so this
    // must stay on the same 30s cadence as problemsQuery — it's not just static
    // trigger/host metadata anymore.
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const enriched: EnrichedProblem[] = useMemo(() => {
    if (!problemsQuery.data) return [];
    const joined = joinProblemsWithTriggers(problemsQuery.data, triggersQuery.data ?? []);
    // trigger.get lief mit monitored:true — Probleme ohne Treffer gehören zu
    // deaktivierten Triggern/unmonitored Hosts und sind in der Zabbix-UI
    // ebenfalls unsichtbar. Erst filtern, wenn die Trigger geladen sind.
    if (!triggersQuery.data) return joined;
    return joined.filter((p) => p.hostId !== undefined);
  }, [problemsQuery.data, triggersQuery.data]);

  return {
    problems: enriched,
    isLoading: problemsQuery.isLoading || (triggerIds.length > 0 && triggersQuery.isLoading),
    isError: problemsQuery.isError || triggersQuery.isError,
    error: problemsQuery.error ?? triggersQuery.error,
    refetch: problemsQuery.refetch,
  };
}
