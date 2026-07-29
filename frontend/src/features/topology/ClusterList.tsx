import { useMemo } from "react";
import type { ClusterSummary } from "../../lib/topology";
import { clusterMatchesQuery } from "../../lib/topology";
import { severityDotColor } from "../../lib/severity";
import { useT } from "../../lib/i18n";

/**
 * Sticky, searchable cluster list — left pane of the redesign (PLAN.md
 * "Cluster-Liste links"). One row per cluster (subnet/proxy/map depending on
 * the active tab): severity dot, name, host count. Sorting is the caller's
 * responsibility (use-topology.ts pre-sorts worst-severity-first, then
 * name) — this component only filters by the free-text query.
 */
export function ClusterList({
  clusters,
  selectedId,
  onSelect,
  query,
  onQueryChange,
}: {
  clusters: ClusterSummary[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
}) {
  const t = useT();
  const filtered = useMemo(() => clusters.filter((c) => clusterMatchesQuery(c, query)), [clusters, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line-soft p-2.5">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("topology.clusterList.searchPlaceholder")}
          aria-label={t("topology.clusterList.searchAria")}
          className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {clusters.length === 0 ? (
          <div className="p-3 text-[12px] text-ink-muted">{t("topology.clusterList.noClusters")}</div>
        ) : filtered.length === 0 ? (
          <div className="p-3 text-[12px] text-ink-muted">{t("topology.clusterList.noMatches")}</div>
        ) : (
          <ul>
            {filtered.map((c) => {
              const selected = c.id === selectedId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className={`flex w-full items-center gap-2 border-b border-line-soft px-2.5 py-2 text-left text-[12.5px] ${
                      selected ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-surface-2"
                    }`}
                  >
                    <span
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ backgroundColor: severityDotColor(c.severity) }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                    <span className="flex-none font-mono text-[10.5px] text-ink-muted">
                      {t("topology.clusterList.hostCount", c.hosts.length)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
