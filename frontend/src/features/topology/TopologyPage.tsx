import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ClusterSummary } from "../../lib/topology";
import { findClusterForHostQuery } from "../../lib/topology";
import { severityLabel } from "../../lib/severity";
import { validateTopologySearch, type TopologyTab } from "./search-params";
import { useTopology } from "./use-topology";
import { ClusterList } from "./ClusterList";
import { FocusStage } from "./FocusStage";
import { MapStage } from "./MapStage";
import { MapView } from "./MapView";
import { useLocale, useT } from "../../lib/i18n";

const TABS: Exclude<TopologyTab, "geo">[] = ["maps", "l3", "proxies"];
/** The fourth, optional Geomap tab (PLAN.md: kept as-is, "wenn ohne großen Aufwand") — reuses the existing inventory-coordinate MapView unchanged. */
const ALL_TABS: TopologyTab[] = [...TABS, "geo"];

/**
 * Auto-Topologie redesign "Cluster + Fokus" (PLAN.md M3 + freigegebener
 * Entwurf 3): drei Evidenz-Tabs (Zabbix-Maps / L3-Subnetze / Proxies) —
 * niemals gemischt —, links eine sortierte, durchsuchbare Cluster-Liste,
 * rechts eine ruhige Fokus-Bühne für genau den gewählten Cluster. Ein
 * vierter Tab "Karte" bleibt als Geomap aus Inventar-Koordinaten bestehen
 * (unverändert, kein Cluster-Konzept dort). Tab + Cluster leben in der URL
 * (search-params.ts) — teilbar/bookmarkbar, eigene Param-Namen (`tab`,
 * `cluster`) um Kollision mit dem `sev`-Param der Problems-Seite zu
 * vermeiden.
 */
export function TopologyPage() {
  const t = useT();
  const { locale } = useLocale();
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateTopologySearch(rawSearch);
  const navigate = useNavigate();
  const tab = search.tab ?? "maps";

  const { hosts, hostByHostId, maps, problemsByHost, clustersByTab, isLoading } = useTopology();
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(true);

  const tabLabel: Record<TopologyTab, string> = {
    maps: t("topology.tabs.maps"),
    l3: t("topology.tabs.l3"),
    proxies: t("topology.tabs.proxies"),
    geo: t("topology.tabs.geo"),
  };

  const clusters: ClusterSummary[] = tab === "geo" ? [] : clustersByTab[tab];
  const selectedCluster = clusters.find((c) => c.id === search.cluster);

  function setTab(next: TopologyTab) {
    setQuery("");
    void navigate({
      to: "/topology",
      search: (prev) => ({ ...prev, tab: next === "maps" ? undefined : next, cluster: undefined }),
    });
  }

  function setCluster(id: string) {
    void navigate({ to: "/topology", search: (prev) => ({ ...prev, cluster: id }) });
  }

  // "Suchfeld ... springt bei Host-Treffern zum Cluster des Hosts" (PLAN.md).
  useEffect(() => {
    if (tab === "geo") return;
    const hit = findClusterForHostQuery(clusters, query);
    if (hit && hit.id !== search.cluster) setCluster(hit.id);
    // Intentionally scoped to `query` only — jumping is a query-driven
    // one-shot side effect, not something that should re-fire when
    // `clusters`/`search.cluster` change for other reasons.
  }, [query]);

  const hostCountTotal = hosts.length;

  const breadcrumbText = useMemo(() => {
    if (tab === "geo" || !selectedCluster) return undefined;
    const worst = selectedCluster.severity;
    let text = t("topology.breadcrumb.summary", tabLabel[tab], selectedCluster.name, selectedCluster.hosts.length);
    if (worst !== undefined) {
      const worstCount = selectedCluster.hosts.filter((h) => h.severity === worst).length;
      text += ` · ${t("topology.breadcrumb.severityPart", worstCount, severityLabel(worst, locale))}`;
    }
    return text;
  }, [tab, selectedCluster, tabLabel, t, locale]);

  const selectedMap = tab === "maps" && selectedCluster ? maps.find((m) => `map:${m.sysmapid}` === selectedCluster.id) : undefined;

  return (
    <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pb-16 pt-4.5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">{t("topology.title")}</h1>
        <span className="text-[13px] text-ink-2">{t("topology.subtitle")}</span>
        <span className="font-mono text-[10.5px] text-ink-muted">{t("topology.generatedFrom", hostCountTotal)}</span>
        <div className="ml-auto inline-flex flex-wrap gap-0.5 rounded-lg bg-surface-3 p-0.5">
          {ALL_TABS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-md px-3 py-1 text-[12.5px] ${tab === key ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-2"}`}
            >
              {tabLabel[key]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">{t("topology.loading")}</div>
      ) : tab === "geo" ? (
        <div className="rounded-lg border border-line bg-surface">
          <MapView
            hostNodes={hosts.map((h) => ({
              id: `host:${h.hostid}`,
              hostid: h.hostid,
              label: h.name || h.host,
              kind: "host" as const,
              severity: problemsByHost.get(h.hostid)?.maxSeverity,
            }))}
            hostByHostId={hostByHostId}
            query={query}
            selectedNodeId={undefined}
            onSelect={() => {}}
          />
        </div>
      ) : (
        <div className="grid grid-cols-[260px_1fr] items-start gap-3.5 max-[820px]:grid-cols-1">
          <div className="min-[821px]:hidden">
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              className="mb-2 w-full rounded-md border border-line bg-surface-2 px-3 py-1.5 text-left text-[12.5px] text-ink-2"
            >
              {t("topology.clusterList.toggleList")} ({clusters.length}) {listOpen ? "▲" : "▼"}
            </button>
          </div>
          <div className={`${listOpen ? "" : "hidden"} min-[821px]:block sticky top-4 max-h-[640px] rounded-lg border border-line bg-surface`}>
            <ClusterList clusters={clusters} selectedId={search.cluster} onSelect={setCluster} query={query} onQueryChange={setQuery} />
          </div>

          <div className="rounded-lg border border-line bg-surface">
            <div className="border-b border-line-soft px-3.5 py-2.5 font-mono text-[11.5px] text-ink-2">
              {breadcrumbText ?? t("topology.breadcrumb.empty")}
            </div>
            {tab === "maps" ? (
              <MapStage map={selectedMap} hostByHostId={hostByHostId} problemsByHost={problemsByHost} />
            ) : (
              <FocusStage cluster={selectedCluster} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
