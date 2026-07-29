import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import { aggregateHostProblems, type HostProblemSummary } from "../../lib/hosts";

/** All monitored hosts with the fields HostsPage's table/tiles need. */
export function useHosts() {
  return useQuery({
    queryKey: ["hosts"],
    queryFn: () =>
      zabbixApi.hostGet({
        output: ["hostid", "host", "name", "status", "maintenance_status", "proxyid"],
        selectInterfaces: "extend",
        selectParentTemplates: ["templateid", "name"],
        selectHostGroups: "extend",
        selectInventory: ["os", "location", "location_lat", "location_lon"],
        monitored_hosts: true,
      }),
    staleTime: 60_000,
  });
}

export function useHostGroups() {
  return useQuery({
    queryKey: ["hostgroups"],
    queryFn: () => zabbixApi.hostgroupGet({ output: "extend", sortfield: "name" }),
    staleTime: 5 * 60_000,
  });
}

/**
 * Per-host problem count + max severity, via problem.get (suppressed:false)
 * joined with trigger.get (monitored:true, selectHosts hostid) — deliberately
 * NOT useProblems (features/problems), which filters to the unack-by-default
 * URL state meant for the Problems page.
 */
export function useHostProblemCounts(): Map<string, HostProblemSummary> {
  const problemsQuery = useQuery({
    queryKey: ["host-problem-counts", "problems"],
    queryFn: () =>
      zabbixApi.problemGet({
        output: ["eventid", "objectid", "severity"],
        suppressed: false,
        limit: 5001,
      }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const triggerIds = useMemo(
    () => [...new Set((problemsQuery.data ?? []).map((p) => p.objectid))],
    [problemsQuery.data],
  );

  const triggersQuery = useQuery({
    queryKey: ["host-problem-counts", "triggers", triggerIds],
    queryFn: () =>
      zabbixApi.triggerGet({
        triggerids: triggerIds,
        selectHosts: ["hostid"],
        monitored: true,
      }),
    enabled: triggerIds.length > 0,
    staleTime: 60_000,
  });

  return useMemo(
    () => aggregateHostProblems(problemsQuery.data ?? [], triggersQuery.data ?? []),
    [problemsQuery.data, triggersQuery.data],
  );
}
