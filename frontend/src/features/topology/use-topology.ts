import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import { useT } from "../../lib/i18n";
import { useHosts, useHostProblemCounts } from "../hosts/use-hosts";
import {
  deriveMapClusters,
  deriveProxyClusters,
  deriveSubnetClusters,
  sortClustersBySeverity,
  type ClusterSummary,
} from "../../lib/topology";

/**
 * Existing Zabbix maps (selements + links only — auzui never reads/edits map
 * layout state, only the host↔host relationships + selement positions they
 * encode). Zabbix-Maps-Tab of the redesign renders the map's own layout on
 * the focus stage (real x/y, not a force-layout).
 */
function useMaps() {
  return useQuery({
    queryKey: ["topology-maps"],
    queryFn: () => zabbixApi.mapGet({ output: "extend", selectSelements: "extend", selectLinks: "extend" }),
    staleTime: 5 * 60_000,
  });
}

/** proxy.get — Zabbix 7.x names the field "name" (pre-7.0: "host"); auzui targets 7.x. */
function useProxies() {
  return useQuery({
    queryKey: ["topology-proxies"],
    queryFn: () => zabbixApi.proxyGet({ output: ["proxyid", "name"] }),
    staleTime: 5 * 60_000,
  });
}

/**
 * Combines hosts + maps + proxies + per-host problem counts into the three
 * cluster lists the redesign's tabs need (lib/topology.ts). Each list is
 * pre-sorted worst-severity-first, then name.
 */
export function useTopology() {
  const t = useT();
  const hostsQuery = useHosts();
  const mapsQuery = useMaps();
  const proxiesQuery = useProxies();
  const problemsByHost = useHostProblemCounts();

  const directProxyName = t("topology.directProxy");

  const hosts = hostsQuery.data ?? [];
  const maps = mapsQuery.data ?? [];
  const proxies = proxiesQuery.data ?? [];

  const proxyNameById = useMemo(() => new Map(proxies.map((p) => [p.proxyid, p.name])), [proxies]);
  const hostByHostId = useMemo(() => new Map(hosts.map((h) => [h.hostid, h])), [hosts]);

  const subnetClusters = useMemo(
    () => sortClustersBySeverity(deriveSubnetClusters(hosts, problemsByHost)),
    [hosts, problemsByHost],
  );
  const proxyClusters = useMemo(
    () => sortClustersBySeverity(deriveProxyClusters(hosts, problemsByHost, proxyNameById, directProxyName)),
    [hosts, problemsByHost, proxyNameById, directProxyName],
  );
  const mapClusters = useMemo(
    () => sortClustersBySeverity(deriveMapClusters(maps, hostByHostId, problemsByHost)),
    [maps, hostByHostId, problemsByHost],
  );

  const clustersByTab: Record<"maps" | "l3" | "proxies", ClusterSummary[]> = {
    maps: mapClusters,
    l3: subnetClusters,
    proxies: proxyClusters,
  };

  return {
    hosts,
    maps,
    hostByHostId,
    problemsByHost,
    clustersByTab,
    isLoading: hostsQuery.isLoading || mapsQuery.isLoading || proxiesQuery.isLoading,
  };
}
