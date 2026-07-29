import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";

/** Items for one host's Latest-Data view: all value types, tags for component grouping. */
export function useLatestItems(hostId: string | undefined) {
  return useQuery({
    queryKey: ["latest-items", hostId],
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
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useAllHostsForPicker() {
  return useQuery({
    queryKey: ["all-hosts-picker"],
    queryFn: () =>
      zabbixApi.hostGet({
        output: ["hostid", "host", "name"],
        monitored_hosts: true,
        sortfield: "name",
      }),
    staleTime: 5 * 60_000,
  });
}
