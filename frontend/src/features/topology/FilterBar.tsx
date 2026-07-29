import type { ZabbixHostGroup } from "@auzui/zabbix-client";
import { SEVERITY_FILTER_LABEL, type SeverityFilter } from "../../lib/severity";
import type { TopologyEdgeLevel } from "../../lib/topology";

type LayerKey = TopologyEdgeLevel;

const LAYER_ORDER: LayerKey[] = ["explicit", "l3", "logical"];
const LAYER_LABEL: Record<LayerKey, string> = { explicit: "Maps", l3: "L3-Subnetze", logical: "Proxy" };
const DASH_FOR_LEVEL: Record<LayerKey, string | undefined> = { explicit: undefined, l3: "6 4", logical: "2 3" };

const SEVERITY_FILTERS: SeverityFilter[] = ["all", "problems", "warn", "high"];

const selectClass =
  "rounded-md border border-line bg-surface-2 px-2 py-1 text-[12px] text-ink";

/**
 * Shared filter bar for both Graph- and Kartenansicht (PLAN.md
 * "Filterleiste (oben, beide Modi)"): severity threshold, hostgroup, proxy,
 * free-text search, and — graph view only — layer toggles with an inline
 * edge-style legend so the dashed/dotted meaning is visible right next to
 * the toggle that controls it.
 */
export function FilterBar({
  view,
  severityFilter,
  onSeverityFilterChange,
  groups,
  groupFilter,
  onGroupFilterChange,
  proxyIds,
  proxyFilter,
  onProxyFilterChange,
  query,
  onQueryChange,
  layers,
  onToggleLayer,
  largeGraphNotice,
}: {
  view: "graph" | "map";
  severityFilter: SeverityFilter;
  onSeverityFilterChange: (f: SeverityFilter) => void;
  groups: ZabbixHostGroup[];
  groupFilter: string | undefined;
  onGroupFilterChange: (id: string | undefined) => void;
  proxyIds: string[];
  proxyFilter: string | undefined;
  onProxyFilterChange: (id: string | undefined) => void;
  query: string;
  onQueryChange: (q: string) => void;
  layers: Record<LayerKey, boolean>;
  onToggleLayer: (key: LayerKey) => void;
  largeGraphNotice?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
      <div className="inline-flex gap-0.5 rounded-full bg-surface-3 p-0.5">
        {SEVERITY_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onSeverityFilterChange(f)}
            className={`rounded-full px-2.5 py-1 text-[11.5px] ${
              severityFilter === f ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-2"
            }`}
          >
            {SEVERITY_FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      <select
        value={groupFilter ?? ""}
        onChange={(e) => onGroupFilterChange(e.target.value || undefined)}
        className={selectClass}
        aria-label="Hostgruppe filtern"
      >
        <option value="">Alle Gruppen</option>
        {groups.map((g) => (
          <option key={g.groupid} value={g.groupid}>
            {g.name}
          </option>
        ))}
      </select>

      <select
        value={proxyFilter ?? ""}
        onChange={(e) => onProxyFilterChange(e.target.value || undefined)}
        className={selectClass}
        aria-label="Proxy filtern"
      >
        <option value="">Alle Proxies</option>
        {proxyIds.map((id) => (
          <option key={id} value={id}>
            Proxy {id}
          </option>
        ))}
      </select>

      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Host suchen…"
        className="min-w-[160px] rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink"
      />

      {view === "graph" && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex gap-0.5 rounded-full bg-surface-3 p-0.5">
            {LAYER_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onToggleLayer(key)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] ${
                  layers[key] ? "border-accent/40 bg-accent-soft font-semibold text-accent" : "border-line text-ink-2"
                }`}
              >
                {LAYER_LABEL[key]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2.5 text-[10.5px] text-ink-muted">
            {LAYER_ORDER.map((key) => (
              <span key={key} className="inline-flex items-center gap-1">
                <svg width="18" height="6" className="flex-none">
                  <line
                    x1="0"
                    y1="3"
                    x2="18"
                    y2="3"
                    stroke="var(--color-line)"
                    strokeWidth="1.4"
                    strokeDasharray={DASH_FOR_LEVEL[key]}
                  />
                </svg>
                {LAYER_LABEL[key]}
              </span>
            ))}
          </div>
        </div>
      )}

      {largeGraphNotice && <div className="ml-auto">{largeGraphNotice}</div>}
    </div>
  );
}
