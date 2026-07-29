import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import { shouldSearchItems } from "../../lib/metrics-facets";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import type { ParsedMetricQuery } from "../../lib/metric-query";

/** Query-Bar (Entwurf 2): server-side cap, +1 over the limit signals "there's more, narrow the query". */
export const SEARCH_LIMIT = 200;
const SUGGEST_LIMIT = 20;
const SUGGEST_DEBOUNCE_MS = 200;

/**
 * Zabbix' `search` mit `searchWildcardsEnabled: true` macht OHNE `*` einen
 * anchored (exakten) Match: ein bloßes Präfix wie "d" wird zu `LIKE 'd'` und
 * liefert NICHTS, obwohl passende Hosts existieren — genau die Ursache des
 * "host:d → leere Vorschlagsliste"-Bugs (bei leerem Präfix fällt `search` ganz
 * weg, deshalb listete "host:" noch alle Hosts). Für Substring-Autocomplete den
 * Wert in `*…*` wrappen (Wildcards bleiben für Power-User nutzbar, da `*` im
 * Wert erhalten bleibt). Resolve-Queries (Token→id) matchen bewusst exakt und
 * nutzen diesen Helfer daher nicht.
 */
function contains(value: string): string {
  return `*${value}*`;
}

/**
 * Item search for the Query-Bar (PLAN.md Entwurf 2). Historically the ⌘K/
 * metrics search "found nothing" for terms that only matched the key (or
 * only the name) because Zabbix ANDs every field inside `search` by default;
 * `searchByAny: true` makes item.get OR name/key_ instead, which is the
 * actual fix (see PLAN.md). host:/group: tokens are resolved to ids first so
 * item.get can filter server-side instead of us paging through everything.
 */
export function useMetricsSearch(query: ParsedMetricQuery) {
  const hostToken = query.tokens.find((t) => t.field === "host")?.value;
  const groupToken = query.tokens.find((t) => t.field === "group")?.value;
  const componentToken = query.tokens.find((t) => t.field === "component")?.value;
  const unitToken = query.tokens.find((t) => t.field === "unit")?.value;
  const keyToken = query.tokens.find((t) => t.field === "key")?.value;
  const text = query.text.trim();

  const hostResolveQuery = useQuery({
    queryKey: ["metrics-resolve-host", hostToken],
    queryFn: () =>
      zabbixApi.hostGet({
        search: { host: hostToken!, name: hostToken! },
        searchByAny: true,
        searchWildcardsEnabled: true,
        output: ["hostid"],
      }),
    enabled: Boolean(hostToken),
    staleTime: 30_000,
  });

  const groupResolveQuery = useQuery({
    queryKey: ["metrics-resolve-group", groupToken],
    queryFn: () =>
      zabbixApi.hostgroupGet({
        search: { name: groupToken! },
        searchWildcardsEnabled: true,
        output: ["groupid"],
      }),
    enabled: Boolean(groupToken) && !hostToken,
    staleTime: 30_000,
  });

  const hostIds = hostResolveQuery.data?.map((h) => h.hostid) ?? [];
  const groupIds = groupResolveQuery.data?.map((g) => g.groupid) ?? [];

  // Once a host:/group: token is present, still wait for its id lookup to
  // resolve before firing item.get — otherwise a stale/unrestricted query
  // would briefly run without the intended scope.
  const hostResolved = !hostToken || hostResolveQuery.isFetched;
  const groupResolved = !groupToken || hostToken !== undefined || groupResolveQuery.isFetched;

  const hasOtherToken = Boolean(componentToken || unitToken || keyToken);
  const enabled =
    (shouldSearchItems(text, hostToken, groupToken) || hasOtherToken) && hostResolved && groupResolved;

  const nameSearch = text || undefined;
  const keySearch = keyToken || text || undefined;
  const search =
    nameSearch || keySearch
      ? {
          ...(nameSearch ? { name: contains(nameSearch) } : {}),
          ...(keySearch ? { key_: contains(keySearch) } : {}),
        }
      : undefined;

  return useQuery({
    queryKey: [
      "metrics-search",
      text,
      hostToken,
      groupToken,
      componentToken,
      unitToken,
      keyToken,
      hostIds,
      groupIds,
    ],
    queryFn: () =>
      zabbixApi.itemGet({
        search,
        searchByAny: true,
        searchWildcardsEnabled: true,
        hostids: hostToken ? hostIds : undefined,
        groupids: !hostToken && groupToken ? groupIds : undefined,
        // operator omitted → Zabbix's item.get default ("contains"), which
        // still matches component values exactly since they're derived from
        // real tag values in the first place.
        tags: componentToken ? [{ tag: "component", value: componentToken }] : undefined,
        filter: {
          value_type: ["0", "3"],
          ...(unitToken ? { units: unitToken } : {}),
        },
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

/** Host-Autocomplete für das host:-Token — debounced, matches host oder name. */
export function useHostSuggestions(prefix: string) {
  const debounced = useDebouncedValue(prefix, SUGGEST_DEBOUNCE_MS);
  return useQuery({
    queryKey: ["metrics-host-suggest", debounced],
    queryFn: () =>
      zabbixApi.hostGet({
        search: debounced ? { host: contains(debounced), name: contains(debounced) } : undefined,
        searchByAny: true,
        searchWildcardsEnabled: true,
        output: ["hostid", "host", "name"],
        sortfield: "name",
        limit: SUGGEST_LIMIT,
      }),
    staleTime: 30_000,
  });
}

/** Hostgruppen-Autocomplete für das group:-Token — debounced. */
export function useGroupSuggestions(prefix: string) {
  const debounced = useDebouncedValue(prefix, SUGGEST_DEBOUNCE_MS);
  return useQuery({
    queryKey: ["metrics-group-suggest", debounced],
    queryFn: () =>
      zabbixApi.hostgroupGet({
        search: debounced ? { name: contains(debounced) } : undefined,
        searchWildcardsEnabled: true,
        output: ["groupid", "name"],
        sortfield: "name",
        limit: SUGGEST_LIMIT,
      }),
    staleTime: 30_000,
  });
}

/** Volle Item-Details für ausgewählte itemids (Graph-Tray) — unabhängig davon, ob die Suche noch dieselben Treffer liefert (teilbarer ?items=-Link). */
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
