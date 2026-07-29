import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ZabbixItem } from "@auzui/zabbix-client";
import { Spinner } from "../../components/Spinner";
import { RangePicker, type RangeValue } from "../../components/RangePicker";
import { TimeChartPanel } from "../../components/charts/TimeChartPanel";
import { formatUnitValue } from "../../lib/format-units";
import { isNumericItem } from "../../lib/latest-items";
import { parseItemIds } from "../../lib/metrics-facets";
import { parseMetricQuery } from "../../lib/metric-query";
import { useTimeseries } from "../../lib/use-timeseries";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { rangeFromPreset } from "@auzui/timeseries";
import { validateMetricsSearch } from "./search-params";
import { QueryBar } from "./QueryBar";
import { SEARCH_LIMIT, useItemsByIds, useMetricsSearch } from "./use-metrics";
import { useLocale, useT } from "../../lib/i18n";

const DEBOUNCE_MS = 400;

export function MetricsPage() {
  const t = useT();
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateMetricsSearch(rawSearch);
  const navigate = useNavigate();

  const [qText, setQText] = useState(search.q ?? "");
  const debouncedQText = useDebouncedValue(qText, DEBOUNCE_MS);
  const [trayCollapsed, setTrayCollapsed] = useState(false);

  // Persist the query itself in the URL (?q=), same debounce as the search
  // fetch so the whole search stays a shareable link — mirrors the existing
  // ?items= pattern below.
  useEffect(() => {
    void navigate({
      to: "/metrics",
      search: (prev) => ({ ...prev, q: debouncedQText || undefined }),
      replace: true,
    });
  }, [debouncedQText, navigate]);

  const parsedQuery = useMemo(() => parseMetricQuery(debouncedQText), [debouncedQText]);
  const searchQuery = useMetricsSearch(parsedQuery);

  const items = searchQuery.data ?? [];
  const visible = items.slice(0, SEARCH_LIMIT);
  const truncated = items.length > SEARCH_LIMIT;

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

  function addItem(item: ZabbixItem) {
    if (selectedIds.has(item.itemid)) return;
    const next = new Set(selectedIds);
    next.add(item.itemid);
    setSelection(next);
  }

  function removeItem(itemid: string) {
    const next = new Set(selectedIds);
    next.delete(itemid);
    setSelection(next);
  }

  const showSpinner = searchQuery.isLoading;
  const hasQuery = parsedQuery.tokens.length > 0 || parsedQuery.text.length > 0;

  return (
    <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pb-4 pt-4.5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">{t("metrics.title")}</h1>
        <span className="text-[13px] text-ink-2">{t("metrics.subtitle")}</span>
        <span className="font-mono text-[10.5px] text-ink-muted">{t("metrics.classification")}</span>
      </div>

      <QueryBar value={qText} onChange={setQText} items={items} onAddItem={addItem} selectedIds={selectedIds} />

      <div className="mt-3" style={{ paddingBottom: selectedIds.size > 0 ? (trayCollapsed ? 48 : 360) : 0 }}>
        {showSpinner ? (
          <div className="flex items-center justify-center rounded-lg border border-line bg-surface p-10">
            <Spinner />
          </div>
        ) : !hasQuery ? (
          <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">
            <div className="font-medium text-ink">{t("metrics.emptyStateTitle")}</div>
            <div className="mt-1">{t("metrics.emptyStateHint")}</div>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">
            <div className="font-medium text-ink">{t("metrics.emptyStateTitle")}</div>
            <div className="mt-1">{t("metrics.emptyStateHint")}</div>
          </div>
        ) : (
          <>
            {truncated && (
              <div className="mb-2 font-mono text-[10.5px] text-ink-muted">
                {t("metrics.truncatedHint", visible.length)}
              </div>
            )}
            <ResultsTable items={visible} selectedIds={selectedIds} onToggle={toggleItem} />
          </>
        )}
      </div>

      {selectedIds.size > 0 && (
        <GraphTray
          itemIds={[...selectedIds]}
          collapsed={trayCollapsed}
          onToggleCollapsed={() => setTrayCollapsed((v) => !v)}
          onRemove={removeItem}
        />
      )}
    </div>
  );
}

