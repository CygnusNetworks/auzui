import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ZabbixItem } from "@auzui/zabbix-client";
import { Spinner } from "../../components/Spinner";
import { RangePicker, type RangeValue } from "../../components/RangePicker";
import { isNumericItem } from "../../lib/latest-items";
import { parseItemIds } from "../../lib/metrics-facets";
import { parseMetricQuery } from "../../lib/metric-query";
import { useTimeseries } from "../../lib/use-timeseries";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { rangeFromPreset } from "@auzui/timeseries";
import { useAuthStore } from "../../lib/auth/store";
import { validateMetricsSearch } from "./search-params";
import { QueryBar } from "./QueryBar";
import { MetricMatrix } from "./MetricMatrix";
import { PanelStack } from "./PanelStack";
import { RecipeCards } from "./RecipeCards";
import {
  SEARCH_LIMIT,
  fetchRowItemIds,
  useExtraHostItems,
  useItemsByIds,
  useMetricsSearch,
  useRecipeGroupCounts,
} from "./use-metrics";
import { buildMetricMatrix, columnItemIds, rowItemIds, type MatrixRow } from "./matrix";
import { buildRecipes, pickLoadRecipeGroup, type Recipe } from "./recipes";
import {
  addRecentSet,
  buildRecentSetTitle,
  parseRecentSets,
  recentSetsKey,
  serializeRecentSets,
  type RecentSet,
} from "./recent-sets";
import { useT } from "../../lib/i18n";

const DEBOUNCE_MS = 400;

