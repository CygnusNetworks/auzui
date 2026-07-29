import { useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ZabbixItem } from "@auzui/zabbix-client";
import { Sparkline } from "../../components/Sparkline";
import { RangePicker, type RangeValue } from "../../components/RangePicker";
import { TimeChart } from "../../components/charts/TimeChart";
import { formatUnitValue } from "../../lib/format-units";
import { isNumericItem } from "../../lib/latest-items";
import { deriveComponentFacet, deriveUnitFacet, filterItemsByFacets, parseItemIds } from "../../lib/metrics-facets";
import { useTimeseries } from "../../lib/use-timeseries";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { nowSeconds, rangeFromPreset } from "@auzui/timeseries";
import { useHostGroups } from "../hosts/use-hosts";
import { validateMetricsSearch } from "./search-params";
import { useHostsInGroup, useItemsByIds, useMetricsSearch } from "./use-metrics";

const MAX_CARDS = 60;
const DEBOUNCE_MS = 400;

export function MetricsPage() {
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateMetricsSearch(rawSearch);
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const [groupId, setGroupId] = useState<string>("");
  const [hostId, setHostId] = useState<string>("");
  const [component, setComponent] = useState<string>("");
  const [unit, setUnit] = useState<string>("");
  const [compareOpen, setCompareOpen] = useState(false);

  const groupsQuery = useHostGroups();
  const hostsInGroupQuery = useHostsInGroup(groupId || undefined);
  const searchQuery = useMetricsSearch(debouncedQuery, hostId || undefined, groupId || undefined);

  const rawItems = searchQuery.data ?? [];
  const facetedComponent = useMemo(() => deriveComponentFacet(rawItems), [rawItems]);
  const facetedUnit = useMemo(() => deriveUnitFacet(rawItems), [rawItems]);

  const filtered = useMemo(
    () => filterItemsByFacets(rawItems, { component: component || undefined, unit: unit || undefined }),
    [rawItems, component, unit],
  );
  const visible = filtered.slice(0, MAX_CARDS);
  const truncated = filtered.length > MAX_CARDS;

  const selectedIds = useMemo(() => new Set(parseItemIds(search.items)), [search.items]);

  function setSelection(ids: Set<string>) {
    const csv = [...ids].join(",");
    void navigate({ to: "/metrics", search: (prev) => ({ ...prev, items: csv || undefined }), replace: true });
  }

  function toggleItem(itemid: string) {
    const next = new Set(selectedIds);
    if (next.has(itemid)) next.delete(itemid);
    else next.add(itemid);
    setSelection(next);
  }

  function toggleFacet(current: string, setter: (v: string) => void, value: string) {
    setter(current === value ? "" : value);
  }

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-24 pt-4.5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">Metrik-Browser</h1>
        <span className="text-[13px] text-ink-2">Facettensuche über alle Items</span>
        <span className="font-mono text-[10.5px] text-ink-muted">
          Klassifikation: component-Tag → Unit · 0 Konfiguration
        </span>
      </div>

      <div className="grid grid-cols-[220px_1fr] items-start gap-3.5 max-[980px]:grid-cols-1">
        <aside className="rounded-lg border border-line bg-surface p-3">
          <FacetGroup title="component" facets={facetedComponent} active={component} onToggle={(v) => toggleFacet(component, setComponent, v)} />
          <FacetGroup title="unit" facets={facetedUnit} active={unit} onToggle={(v) => toggleFacet(unit, setUnit, v)} />
        </aside>

        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2.5">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Items filtern (mind. 2 Zeichen)…"
              className="min-w-[220px] flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
            />
            <select
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                setHostId("");
              }}
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
            >
              <option value="">Alle Gruppen</option>
              {(groupsQuery.data ?? []).map((g) => (
                <option key={g.groupid} value={g.groupid}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              value={hostId}
              onChange={(e) => setHostId(e.target.value)}
              disabled={!groupId}
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink disabled:opacity-50"
            >
              <option value="">Alle Hosts</option>
              {(hostsInGroupQuery.data ?? []).map((h) => (
                <option key={h.hostid} value={h.hostid}>
                  {h.name}
                </option>
              ))}
            </select>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setCompareOpen(true)}
                className="ml-auto rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1.5 text-[12.5px] font-semibold text-accent"
              >
                {selectedIds.size} ausgewählt → Vergleichen
              </button>
            )}
          </div>

          {!searchQuery.isFetched && !searchQuery.isLoading ? (
            <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">
              Suchbegriff eingeben (mind. 2 Zeichen) oder Hostgruppe/Host wählen.
            </div>
          ) : searchQuery.isLoading ? (
            <div className="rounded-lg border border-line bg-surface p-6 text-sm text-ink-2">Lade Items…</div>
          ) : visible.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">
              Keine Items gefunden.
            </div>
          ) : (
            <>
              {truncated && (
                <div className="mb-2 font-mono text-[10.5px] text-ink-muted">
                  Zeige {MAX_CARDS} von {filtered.length} Treffern — Suche eingrenzen für mehr.
                </div>
              )}
              <div className="grid grid-cols-3 gap-2.5 max-[1100px]:grid-cols-1">
                {visible.map((item) => (
                  <MetricCard
                    key={item.itemid}
                    item={item}
                    selected={selectedIds.has(item.itemid)}
                    onToggle={() => toggleItem(item.itemid)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {compareOpen && selectedIds.size > 0 && (
        <CompareModal itemIds={[...selectedIds]} onClose={() => setCompareOpen(false)} />
      )}
    </div>
  );
}

function FacetGroup({
  title,
  facets,
  active,
  onToggle,
}: {
  title: string;
  facets: { value: string; count: number }[];
  active: string;
  onToggle: (value: string) => void;
}) {
  if (facets.length === 0) return null;
  return (
    <div className="mb-3 last:mb-0">
      <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">{title}</h3>
      <div className="flex flex-col gap-0.5">
        {facets.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => onToggle(f.value)}
            className={`flex items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-[12px] ${
              active === f.value ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-surface-2"
            }`}
          >
            <span className="truncate">{f.value}</span>
            <span className="font-mono text-[10.5px] text-ink-muted">{f.count.toLocaleString("de-DE")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MetricCard({
  item,
  selected,
  onToggle,
}: {
  item: ZabbixItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const { seriesByItem } = useTimeseries(
    [{ itemid: item.itemid, valueType: Number(item.value_type) as 0 | 3 }],
    useMemo(() => ({ from: nowSeconds() - 2 * 3600, to: nowSeconds() }), []),
    { points: 40 },
  );
  const series = seriesByItem.get(item.itemid);
  const hostName = item.hosts?.[0]?.name ?? item.hosts?.[0]?.host ?? "–";
  const lastValue =
    item.lastvalue !== undefined && item.lastvalue !== "" ? formatUnitValue(Number(item.lastvalue), item.units) : "–";

  return (
    <div className={`rounded-lg border p-3 ${selected ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>
      <label className="mb-1.5 flex items-start gap-2">
        <input type="checkbox" checked={selected} onChange={onToggle} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <div className="truncate font-mono text-[10.5px] text-ink-muted">{hostName}</div>
          <div className="truncate text-[12.5px] font-medium text-ink">{item.name}</div>
        </span>
      </label>
      {series && series.points.length > 1 && <Sparkline points={series.points} height={36} />}
      <div className="mt-1.5 font-mono text-[12.5px] text-ink">{lastValue}</div>
    </div>
  );
}

function CompareModal({ itemIds, onClose }: { itemIds: string[]; onClose: () => void }) {
  const [range, setRange] = useState<RangeValue>(() => rangeFromPreset("1h"));
  const [live, setLive] = useState(true);
  const itemsQuery = useItemsByIds(itemIds);
  const items = itemsQuery.data ?? [];
  const numericItems = useMemo(() => items.filter(isNumericItem), [items]);

  const { seriesByItem } = useTimeseries(
    numericItems.map((i) => ({ itemid: i.itemid, valueType: Number(i.value_type) as 0 | 3 })),
    range,
    { points: 800, enabled: numericItems.length > 0 },
  );

  const chartSeries = numericItems.map((item) => {
    const hostName = item.hosts?.[0]?.name ?? item.hosts?.[0]?.host ?? "";
    const series = seriesByItem.get(item.itemid);
    return {
      label: `${hostName}: ${item.name}`,
      points: (series?.points ?? []).map((p) => [p.t, p.v] as [number, number]),
    };
  });
  const commonUnit = numericItems.length > 0 && numericItems.every((i) => i.units === numericItems[0]!.units)
    ? numericItems[0]!.units
    : undefined;

  return (
    <div className="fixed inset-0 z-90 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-lg border border-line bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
          <div className="text-[13.5px] font-semibold text-ink">Vergleich — {numericItems.length} Items</div>
          <div className="ml-auto flex items-center gap-2">
            <RangePicker value={range} onChange={setRange} live={live} onLiveChange={setLive} />
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink-2"
            >
              Schließen
            </button>
          </div>
        </div>
        <div className="p-3">
          {itemsQuery.isLoading ? (
            <div className="p-6 text-center text-sm text-ink-2">Lade Items…</div>
          ) : (
            <TimeChart series={chartSeries} unit={commonUnit} height={340} onBrush={(from, to) => setRange({ from, to })} />
          )}
        </div>
      </div>
    </div>
  );
}
