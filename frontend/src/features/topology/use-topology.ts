import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import { useHosts, useHostProblemCounts } from "../hosts/use-hosts";
import { buildTopology } from "../../lib/topology";

/**
 * Existing Zabbix maps (selements + links only — auzui never reads/edits map
 * layout state, only the host↔host relationships they encode). PLAN.md
 * Phase 2 A: "explicit" evidence layer.
 */
function useMaps() {
  return useQuery({
    queryKey: ["topology-maps"],
    queryFn: () => zabbixApi.mapGet({ output: "extend", selectSelements: "extend", selectLinks: "extend" }),
    staleTime: 5 * 60_000,
  });
}

/** Combines hosts + maps + per-host problem counts into the topology graph (lib/topology.ts). */
export function useTopology() {
  const hostsQuery = useHosts();
  const mapsQuery = useMaps();
  const problemsByHost = useHostProblemCounts();

  const hosts = hostsQuery.data ?? [];
  const maps = mapsQuery.data ?? [];

  const graph = useMemo(() => buildTopology(hosts, maps, problemsByHost), [hosts, maps, problemsByHost]);

  return {
    graph,
    hosts,
    problemsByHost,
    isLoading: hostsQuery.isLoading || mapsQuery.isLoading,
  };
}