export function MetricsPage() {
  const t = useT();
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateMetricsSearch(rawSearch);
  const navigate = useNavigate();
  const username = useAuthStore((s) => s.username);

  const [qText, setQText] = useState(search.q ?? "");
  const debouncedQText = useDebouncedValue(qText, DEBOUNCE_MS);
  const [trayCollapsed, setTrayCollapsed] = useState(false);
  const [extraHostIds, setExtraHostIds] = useState<string[]>([]);
  const [rowBusy, setRowBusy] = useState(false);

  // Persist the query itself in the URL (?q=), same debounce as the search
  // fetch so the whole search stays a shareable link — mirrors ?items= below.
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
  const visible = useMemo(() => items.slice(0, SEARCH_LIMIT), [items]);
  const truncated = items.length > SEARCH_LIMIT;

  const selectedIds = useMemo(() => new Set(parseItemIds(search.items)), [search.items]);
  const selectedOrder = useMemo(() => parseItemIds(search.items), [search.items]);
  // Serien-Farbindex = Position in der (geordneten) Auswahl — konsistent für
  // Matrix, Legende und Panels.
  const colorIndexById = useMemo(() => new Map(selectedOrder.map((id, i) => [id, i])), [selectedOrder]);

  const setSelection = useCallback(
    (ids: string[]) => {
      const csv = ids.join(",");
      void navigate({ to: "/metrics", search: (prev) => ({ ...prev, items: csv || undefined }), replace: true });
    },
    [navigate],
  );

  const toggleItem = useCallback(
    (itemid: string) => {
      const next = selectedOrder.includes(itemid)
        ? selectedOrder.filter((id) => id !== itemid)
        : [...selectedOrder, itemid];
      setSelection(next);
    },
    [selectedOrder, setSelection],
  );

  const addItem = useCallback(
    (item: ZabbixItem) => {
      if (selectedIds.has(item.itemid)) return;
      setSelection([...selectedOrder, item.itemid]);
    },
    [selectedIds, selectedOrder, setSelection],
  );

  const removeItems = useCallback(
    (ids: string[]) => {
      const drop = new Set(ids);
      setSelection(selectedOrder.filter((id) => !drop.has(id)));
    },
    [selectedOrder, setSelection],
  );

  /** Add all `ids` if not already all selected, else remove them all (used by row/column headers). */
  const toggleGroup = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const allSelected = ids.every((id) => selectedIds.has(id));
      if (allSelected) {
        removeItems(ids);
      } else {
        const merged = [...selectedOrder];
        for (const id of ids) if (!selectedIds.has(id)) merged.push(id);
        setSelection(merged);
      }
    },
    [selectedIds, selectedOrder, removeItems, setSelection],
  );

  // --- Matrix (Vorschlag C) -------------------------------------------------
  const metricKeys = useMemo(() => [...new Set(visible.map((i) => i.key_))], [visible]);
  const extraQuery = useExtraHostItems(extraHostIds, metricKeys);
  const matrixItems = useMemo(
    () => [...visible, ...(extraQuery.data ?? [])],
    [visible, extraQuery.data],
  );
  const matrix = useMemo(() => buildMetricMatrix(matrixItems), [matrixItems]);

  const toggleRow = useCallback(
    (row: MatrixRow) => {
      const hostIds = matrix.columns.map((c) => c.hostid);
      setRowBusy(true);
      // Zeilenkopf togglet die Metrik auf ALLEN Spalten-Hosts — fehlende
      // itemids per exaktem key_-Filter nachladen (ein Request, kein Storm).
      void fetchRowItemIds(row.key_, hostIds)
        .then((fetched) => {
          const ids = fetched.length > 0 ? fetched : rowItemIds(row);
          toggleGroup(ids);
        })
        .catch(() => toggleGroup(rowItemIds(row)))
        .finally(() => setRowBusy(false));
    },
    [matrix.columns, toggleGroup],
  );

  const toggleColumn = useCallback(
    (columnIndex: number) => toggleGroup(columnItemIds(matrix, columnIndex)),
    [matrix, toggleGroup],
  );

  const addHost = useCallback((hostid: string) => {
    setExtraHostIds((prev) => (prev.includes(hostid) ? prev : [...prev, hostid]));
  }, []);

  // --- Selected items (panels + recent-set titles) --------------------------
  const selectedItemsQuery = useItemsByIds(selectedOrder);
  const selectedItems = useMemo(() => selectedItemsQuery.data ?? [], [selectedItemsQuery.data]);

  // --- Recipes (Vorschlag A) ------------------------------------------------
  const hasQuery = parsedQuery.tokens.length > 0 || parsedQuery.text.length > 0;
  const showRecipes = !hasQuery && selectedIds.size === 0;
  const recipeGroupsQuery = useRecipeGroupCounts(showRecipes);
  const [recentSets, setRecentSets] = useState<RecentSet[]>([]);

  // Load recent sets for the current user.
  useEffect(() => {
    try {
      setRecentSets(parseRecentSets(localStorage.getItem(recentSetsKey(username))));
    } catch {
      setRecentSets([]);
    }
  }, [username]);

  // Record the current selection as a recent set whenever it changes (and its
  // labels have resolved, so the title is meaningful).
  const selectedKey = useMemo(() => [...selectedOrder].sort().join(","), [selectedOrder]);
  useEffect(() => {
    if (selectedOrder.length === 0) return;
    if (selectedItems.length < selectedOrder.length) return; // wait for labels
    const title = buildRecentSetTitle(selectedItems.map((i) => i.name));
    const set: RecentSet = { title, items: selectedOrder, query: debouncedQText.trim(), ts: Date.now() };
    setRecentSets((prev) => {
      const next = addRecentSet(prev, set);
      try {
        localStorage.setItem(recentSetsKey(username), serializeRecentSets(next));
      } catch {
        // localStorage unavailable (private mode) — recents stay in-memory only.
      }
      return next;
    });
    // Deliberately keyed on the selection (and label-resolution) only — the
    // query/username are read fresh but must not, on their own, re-record.
  }, [selectedKey, selectedItems.length]);

  const recipes = useMemo(
    () => buildRecipes(pickLoadRecipeGroup(recipeGroupsQuery.data ?? []), recentSets),
    [recipeGroupsQuery.data, recentSets],
  );

  const applyRecipe = useCallback(
    (recipe: Recipe) => {
      setQText(recipe.query);
      setSelection(recipe.items);
      setExtraHostIds([]);
    },
    [setSelection],
  );

  const showSpinner = searchQuery.isLoading;

  return (
    <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pb-4 pt-4.5">
      <div className="mb-1 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">{t("metrics.title")}</h1>
        <span className="font-mono text-[10.5px] text-ink-muted">{t("metrics.classification")}</span>
      </div>
      <p className="mb-4 max-w-3xl text-[13px] text-ink-2">{t("metrics.subtitle")}</p>

      <QueryBar value={qText} onChange={setQText} items={items} onAddItem={addItem} selectedIds={selectedIds} />

      <div className="mt-3" style={{ paddingBottom: selectedIds.size > 0 ? (trayCollapsed ? 48 : 420) : 0 }}>
        {showSpinner ? (
          <div className="flex items-center justify-center rounded-lg border border-line bg-surface p-10">
            <Spinner />
          </div>
        ) : showRecipes ? (
          <RecipeCards recipes={recipes} onApply={applyRecipe} />
        ) : !hasQuery ? (
          <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">
            <div className="font-medium text-ink">{t("metrics.emptyStateTitle")}</div>
            <div className="mt-1">{t("metrics.emptyStateHint")}</div>
          </div>
        ) : matrix.rows.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">
            <div className="font-medium text-ink">{t("metrics.emptyStateTitle")}</div>
            <div className="mt-1">{t("metrics.emptyStateHint")}</div>
          </div>
        ) : (
          <>
            {(truncated || matrix.columnsTruncated) && (
              <div className="mb-2 font-mono text-[10.5px] text-ink-muted">
                {truncated ? t("metrics.truncatedHint", visible.length) : t("metrics.matrix.columnsTruncated")}
              </div>
            )}
            <MetricMatrix
              matrix={matrix}
              selectedIds={selectedIds}
              colorIndexById={colorIndexById}
              onToggleCell={toggleItem}
              onToggleRow={toggleRow}
              onToggleColumn={toggleColumn}
              onAddHost={addHost}
              addHostBusy={extraQuery.isFetching || rowBusy}
            />
          </>
        )}
      </div>

      {selectedIds.size > 0 && (
        <GraphTray
          items={selectedItems}
          itemsLoading={selectedItemsQuery.isLoading}
          colorIndexById={colorIndexById}
          collapsed={trayCollapsed}
          onToggleCollapsed={() => setTrayCollapsed((v) => !v)}
          onRemoveItems={removeItems}
        />
      )}
    </div>
  );
}

