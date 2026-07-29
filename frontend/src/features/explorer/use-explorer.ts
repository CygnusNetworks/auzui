import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";

/**
 * CPU-%-Auslastung je Host (item.get search key_ system.cpu.util, lastvalue)
 * — bewusst nur geladen, wenn Ebene 2 sichtbar UND der Umschalter auf
 * "Auslastung" steht (`enabled`), damit Ebene 1 keine zusätzlichen Requests
 * auslöst.
 */
export function useHostCpuUtil(hostIds: string[], enabled: boolean) {
  const sortedIds = useMemo(() => [...hostIds].sort(), [hostIds]);

  const query = useQuery({
    queryKey: ["explorer-cpu-util", sortedIds],
    queryFn: () =>
      zabbixApi.itemGet({
        hostids: sortedIds,
        search: { key_: "system.cpu.util" },
        output: ["hostid", "lastvalue"],
        monitored: true,
      }),
    enabled: enabled && sortedIds.length > 0,
    staleTime: 30_000,
  });

  return useMemo(() => {
    const map = new Map<string, number>();
    for (const item of query.data ?? []) {
      const value = Number(item.lastvalue);
      if (Number.isFinite(value)) map.set(item.hostid, value);
    }
    return map;
  }, [query.data]);
}
