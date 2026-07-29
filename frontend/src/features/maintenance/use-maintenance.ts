import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";

const POLL_INTERVAL_MS = 60_000;

/** maintenance.get, mit Hosts/Hostgruppen/Timeperioden für Liste + Formular. */
export function useMaintenance() {
  return useQuery({
    queryKey: ["maintenances"],
    queryFn: () =>
      zabbixApi.maintenanceGet({
        output: "extend",
        selectHosts: ["hostid", "host", "name"],
        selectHostGroups: "extend",
        selectTimeperiods: "extend",
      }),
    refetchInterval: POLL_INTERVAL_MS,
  });
}

/** Hosts, die aktuell in Maintenance sind — für den Hinweis-Chip auf der Problems-Seite. */
export function useHostsInMaintenance() {
  return useQuery({
    queryKey: ["maintenance-hosts"],
    queryFn: () =>
      zabbixApi.hostGet({
        output: ["hostid", "host", "name", "maintenance_status", "maintenanceid"],
        filter: { maintenance_status: "1" },
      }),
    refetchInterval: POLL_INTERVAL_MS,
  });
}
