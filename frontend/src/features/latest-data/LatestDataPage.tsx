import { useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ZabbixItem } from "@auzui/zabbix-client";
import { Sparkline } from "../../components/Sparkline";
import { RangePicker, type RangeValue } from "../../components/RangePicker";
import { TimeChart } from "../../components/charts/TimeChart";
import { formatUnitValue } from "../../lib/format-units";
import { formatAge } from "../../lib/problems";
import { groupItemsByComponent, isNumericItem } from "../../lib/latest-items";
import { useTimeseries } from "../../lib/use-timeseries";
import { nowSeconds, rangeFromPreset } from "@auzui/timeseries";
import { validateLatestDataSearch } from "./search-params";
import { useAllHostsForPicker, useLatestItems } from "./use-latest-items";

export function LatestDataPage() {
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateLatestDataSearch(rawSearch);
  const navigate = useNavigate();

  const hostsQuery = useAllHostsForPicker();
  const itemsQuery = useLatestItems(search.host);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [selectedItem, setSelectedItem] = useState<ZabbixItem | undefined>();

  const sections = useMemo(() => groupItemsByComponent(itemsQuery.data ?? []), [itemsQuery.data]);

  function pickHost(hostId: string | undefined) {
    void navigate({ to: "/latest-data", search: { host: hostId }, replace: true });
  }

  return (
    <div className="mx-auto max-w-[1400px] px-3 pb-16 pt-4.5 min-[700px]:px-5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">Latest Data</h1>
        <span className="text-[13px] text-ink-2">Aktuelle Item-Werte je Host, gruppiert nach Komponente</span>
      </div>

      <div className="mb-3.5 rounded-lg border border-line bg-surface p-3.5">
        <HostPicker
          hosts={hostsQuery.data ?? []}
          selectedHostId={search.host}
          onSelect={pickHost}
        />
      </div>

      {!search.host ? (
        <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">
          Zuerst einen Host auswählen.
        </div>
      ) : itemsQuery.isLoading ? (
        <div className="rounded-lg border border-line bg-surface p-6 text-sm text-ink-2">
          Lade Items…
        </div>
      ) : sections.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">
          Keine Items für diesen Host.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sections.map((section) => {
            const open = openSections[section.component] ?? true;
            return (
              <div key={section.component} className="rounded-lg border border-line bg-surface">
                <button
                  type="button"
                  onClick={() =>
                    setOpenSections({ ...openSections, [section.component]: !open })
                  }
                  className="flex w-full items-center gap-2 border-b border-line-soft px-3.5 py-2 text-left"
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                    {open ? "▾" : "▸"} component:{section.component}
                  </span>
                  <span className="ml-auto font-mono text-[10.5px] text-ink-muted">
                    {section.items.length}
                  </span>
                </button>
                {open && <SectionBody items={section.items} onSelect={setSelectedItem} />}
              </div>
            );
          })}
        </div>
      )}

      {selectedItem && (
        <ItemChartModal item={selectedItem} onClose={() => setSelectedItem(undefined)} />
      )}
    </div>
  );
}

/**
 * One batched timeseries query per open section — the section only mounts
 * (and its sparklines only load) once expanded, matching the "nur sichtbare
 * Zeilen laden" requirement without firing one request per row.
 */
function SectionBody({
  items,
  onSelect,
}: {
  items: ZabbixItem[];
  onSelect: (item: ZabbixItem) => void;
}) {
  const numericItems = useMemo(() => items.filter(isNumericItem), [items]);
  const { seriesByItem } = useTimeseries(
    numericItems.map((i) => ({ itemid: i.itemid, valueType: Number(i.value_type) as 0 | 3 })),
    useMemo(() => ({ from: nowSeconds() - 2 * 3600, to: nowSeconds() }), []),
    { points: 40 },
  );

  return (
    <div>
      {items.map((item) => (
        <ItemRow
          key={item.itemid}
          item={item}
          series={seriesByItem.get(item.itemid)}
          onOpen={() => onSelect(item)}
        />
      ))}
    </div>
  );
}

