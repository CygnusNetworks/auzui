import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import { shouldSearchItems } from "../../lib/metrics-facets";

const SEARCH_LIMIT = 300;

/**
 * Facettensuche über Items (PLAN.md Phase 2 / Entwurf 4): name-Suche + optional
 * Host-/Gruppen-Einschränkung, nur numerische Items (value_type 0/3),
 * monitored, mit Tags + Host für die Kartenanzeige.
 */
export function useMetricsSearch(query: string, hostId: string | undefined, groupId: string | undefined) {
  const enabled = shouldSearchItems(query, hostId, groupId);
  return useQuery({
    queryKey: ["metrics-search", query, hostId, groupId],
    queryFn: () =>
      zabbixApi.itemGet({
        search: query.trim() ? { name: query.trim() } : undefined,
        searchWildcardsEnabled: true,
        hostids: hostId ? [hostId] : undefined,
        groupids: !hostId && groupId ? [groupId] : undefined,
        filter: { value_type: ["0", "3"] },
        selectTags: "extend",
        selectHosts: "extend",
        monitored: true,
        webitems: false,
        limit: SEARCH_LIMIT + 1,
        sortfield: "name",
      }),
    enabled,
    staleTime: 30_000,
  });
}

/** Hosts einer Gruppe für den abhängigen Host-Facetten-Select. */
export function useHostsInGroup(groupId: string | undefined) {
  return useQuery({
    queryKey: ["metrics-hosts-in-group", groupId],
    queryFn: () =>
      zabbixApi.hostGet({
        groupids: [groupId!],
        output: ["hostid", "host", "name"],
        monitored_hosts: true,
        sortfield: "name",
      }),
    enabled: Boolean(groupId),
    staleTime: 60_000,
  });
}

/** Volle Item-Details für ausgewählte itemids (Vergleichs-Overlay) — unabhängig davon, ob die Suche noch dieselben Treffer liefert (teilbarer ?items=-Link). */
export function useItemsByIds(itemIds: string[]) {
  return useQuery({
    queryKey: ["metrics-items-by-ids", [...itemIds].sort()],
    queryFn: () =>
      zabbixApi.itemGet({
        itemids: itemIds,
        selectHosts: "extend",
        output: ["itemid", "hostid", "name", "key_", "units", "value_type", "lastvalue"],
      }),
    enabled: itemIds.length > 0,
    staleTime: 30_000,
  });
}
