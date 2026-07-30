import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ZabbixItem } from "@auzui/zabbix-client";
import { Sparkline } from "../../components/Sparkline";
import { RangePicker, type RangeValue } from "../../components/RangePicker";
import { TimeChartPanel } from "../../components/charts/TimeChartPanel";
import { formatUnitValue } from "../../lib/format-units";
import { formatAge } from "../../lib/problems";
import { isNumericItem, resolveItemName } from "../../lib/latest-items";
import { useTimeseries } from "../../lib/use-timeseries";
import { rangeFromPreset } from "@auzui/timeseries";
import { classifyConstancy, type Constancy, type ConstancyRange } from "../../lib/constant-items";
import {
  buildSections,
  resolveTemplate,
  type DisplayTemplate,
  type SectionSeriesItem,
  type TemplateSection,
} from "../../lib/display-templates";
import { validateLatestDataSearch } from "./search-params";
import { useAllHostsForPicker, useHostTemplates, useLatestItems } from "./use-latest-items";
import { useLocale, useT } from "../../lib/i18n";

const FACTS_SECTION_ID = "facts";
const CHART_COLOR_VARS = ["--color-chart-1", "--color-chart-2", "--color-chart-3", "--color-chart-4"];

export function LatestDataPage() {
  const t = useT();
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateLatestDataSearch(rawSearch);
  const navigate = useNavigate();

  const hostsQuery = useAllHostsForPicker();
  const hostTemplatesQuery = useHostTemplates(search.host);
  const itemsQuery = useLatestItems(search.host);
  const items = itemsQuery.data ?? [];

  const [selectedItem, setSelectedItem] = useState<ZabbixItem | undefined>();
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [range, setRange] = useState<RangeValue>(() => rangeFromPreset("1h"));
  const [live, setLive] = useState(true);

  const template = useMemo(
    () => resolveTemplate(hostTemplatesQuery.data, items),
    [hostTemplatesQuery.data, items],
  );
  const rawSections = useMemo(() => buildSections(template, items), [template, items]);

  // Items the template bound into a bundle or family are ALWAYS shown in their
  // consolidated graph and are entirely exempt from the constancy/fact
  // classification — a CPU or ICMP-loss series that looks flat over a short
  // range (or has a constant lastvalue==prevvalue) must not be pulled out of
  // its graph. Facts are derived only from unmatched ("free") items.
  const matchedIds = useMemo(() => {
    const set = new Set<string>();
    for (const section of rawSections) {
      if (section.kind === "bundle" || section.kind === "family") {
        for (const si of section.items) set.add(si.item.itemid);
      }
    }
    return set;
  }, [rawSections]);

  // The currently viewed range, in the shape classifyConstancy wants for its
  // text-item age heuristic. Deriving it here (rather than inside the memo)
  // keeps baseFactIds reactive to range changes → the fact classification is
  // reversible when the range widens/shifts.
  const constancyRange = useMemo<ConstancyRange>(
    () => ({ now: range.to, rangeSeconds: Math.max(1, range.to - range.from) }),
    [range],
  );

  // Free items whose lastvalue/prevvalue never differ — or, for text items,
  // whose value is older than half the viewed range (cheap, from item.get
  // alone) — are unconditionally facts. Free items shown in a component
  // section additionally promote into facts once their loaded series proves
  // min==max (or exactly one change) over the current range — see onClassified.
  const baseFactIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (matchedIds.has(item.itemid)) continue;
      if (classifyConstancy(item, undefined, constancyRange).kind === "constant") set.add(item.itemid);
    }
    return set;
  }, [items, matchedIds, constancyRange]);
  const [promoted, setPromoted] = useState<Map<string, Constancy>>(new Map());

  // Records a series-based classification for a free (component-section) item.
  // A "variable" verdict REMOVES any prior promotion so an item does not get
  // trapped in the facts rubric once a widened range reveals it does vary —
  // the promotion is fully reversible.
  const onClassified = useCallback((itemid: string, constancy: Constancy) => {
    setPromoted((prev) => {
      const existing = prev.get(itemid);
      if (constancy.kind === "variable") {
        if (!existing) return prev;
        const next = new Map(prev);
        next.delete(itemid);
        return next;
      }
      if (existing && JSON.stringify(existing) === JSON.stringify(constancy)) return prev;
      const next = new Map(prev);
      next.set(itemid, constancy);
      return next;
    });
  }, []);

  const factDetails = useMemo(() => {
    const map = new Map<string, Constancy>();
    for (const id of baseFactIds) map.set(id, { kind: "constant" });
    // A promotion may linger from before an item became bundle/family-matched
    // (or a template change) — never let a matched item into the facts map.
    for (const [id, c] of promoted) {
      if (!matchedIds.has(id)) map.set(id, c);
    }
    return map;
  }, [baseFactIds, promoted, matchedIds]);

  const sections = useMemo(
    () =>
      rawSections
        .map((section) => ({
          ...section,
          items: section.items.filter((si) => !factDetails.has(si.item.itemid)),
        }))
        .filter((section) => section.items.length > 0),
    [rawSections, factDetails],
  );
  const factItems = useMemo(
    () => items.filter((item) => factDetails.has(item.itemid)),
    [items, factDetails],
  );

  const selectedId =
    search.section && (sections.some((s) => s.id === search.section) || search.section === FACTS_SECTION_ID)
      ? search.section
      : (sections[0]?.id ?? FACTS_SECTION_ID);
  const selectedSection = sections.find((s) => s.id === selectedId);

  function pickHost(hostId: string | undefined) {
    void navigate({ to: "/latest-data", search: { host: hostId }, replace: true });
  }

  function pickSection(id: string) {
    void navigate({ to: "/latest-data", search: { host: search.host, section: id }, replace: true });
  }

  return (
    <div className="mx-auto max-w-[1400px] px-3 pb-16 pt-4.5 min-[700px]:px-5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-center gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">{t("latestData.title")}</h1>
        <span className="text-[13px] text-ink-2">{t("latestData.subtitle")}</span>
        {search.host && (
          <button
            type="button"
            onClick={() => setTemplateDialogOpen(true)}
            className="ml-auto rounded-full border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-2 hover:bg-surface-3"
          >
            {t("latestData.templateChip", template?.label ?? t("latestData.templateNone"))}
          </button>
        )}
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
          {t("latestData.selectHostFirst")}
        </div>
      ) : itemsQuery.isLoading ? (
        <div className="rounded-lg border border-line bg-surface p-6 text-sm text-ink-2">
          {t("latestData.loadingItems")}
        </div>
      ) : sections.length === 0 && factItems.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">
          {t("latestData.noItems")}
        </div>
      ) : (
        <div className="flex flex-col gap-3 min-[820px]:flex-row min-[820px]:items-start">
          <SectionNav
            sections={sections}
            selectedId={selectedId}
            onSelect={pickSection}
            factsCount={factItems.length}
          />
          <div className="min-w-0 flex-1 rounded-lg border border-line bg-surface">
            {selectedId === FACTS_SECTION_ID ? (
              <FactsView items={factItems} details={factDetails} />
            ) : selectedSection ? (
              selectedSection.kind === "component" ? (
                <LegacySectionView
                  section={selectedSection}
                  range={range}
                  constancyRange={constancyRange}
                  onSelectItem={setSelectedItem}
                  onClassified={onClassified}
                />
              ) : (
                <ConsolidatedSectionView
                  section={selectedSection}
                  range={range}
                  onRangeChange={setRange}
                  live={live}
                  onLiveChange={setLive}
                  onSelectItem={setSelectedItem}
                />
              )
            ) : (
              <div className="p-10 text-center text-sm text-ink-2">{t("latestData.noItems")}</div>
            )}
          </div>
        </div>
      )}

      {selectedItem && (
        <ItemChartModal
          // Re-key per item so the modal re-seeds its local range/live from the
          // page state when the user opens a different item without closing.
          key={selectedItem.itemid}
          item={selectedItem}
          initialRange={range}
          initialLive={live}
          onClose={() => setSelectedItem(undefined)}
        />
      )}
      {templateDialogOpen && (
        <TemplateDialog template={template} onClose={() => setTemplateDialogOpen(false)} />
      )}
    </div>
  );
}