function ItemRow({
  item,
  series,
  onOpen,
}: {
  item: ZabbixItem;
  series: { points: { t: number; v: number }[] } | undefined;
  onOpen: () => void;
}) {
  const numeric = isNumericItem(item);
  const lastValue =
    item.lastvalue !== undefined && item.lastvalue !== ""
      ? numeric
        ? formatUnitValue(Number(item.lastvalue), item.units)
        : item.lastvalue
      : "–";
  const age = item.lastclock ? formatAge(Number(item.lastclock)) : "–";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 border-b border-line-soft px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-surface-2 min-[700px]:grid min-[700px]:grid-cols-[1.8fr_1fr_70px_140px] min-[700px]:items-center min-[700px]:gap-3"
    >
      <span className="min-w-0">
        <div className="truncate text-ink">{item.name}</div>
        <div className="truncate font-mono text-[10.5px] text-ink-muted">{item.key_}</div>
      </span>
      <span className="flex items-center gap-2 min-[700px]:contents">
        <span className="truncate font-mono text-ink-2">{lastValue}</span>
        <span className="font-mono text-[11px] text-ink-muted">{age}</span>
      </span>
      <span className="hidden min-[700px]:block">
        {series && series.points.length > 1 && <Sparkline points={series.points} />}
      </span>
    </button>
  );
}

function ItemChartModal({ item, onClose }: { item: ZabbixItem; onClose: () => void }) {
  const [range, setRange] = useState<RangeValue>(() => rangeFromPreset("1h"));
  const [live, setLive] = useState(true);
  const numeric = isNumericItem(item);

  const { seriesByItem } = useTimeseries(
    numeric ? [{ itemid: item.itemid, valueType: Number(item.value_type) as 0 | 3 }] : [],
    range,
    { points: 800, enabled: numeric },
  );
  const series = seriesByItem.get(item.itemid);

  return (
    <div
      className="fixed inset-0 z-90 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-lg border border-line bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
          <div>
            <div className="text-[13.5px] font-semibold text-ink">{item.name}</div>
            <div className="font-mono text-[10.5px] text-ink-muted">{item.key_}</div>
          </div>
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
          {numeric && series ? (
            <TimeChart
              series={[{ label: item.name, points: series.points.map((p) => [p.t, p.v]) }]}
              unit={item.units}
              height={280}
              onBrush={(from, to) => setRange({ from, to })}
            />
          ) : (
            <div className="p-6 text-center text-sm text-ink-2">
              {numeric ? "Lade Zeitreihe…" : `Textwert: ${item.lastvalue ?? "–"}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HostPicker({
  hosts,
  selectedHostId,
  onSelect,
}: {
  hosts: { hostid: string; host: string; name: string }[];
  selectedHostId: string | undefined;
  onSelect: (hostId: string | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const selectedHost = hosts.find((h) => h.hostid === selectedHostId);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts.slice(0, 8);
    return hosts
      .filter((h) => h.name.toLowerCase().includes(q) || h.host.toLowerCase().includes(q))
      .slice(0, 8);
  }, [hosts, query]);

  if (selectedHost && !focused) {
    return (
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="text-ink-muted">Host:</span>
        <span className="font-medium text-ink">{selectedHost.name}</span>
        <button
          type="button"
          onClick={() => {
            onSelect(undefined);
            setQuery("");
          }}
          className="rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-ink-muted"
        >
          ✕ ändern
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 100)}
        placeholder="Host auswählen…"
        className="w-full max-w-sm rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
      />
      {focused && matches.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full max-w-sm overflow-y-auto rounded-md border border-line bg-surface shadow-md">
          {matches.map((h) => (
            <li key={h.hostid}>
              <button
                type="button"
                onMouseDown={() => {
                  onSelect(h.hostid);
                  setQuery("");
                }}
                className="block w-full px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-surface-2"
              >
                {h.name} <span className="font-mono text-[10.5px] text-ink-muted">{h.host}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
