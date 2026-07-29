import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";

/** Items for one host's Latest-Data view: all value types, tags for component grouping. */
export function useLatestItems(hostId: string | undefined) {
  return useQuery({
    queryKey: ["latest-items", hostId],
    queryFn: () =>
      zabbixApi.itemGet({
        hostids: [hostId!],
        output: [
          "itemid",
          "hostid",
          "name",
          "key_",
          "units",
          "value_type",
          "lastvalue",
          "lastclock",
          "prevvalue",
        ],
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

/**
 * Just the parent-template names for the selected host — used by the
 * display-template engine (lib/display-templates) to pick the right
 * bundle/family definitions for the Latest-Data "Komponenten-Navigator".
 */
export function useHostTemplates(hostId: string | undefined) {
  return useQuery({
    queryKey: ["latest-items-host-templates", hostId],
    queryFn: () =>
      zabbixApi.hostGet({
        hostids: [hostId!],
        output: ["hostid"],
        selectParentTemplates: ["templateid", "name"],
      }),
    enabled: Boolean(hostId),
    staleTime: 5 * 60_000,
    select: (hosts) => hosts[0],
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
