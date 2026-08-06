import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import type { ZabbixItem } from "@auzui/zabbix-client";
import { buildTemplateItemIds } from "./template-items";

/** Stable empty fallback so `items` keeps its identity across renders while loading. */
const NO_ITEMS: ZabbixItem[] = [];

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
        selectItemDiscovery: ["parent_itemid", "key_"],
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

  // Zabbix host items don't carry the linking template id directly. Two
  // routes recover it (see buildTemplateItemIds in template-items.ts for the
  // full rationale):
  //  - An inherited, non-discovered item keeps the template item's key_ —
  //    fetch the template items (hostid on those IS the templateid) and
  //    match by key_.
  //  - A per-LLD discovered item (flags "4" — the overwhelming majority on
  //    switches/Docker hosts) has a resolved key_ that matches no template
  //    item, only an item *prototype* with unresolved {#MACRO}s. Fetch the
  //    prototypes (hostid IS again the templateid) and match via
  //    item.itemDiscovery.key_, which item.get resolves to exactly the
  //    prototype's key_.
  const templateIds = (hostQuery.data?.parentTemplates ?? []).map((t) => t.templateid);
  const templateItemsQuery = useQuery({
    queryKey: ["host-detail", "template-items", templateIds],
    queryFn: () =>
      zabbixApi.itemGet({
        templateids: templateIds,
        output: ["itemid", "hostid", "key_"],
        webitems: false,
      }),
    enabled: templateIds.length > 0,
    staleTime: 300_000,
  });

  const templatePrototypesQuery = useQuery({
    queryKey: ["host-detail", "template-prototypes", templateIds],
    queryFn: () =>
      zabbixApi.itemprototypeGet({
        templateids: templateIds,
        output: ["itemid", "hostid", "key_"],
      }),
    enabled: templateIds.length > 0,
    staleTime: 300_000,
  });

  const items = itemsQuery.data ?? NO_ITEMS;

  // templateid -> Set of host item ids belonging to that template (via key_
  // for inherited items, via itemDiscovery.key_/prototype key_ for
  // LLD-discovered ones) — what the Page needs to filter the dashboard down
  // to one template's items. key_ collisions across templates aren't a
  // concern: Zabbix refuses to link two templates that share an item key to
  // the same host, so no item can ever match more than one templateid here
  // (verified empirically over 12 hosts / 3667 items — zero double
  // assignments).
  const templateItemIdsByTemplate = useMemo(
    () => buildTemplateItemIds(items, templateItemsQuery.data ?? [], templatePrototypesQuery.data ?? []),
    [items, templateItemsQuery.data, templatePrototypesQuery.data],
  );

  return {
    host: hostQuery.data,
    items,
    triggers: triggersQuery.data ?? [],
    problems: problemsQuery.data ?? [],
    isLoading: hostQuery.isLoading || itemsQuery.isLoading,
    isError: hostQuery.isError || itemsQuery.isError || triggersQuery.isError || problemsQuery.isError,
    /**
     * templateid → Set of host itemids belonging to that template (inherited
     * or LLD-discovered). Empty (but present) while templateItemsQuery /
     * templatePrototypesQuery are still loading/failed or the host has no
     * parentTemplates — callers should treat "not yet mapped" as "don't
     * filter" rather than reading an empty set as "no items".
     */
    templateItemIdsByTemplate,
    templateItemsReady:
      templateIds.length === 0 || (templateItemsQuery.isSuccess && templatePrototypesQuery.isSuccess),
  };
}