function ResultsTable({
  items,
  selectedIds,
  onToggle,
}: {
  items: ZabbixItem[];
  selectedIds: Set<string>;
  onToggle: (itemid: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[560px] text-[12.5px]">
        <thead>
          <tr className="border-b border-line-soft text-left font-mono text-[10.5px] uppercase tracking-wider text-ink-muted">
            <th className="px-3 py-2 font-normal">{t("metrics.table.item")}</th>
            <th className="px-3 py-2 font-normal">{t("metrics.table.host")}</th>
            <th className="px-3 py-2 font-normal">{t("metrics.table.lastValue")}</th>
            <th className="px-3 py-2 font-normal" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const hostName = item.hosts?.[0]?.name ?? item.hosts?.[0]?.host ?? t("metrics.noValue");
            const lastValue =
              item.lastvalue !== undefined && item.lastvalue !== ""
                ? formatUnitValue(Number(item.lastvalue), item.units, 1, locale)
                : t("metrics.noValue");
            const added = selectedIds.has(item.itemid);
            return (
              <tr key={item.itemid} className="border-b border-line-soft last:border-0 hover:bg-surface-2">
                <td className="max-w-[320px] truncate px-3 py-2 font-medium text-ink" title={item.name}>
                  {item.name}
                </td>
                <td className="max-w-[180px] truncate px-3 py-2 font-mono text-[10.5px] text-ink-muted" title={hostName}>
                  {hostName}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-ink">{lastValue}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onToggle(item.itemid)}
                    className={`rounded-md border px-2 py-1 text-[11.5px] font-semibold ${
                      added
                        ? "border-accent/40 bg-accent-soft text-accent"
                        : "border-line bg-surface-2 text-ink-2"
                    }`}
                  >
                    {added ? t("metrics.addedButton") : t("metrics.addButton")}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GraphTray({
  itemIds,
  collapsed,
  onToggleCollapsed,
  onRemove,
}: {
  itemIds: string[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRemove: (itemid: string) => void;
}) {
  const t = useT();
  const [range, setRange] = useState<RangeValue>(() => rangeFromPreset("1h"));
  const [live, setLive] = useState(true);
  const [copied, setCopied] = useState(false);
  const itemsQuery = useItemsByIds(itemIds);
  const items = itemsQuery.data ?? [];
  const numericItems = useMemo(() => items.filter(isNumericItem), [items]);

  const { seriesByItem, isLoading, slow, refetch } = useTimeseries(
    numericItems.map((i) => ({ itemid: i.itemid, valueType: Number(i.value_type) as 0 | 3 })),
    range,
    { points: 800, enabled: numericItems.length > 0 && !collapsed },
  );

  const chartSeries = numericItems.map((item) => {
    const hostName = item.hosts?.[0]?.name ?? item.hosts?.[0]?.host ?? "";
    const series = seriesByItem.get(item.itemid);
    return {
      label: `${hostName}: ${item.name}`,
      points: (series?.points ?? []).map((p) => [p.t, p.v] as [number, number]),
    };
  });
  const commonUnit =
    numericItems.length > 0 && numericItems.every((i) => i.units === numericItems[0]!.units)
      ? numericItems[0]!.units
      : undefined;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable (e.g. insecure context) — silently ignore, link stays in the URL bar anyway
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
      <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5">
        <div className="flex flex-wrap items-center gap-2 py-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink-2"
            aria-label={collapsed ? t("metrics.tray.expand") : t("metrics.tray.collapse")}
          >
            {collapsed ? "▲" : "▼"}
          </button>
          <span className="text-[13px] font-semibold text-ink">{t("metrics.tray.title")}</span>
          <span className="font-mono text-[10.5px] text-ink-muted">{t("metrics.tray.selectedCount", itemIds.length)}</span>
          {!collapsed && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <RangePicker value={range} onChange={setRange} live={live} onLiveChange={setLive} />
              <button
                type="button"
                onClick={() => void copyLink()}
                className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] font-semibold text-ink-2"
              >
                {copied ? t("metrics.tray.linkCopied") : t("metrics.tray.copyLink")}
              </button>
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="pb-3">
            {itemsQuery.isLoading ? (
              <div className="flex items-center justify-center p-6">
                <Spinner />
              </div>
            ) : numericItems.length === 0 ? (
              <div className="p-6 text-center text-sm text-ink-2">{t("metrics.tray.empty")}</div>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {numericItems.map((item) => {
                    const hostName = item.hosts?.[0]?.name ?? item.hosts?.[0]?.host ?? "";
                    return (
                      <span
                        key={item.itemid}
                        className="inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2"
                      >
                        {hostName}: {item.name}
                        <button
                          type="button"
                          onClick={() => onRemove(item.itemid)}
                          className="text-ink-muted"
                          aria-label={t("metrics.tray.remove", item.name)}
                        >
                          ✕
                        </button>
                      </span>
                    );
                  })}
                </div>
                <TimeChartPanel
                  series={chartSeries}
                  unit={commonUnit}
                  height={220}
                  onBrush={(from, to) => setRange({ from, to })}
                  isLoading={isLoading}
                  slow={slow}
                  onRetry={() => void refetch()}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