function GraphTray({
  items,
  itemsLoading,
  colorIndexById,
  collapsed,
  onToggleCollapsed,
  onRemoveItems,
}: {
  items: ZabbixItem[];
  itemsLoading: boolean;
  colorIndexById: Map<string, number>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRemoveItems: (itemIds: string[]) => void;
}) {
  const t = useT();
  const [range, setRange] = useState<RangeValue>(() => rangeFromPreset("1h"));
  const [live, setLive] = useState(true);
  const [copied, setCopied] = useState(false);
  const numericItems = useMemo(() => items.filter(isNumericItem), [items]);

  const { seriesByItem, isLoading, isFetching, slow, refetch } = useTimeseries(
    numericItems.map((i) => ({ itemid: i.itemid, valueType: Number(i.value_type) as 0 | 3 })),
    range,
    { points: 800, enabled: numericItems.length > 0 && !collapsed },
  );

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
          <span className="font-mono text-[10.5px] text-ink-muted">
            {t("metrics.tray.selectedCount", items.length)}
          </span>
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
          <div className="max-h-[360px] overflow-y-auto pb-3">
            {itemsLoading ? (
              <div className="flex items-center justify-center p-6">
                <Spinner />
              </div>
            ) : numericItems.length === 0 ? (
              <div className="p-6 text-center text-sm text-ink-2">{t("metrics.tray.empty")}</div>
            ) : (
              <PanelStack
                items={numericItems}
                seriesByItem={seriesByItem}
                colorIndexById={colorIndexById}
                isLoading={isLoading}
                isFetching={isFetching}
                slow={slow}
                onRetry={() => void refetch()}
                onBrush={(from, to) => setRange({ from, to })}
                onRemovePanel={onRemoveItems}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
