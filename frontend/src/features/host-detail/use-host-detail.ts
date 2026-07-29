import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";

/**
 * All data the Host Deep-Dive needs to build its auto-dashboard: the host
 * itself (groups/templates/inventory/interfaces), its monitored items
 * (tagged, for classifyItem), its triggers (expanded expressions, for
 * extractThresholds) and its currently active problems.
 */
export function useHostDetail(hostId: string | undefined) {
  const hostQuery = useQuery({
    queryKey: ["host-detail", "host", hostId],
    queryFn: () =>
      zabbixApi
        .hostGet({
          hostids: [hostId!],
          output: "extend",
          selectInterfaces: "extend",
          selectParentTemplates: "extend",
          selectHostGroups: "extend",
          selectInventory: "extend",
        })
        .then((hosts) => hosts[0]),
    enabled: Boolean(hostId),
    staleTime: 60_000,
  });

  const itemsQuery = useQuery({
    queryKey: ["host-detail", "items", hostId],
    queryFn: () =>
      zabbixApi.itemGet({
        hostids: [hostId!],
        output: ["itemid", "hostid", "name", "key_", "units", "value_type", "lastvalue", "lastclock"],
        selectTags: "extend",
        monitored: true,
        webitems: false,
        sortfield: "name",
      }),
    enabled: Boolean(hostId),
    staleTime: 30_000,
  });

  const triggersQuery = useQuery({
    queryKey: ["host-detail", "triggers", hostId],
    queryFn: () =>
      zabbixApi.triggerGet({
        hostids: [hostId!],
        output: "extend",
        expandExpression: true,
        selectItems: ["itemid", "key_", "name", "value_type"],
        monitored: true,
      }),
    enabled: Boolean(hostId),
    staleTime: 60_000,
  });

  const problemsQuery = useQuery({
    queryKey: ["host-detail", "problems", hostId],
    queryFn: () =>
      zabbixApi.problemGet({
        hostids: [hostId!],
        output: "extend",
        selectTags: "extend",
        suppressed: false,
        sortfield: "eventid",
        sortorder: "DESC",
      }),
    enabled: Boolean(hostId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  return {
    host: hostQuery.data,
    items: itemsQuery.data ?? [],
    triggers: triggersQuery.data ?? [],
    problems: problemsQuery.data ?? [],
    isLoading: hostQuery.isLoading || itemsQuery.isLoading,
    isError: hostQuery.isError || itemsQuery.isError || triggersQuery.isError || problemsQuery.isError,
  };
}