/**
 * Left nav (sticky sidebar ≥820px) / horizontal chip scroller (<820px), per
 * Entwurf B. Bundle/family sections are nested under their navGroup (e.g.
 * "Netzwerk > eth0"); leftover component sections form their own
 * single-entry group. "📌 Fakten" is always pinned last.
 */
function SectionNav({
  sections,
  selectedId,
  onSelect,
  factsCount,
}: {
  sections: TemplateSection[];
  selectedId: string;
  onSelect: (id: string) => void;
  factsCount: number;
}) {
  const t = useT();
  const groups = useMemo(() => {
    const byGroup = new Map<string, TemplateSection[]>();
    for (const section of sections) {
      const list = byGroup.get(section.navGroup) ?? [];
      list.push(section);
      byGroup.set(section.navGroup, list);
    }
    return [...byGroup.entries()];
  }, [sections]);

  return (
    <>
      {/* Desktop: sticky vertical nav */}
      <nav className="hidden w-56 shrink-0 min-[820px]:sticky min-[820px]:top-4 min-[820px]:block">
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-2.5">
          {groups.map(([group, groupSections]) => (
            <div key={group}>
              <div className="px-1.5 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                {group}
              </div>
              <div className="flex flex-col gap-0.5">
                {groupSections.map((section) => (
                  <NavButton
                    key={section.id}
                    label={section.label}
                    count={section.items.length}
                    active={section.id === selectedId}
                    onClick={() => onSelect(section.id)}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="mt-1 border-t border-line-soft pt-2">
            <NavButton
              label={t("latestData.factsNavLabel")}
              count={factsCount}
              active={selectedId === FACTS_SECTION_ID}
              onClick={() => onSelect(FACTS_SECTION_ID)}
            />
          </div>
        </div>
      </nav>

      {/* Mobile: horizontal chip scroller */}
      <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 min-[820px]:hidden">
        {sections.map((section) => (
          <Chip
            key={section.id}
            label={`${section.navGroup} · ${section.label}`}
            active={section.id === selectedId}
            onClick={() => onSelect(section.id)}
          />
        ))}
        <Chip
          label={t("latestData.factsNavLabel")}
          active={selectedId === FACTS_SECTION_ID}
          onClick={() => onSelect(FACTS_SECTION_ID)}
        />
      </nav>
    </>
  );
}

function NavButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${
        active ? "bg-surface-3 font-semibold text-ink" : "text-ink-2 hover:bg-surface-2"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-[10.5px] text-ink-muted">{count}</span>
    </button>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11.5px] whitespace-nowrap ${
        active ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-surface text-ink-2"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Bundle/Family rubric: a consolidated panel driven by each bound item's
 * displayRole — "line" items share one multi-series chart (same-unit items
 * only; a family like vfs.fs mixes bytes and % items, so only the majority
 * unit is charted), while "stat" items (e.g. packet-loss %) render as compact
 * value tiles and "status" items (e.g. 0/1 ping) as up/down badges beside it.
 * Every bound item is also listed as a row below. Bundle/family items are
 * ALWAYS shown here regardless of constancy — the facts promotion lives with
 * the free-item (component) view only.
 */
function ConsolidatedSectionView({
  section,
  range,
  onRangeChange,
  live,
  onLiveChange,
  onSelectItem,
}: {
  section: TemplateSection;
  range: RangeValue;
  onRangeChange: (range: RangeValue) => void;
  live: boolean;
  onLiveChange: (live: boolean) => void;
  onSelectItem: (item: ZabbixItem) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const lineBound = useMemo(
    () => section.items.filter((si) => isNumericItem(si.item) && (si.displayRole ?? "line") === "line"),
    [section.items],
  );
  const statItems = useMemo(
    () => section.items.filter((si) => si.displayRole === "stat"),
    [section.items],
  );
  const statusItems = useMemo(
    () => section.items.filter((si) => si.displayRole === "status"),
    [section.items],
  );

  const { seriesByItem, isLoading, isFetching, slow, refetch } = useTimeseries(
    lineBound.map((si) => ({ itemid: si.item.itemid, valueType: Number(si.item.value_type) as 0 | 3 })),
    range,
    { points: 300 },
  );

  const chartUnit = lineBound[0]?.item.units;
  const chartBound = lineBound.filter((si) => si.item.units === chartUnit);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-3.5 py-2.5">
        <div>
          <div className="text-[13.5px] font-semibold text-ink">{section.label}</div>
          <div className="font-mono text-[10.5px] text-ink-muted">{section.navGroup}</div>
        </div>
        <div className="ml-auto">
          <RangePicker value={range} onChange={onRangeChange} live={live} onLiveChange={onLiveChange} />
        </div>
      </div>

      <div className="p-3.5">
        {chartBound.length > 0 && (
          <>
            <TimeChartPanel
              series={chartBound.map((si) => ({
                label: si.seriesLabel,
                points: (seriesByItem.get(si.item.itemid)?.points ?? []).map(
                  (p) => [p.t, p.v] as [number, number],
                ),
              }))}
              unit={chartUnit}
              height={240}
              isLoading={isLoading}
              isFetching={isFetching}
              slow={slow}
              onRetry={() => void refetch()}
              onBrush={(from, to) => onRangeChange({ from, to })}
            />
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
              {chartBound.map((si, i) => (
                <span key={si.item.itemid} className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: `var(${CHART_COLOR_VARS[i % CHART_COLOR_VARS.length]})` }}
                  />
                  {si.seriesLabel}
                  <span className="font-mono text-ink-muted">
                    {t("latestData.legendCurrent")}{" "}
                    {si.item.lastvalue !== undefined && si.item.lastvalue !== ""
                      ? formatUnitValue(Number(si.item.lastvalue), si.item.units, 1, locale)
                      : t("latestData.noValue")}
                  </span>
                </span>
              ))}
            </div>
          </>
        )}

        {(statItems.length > 0 || statusItems.length > 0) && (
          <div
            className={`flex flex-wrap gap-2 ${chartBound.length > 0 ? "mt-3 border-t border-line-soft pt-3" : ""}`}
          >
            {statusItems.map((si) => (
              <StatusBadge key={si.item.itemid} bound={si} onClick={() => onSelectItem(si.item)} />
            ))}
            {statItems.map((si) => (
              <StatTile key={si.item.itemid} bound={si} onClick={() => onSelectItem(si.item)} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-line-soft">
        {section.items.map((si) => (
          <BoundItemRow key={si.item.itemid} bound={si} onOpen={() => onSelectItem(si.item)} />
        ))}
      </div>
    </div>
  );
}

/** Severity tone for a percentage-style "stat" value (0 = ok, small = warn, large = high). */
function percentTone(value: number): { text: string; bg: string } {
  if (value <= 0) return { text: "text-sev-ok", bg: "bg-sev-ok/15" };
  if (value < 5) return { text: "text-sev-warn", bg: "bg-sev-warn/15" };
  return { text: "text-sev-high", bg: "bg-sev-high/15" };
}

/** Severity tone for a count-style "stat" value (errors/dropped): 0 = ok, anything > 0 = high. */
function countTone(value: number): { text: string; bg: string } {
  return value > 0
    ? { text: "text-sev-high", bg: "bg-sev-high/15" }
    : { text: "text-sev-ok", bg: "bg-sev-ok/15" };
}

/**
 * Compact value tile for a "stat"-role item: a percentage (e.g. ICMP packet
 * loss %) or an interface errors/dropped counter. Errors/dropped are absolute
 * counts, so they use the count tone (0 ok, >0 high) instead of the percent
 * warn/high bands, and are not forced into a "%" unit.
 */
function StatTile({ bound, onClick }: { bound: SectionSeriesItem; onClick: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { item, seriesLabel, seriesRole } = bound;
  const isCount = seriesRole === "errors" || seriesRole === "dropped";
  const has = item.lastvalue !== undefined && item.lastvalue !== "";
  const numValue = has ? Number(item.lastvalue) : Number.NaN;
  const tone =
    has && Number.isFinite(numValue)
      ? isCount
        ? countTone(numValue)
        : percentTone(numValue)
      : { text: "text-ink-2", bg: "bg-surface-2" };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-[84px] flex-col rounded-md px-2.5 py-1.5 text-left ${tone.bg} hover:opacity-90`}
    >
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">{seriesLabel}</span>
      <span className={`font-mono text-[15px] font-semibold ${tone.text}`}>
        {has && Number.isFinite(numValue)
          ? formatUnitValue(numValue, isCount ? item.units : item.units || "%", 1, locale)
          : t("latestData.noValue")}
      </span>
    </button>
  );
}

/** up/down badge for a "status"-role bundle/family item (a 0/1 value, e.g. icmpping or ifOperStatus). */
function StatusBadge({ bound, onClick }: { bound: SectionSeriesItem; onClick: () => void }) {
  const t = useT();
  const { item, seriesLabel } = bound;
  const has = item.lastvalue !== undefined && item.lastvalue !== "";
  const up = isStatusUp(item.lastvalue);
  const tone = !has
    ? { text: "text-ink-2", bg: "bg-surface-2", dot: "bg-ink-muted" }
    : up
      ? { text: "text-sev-ok", bg: "bg-sev-ok/15", dot: "bg-sev-ok" }
      : { text: "text-sev-high", bg: "bg-sev-high/15", dot: "bg-sev-high" };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left ${tone.bg} hover:opacity-90`}
    >
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${tone.dot}`} />
      <span className="flex flex-col leading-tight">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">{seriesLabel}</span>
        <span className={`text-[12.5px] font-semibold ${tone.text}`}>
          {!has ? t("latestData.noValue") : up ? t("latestData.statusUp") : t("latestData.statusDown")}
        </span>
      </span>
    </button>
  );
}

/** A 0/1-style status reads as "up" for 1 (and common textual truthy forms), everything else down. */
function isStatusUp(lastvalue: string | undefined): boolean {
  if (lastvalue === undefined) return false;
  const v = lastvalue.trim().toLowerCase();
  return v === "1" || v === "up" || v === "true";
}

/**
 * Old-style per-item-sparkline rendering, kept for leftover component-tag
 * ("free") sections. This is the only place series-based constancy promotion
 * runs: once a free numeric item's series (loaded over the page's current
 * range) proves constant / changed-once, it is promoted into the Facts rubric;
 * once it proves variable it is demoted again — the classification tracks the
 * range and is reversible (onClassified handles both directions).
 */
function LegacySectionView({
  section,
  range,
  constancyRange,
  onSelectItem,
  onClassified,
}: {
  section: TemplateSection;
  range: RangeValue;
  constancyRange: ConstancyRange;
  onSelectItem: (item: ZabbixItem) => void;
  onClassified: (itemid: string, constancy: Constancy) => void;
}) {
  const items = useMemo(() => section.items.map((si) => si.item), [section.items]);
  const numericItems = useMemo(() => items.filter(isNumericItem), [items]);
  const { seriesByItem } = useTimeseries(
    numericItems.map((i) => ({ itemid: i.itemid, valueType: Number(i.value_type) as 0 | 3 })),
    range,
    { points: 40 },
  );

  useEffect(() => {
    for (const item of numericItems) {
      const series = seriesByItem.get(item.itemid);
      // Wait for the series to actually load before flipping an item between
      // section and facts — an empty/absent series must not cause a spurious
      // (and visually jarring) demotion on every range change.
      if (!series || series.points.length === 0) continue;
      onClassified(item.itemid, classifyConstancy(item, series.points, constancyRange));
    }
  }, [numericItems, seriesByItem, onClassified, constancyRange]);

  return (
    <div>
      <div className="border-b border-line-soft px-3.5 py-2.5">
        <div className="text-[13.5px] font-semibold text-ink">{section.label}</div>
      </div>
      {items.map((item) => (
        <ItemRow
          key={item.itemid}
          item={item}
          series={seriesByItem.get(item.itemid)}
          onOpen={() => onSelectItem(item)}
        />
      ))}
    </div>
  );
}

function BoundItemRow({ bound, onOpen }: { bound: SectionSeriesItem; onOpen: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { item, seriesLabel } = bound;
  const numeric = isNumericItem(item);
  const lastValue =
    item.lastvalue !== undefined && item.lastvalue !== ""
      ? numeric
        ? formatUnitValue(Number(item.lastvalue), item.units, 1, locale)
        : item.lastvalue
      : t("latestData.noValue");
  const age = item.lastclock ? formatAge(Number(item.lastclock), undefined, locale) : t("latestData.noValue");

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 border-b border-line-soft px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-surface-2 min-[700px]:grid min-[700px]:grid-cols-[1fr_1.4fr_1fr_140px] min-[700px]:items-center min-[700px]:gap-3"
    >
      <span className="truncate font-medium text-ink-2">{seriesLabel}</span>
      <span className="min-w-0">
        <div className="truncate text-ink">{resolveItemName(item)}</div>
        <div className="truncate font-mono text-[10.5px] text-ink-muted">{item.key_}</div>
      </span>
      <span className="truncate font-mono text-ink-2">{lastValue}</span>
      <span className="font-mono text-[11px] text-ink-muted">{age}</span>
    </button>
  );
}

function FactsView({ items, details }: { items: ZabbixItem[]; details: Map<string, Constancy> }) {
  const t = useT();
  const { locale } = useLocale();
  const [copiedId, setCopiedId] = useState<string | undefined>();

  async function copyValue(item: ZabbixItem) {
    const value = item.lastvalue ?? "";
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(item.itemid);
      setTimeout(() => setCopiedId((cur) => (cur === item.itemid ? undefined : cur)), 1200);
    } catch {
      // clipboard API unavailable (insecure context, permissions) — no-op, nothing else to fall back to
    }
  }

  return (
    <div>
      <div className="border-b border-line-soft px-3.5 py-2.5">
        <div className="text-[13.5px] font-semibold text-ink">{t("latestData.factsNavLabel")}</div>
        <div className="text-[12px] text-ink-2">{t("latestData.factsSubtitle")}</div>
      </div>
      {items.length === 0 ? (
        <div className="p-10 text-center text-sm text-ink-2">{t("latestData.noFacts")}</div>
      ) : (
        items.map((item) => {
          const constancy = details.get(item.itemid);
          const numeric = isNumericItem(item);
          const displayValue =
            item.lastvalue !== undefined && item.lastvalue !== ""
              ? numeric
                ? formatUnitValue(Number(item.lastvalue), item.units, 1, locale)
                : item.lastvalue
              : t("latestData.noValue");
          return (
            <button
              key={item.itemid}
              type="button"
              onClick={() => void copyValue(item)}
              title={t("latestData.factCopyHint")}
              className="flex w-full flex-col gap-0.5 border-b border-line-soft px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-surface-2 min-[700px]:grid min-[700px]:grid-cols-[1.6fr_1fr_1fr] min-[700px]:items-center min-[700px]:gap-3"
            >
              <span className="min-w-0">
                <div className="truncate text-ink">{resolveItemName(item)}</div>
                <div className="truncate font-mono text-[10.5px] text-ink-muted">{item.key_}</div>
              </span>
              <span className="truncate font-mono text-ink-2">{displayValue}</span>
              <span className="font-mono text-[11px] text-ink-muted">
                {copiedId === item.itemid
                  ? t("latestData.factCopied")
                  : constancy?.kind === "changed-once"
                    ? t(
                        "latestData.factChanged",
                        item.prevvalue ?? t("latestData.noValue"),
                        constancy.newValue,
                        new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }).format(
                          new Date(constancy.changedAt * 1000),
                        ),
                      )
                    : t("latestData.factConstant")}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

function TemplateDialog({
  template,
  onClose,
}: {
  template: DisplayTemplate | undefined;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div
      className="fixed inset-0 z-90 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-line bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
          <div className="text-[13.5px] font-semibold text-ink">{t("latestData.templateDialogTitle")}</div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink-2"
          >
            {t("latestData.close")}
          </button>
        </div>
        <pre className="overflow-x-auto p-4 font-mono text-[11px] text-ink-2">
          {template ? JSON.stringify(template, null, 2) : t("latestData.templateNone")}
        </pre>
      </div>
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
  const t = useT();
  const { locale } = useLocale();
  const numeric = isNumericItem(item);
  const lastValue =
    item.lastvalue !== undefined && item.lastvalue !== ""
      ? numeric
        ? formatUnitValue(Number(item.lastvalue), item.units, 1, locale)
        : item.lastvalue
      : t("latestData.noValue");
  const age = item.lastclock ? formatAge(Number(item.lastclock), undefined, locale) : t("latestData.noValue");

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 border-b border-line-soft px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-surface-2 min-[700px]:grid min-[700px]:grid-cols-[1.8fr_1fr_70px_140px] min-[700px]:items-center min-[700px]:gap-3"
    >
      <span className="min-w-0">
        <div className="truncate text-ink">{resolveItemName(item)}</div>
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

function ItemChartModal({
  item,
  initialRange,
  initialLive,
  onClose,
}: {
  item: ZabbixItem;
  initialRange: RangeValue;
  initialLive: boolean;
  onClose: () => void;
}) {
  const t = useT();
  // Seed from the page's current range/live (custom brush ranges included, as
  // RangeValue carries the exact from/to) so the detail modal opens on the same
  // window the user is looking at; changes here stay local to the modal.
  const [range, setRange] = useState<RangeValue>(initialRange);
  const [live, setLive] = useState(initialLive);
  const numeric = isNumericItem(item);

  const { seriesByItem, isLoading, isFetching, slow, refetch } = useTimeseries(
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
            <div className="text-[13.5px] font-semibold text-ink">{resolveItemName(item)}</div>
            <div className="font-mono text-[10.5px] text-ink-muted">{item.key_}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <RangePicker value={range} onChange={setRange} live={live} onLiveChange={setLive} />
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink-2"
            >
              {t("latestData.close")}
            </button>
          </div>
        </div>
        <div className="p-3">
          {numeric ? (
            <TimeChartPanel
              series={[{ label: resolveItemName(item), points: (series?.points ?? []).map((p) => [p.t, p.v]) }]}
              unit={item.units}
              height={280}
              isLoading={isLoading}
              isFetching={isFetching}
              slow={slow}
              onRetry={() => void refetch()}
              onBrush={(from, to) => setRange({ from, to })}
            />
          ) : (
            <div className="p-6 text-center text-sm text-ink-2">
              {t("latestData.textValue", item.lastvalue ?? t("latestData.noValue"))}
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
  const t = useT();
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
        <span className="text-ink-muted">{t("latestData.hostLabel")}</span>
        <span className="font-medium text-ink">{selectedHost.name}</span>
        <button
          type="button"
          onClick={() => {
            onSelect(undefined);
            setQuery("");
          }}
          className="rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-ink-muted"
        >
          {t("latestData.changeHost")}
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
        placeholder={t("latestData.hostPlaceholder")}
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
