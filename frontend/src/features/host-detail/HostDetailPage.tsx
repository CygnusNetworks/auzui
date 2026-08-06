import { useMemo, useState } from "react";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { rangeFromPreset } from "@auzui/timeseries";
import { RangePicker, type RangeValue } from "../../components/RangePicker";
import { SeverityBadge } from "../../components/SeverityBadge";
import { severityFromWire } from "../../lib/severity";
import { useLogsEnabled, useLogSource } from "../../lib/use-logs";
import { buildDashboard } from "../../lib/auto-dashboard";
import { filterDashboard } from "./dashboard-filter";
import { validateHostDetailSearch } from "./search-params";
import { useHostDetail } from "./use-host-detail";
import { useHostLogs } from "./use-host-logs";
import { DashboardSection } from "./DashboardSection";
import { LogsPanel } from "./LogsPanel";
import { useT } from "../../lib/i18n";

export function HostDetailPage() {
  const t = useT();
  const { hostId } = useParams({ strict: false }) as { hostId?: string };
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateHostDetailSearch(rawSearch);

  const [range, setRange] = useState<RangeValue>(() =>
    search.from !== undefined && search.to !== undefined
      ? { from: search.from, to: search.to }
      : rangeFromPreset("6h"),
  );
  const [live, setLive] = useState(search.from === undefined);
  const [filterText, setFilterText] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(undefined);

  const { host, items, triggers, problems, isLoading, templateItemIdsByTemplate, templateItemsReady } =
    useHostDetail(hostId);
  const dashboard = useMemo(() => buildDashboard(host ?? {}, items, triggers), [host, items, triggers]);

  // "Mapping not yet available" (still loading or template has no items) is
  // treated as "don't filter" so the template badges never blank the page
  // while the template-items query is still in flight.
  const templateItemIds =
    selectedTemplateId !== undefined && templateItemsReady
      ? templateItemIdsByTemplate.get(selectedTemplateId)
      : undefined;
  const filteredDashboard = useMemo(
    () => filterDashboard(dashboard, { text: filterText, templateItemIds }),
    [dashboard, filterText, templateItemIds],
  );
  const filterActive = filterText.trim() !== "" || selectedTemplateId !== undefined;
  const filterEmpty =
    filterActive && filteredDashboard.sections.length === 0 && filteredDashboard.textItems.length === 0;

  const { data: logsEnabled } = useLogsEnabled();
  const logSource = useLogSource();
  // Nur zur Platzierungsentscheidung (prominent oben vs. unten) — teilt sich
  // den React-Query-Cache mit LogsPanels eigenem (unfiltered) Query.
  const { data: logsPreview } = useHostLogs(logSource, hostId, range, "");
  const hasLogEntries = (logsPreview?.pages[0]?.messages.length ?? 0) > 0;

  function onBrush(fromSec: number, toSec: number) {
    setLive(false);
    setRange({ from: fromSec, to: toSec });
  }

  if (!hostId) return null;

  if (isLoading || !host) {
    return (
      <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pt-4.5 text-sm text-ink-2">
        {t("hostDetail.loading")}
      </div>
    );
  }

  const groups = host.hostgroups ?? [];
  const templates = host.parentTemplates ?? [];
  const inventory = host.inventory ?? {};
  const inventoryBits = [inventory.os, inventory.hardware, inventory.location].filter(Boolean);
  const inMaintenance = host.maintenance_status === "1";

  return (
    <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pb-16 pt-4.5">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2.5">
        <h1 className="text-[19px] font-bold tracking-tight">{host.name || host.host}</h1>
        <span className="font-mono text-[13px] text-ink-muted">{host.host}</span>
        {inMaintenance && (
          <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10.5px] text-ink-muted">
            {t("hostDetail.maintenanceActive")}
          </span>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {groups.map((g) => (
          <span
            key={g.groupid}
            className="whitespace-nowrap rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2"
          >
            {g.name}
          </span>
        ))}
        {templates.map((template) => {
          const selected = selectedTemplateId === template.templateid;
          const itemCount = templateItemsReady
            ? (templateItemIdsByTemplate.get(template.templateid)?.size ?? 0)
            : undefined;
          const disabled = templateItemsReady && itemCount === 0;
          return (
            <button
              key={template.templateid}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              title={t("hostDetail.templateFilterTitle")}
              onClick={() => setSelectedTemplateId((prev) => (prev === template.templateid ? undefined : template.templateid))}
              className={`whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10.5px] disabled:cursor-not-allowed disabled:opacity-50 ${
                selected ? "border-accent/50 bg-accent-soft font-semibold text-accent" : "border-line text-ink-muted"
              }`}
            >
              {template.name}
            </button>
          );
        })}
        {inventoryBits.length > 0 && (
          <span className="text-[11.5px] text-ink-muted">{inventoryBits.join(" · ")}</span>
        )}
      </div>

      {problems.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {problems.map((p) => (
            <Link
              key={p.eventid}
              to="/"
              search={{ host: host.host }}
              className="inline-flex items-center gap-1.5"
              title={p.name}
            >
              <SeverityBadge severity={severityFromWire(p.severity)} />
            </Link>
          ))}
        </div>
      )}

      {/* Logs sit at the very top — directly under the header/problem badges and
          before every graph section. When there are entries: the full (height-
          capped) panel. When there are none: a compact one-liner instead of a
          big empty panel. */}
      {logsEnabled &&
        (hasLogEntries ? (
          <div className="mb-4">
            <LogsPanel source={logSource} hostId={hostId} range={range} />
          </div>
        ) : (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-line-soft bg-surface px-3.5 py-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">
              {t("hostDetail.logs.badge")}
            </span>
            <span className="text-[12.5px] text-ink-2">{t("hostDetail.logs.empty")}</span>
          </div>
        ))}

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[10.5px] text-ink-muted">
          {t("hostDetail.generatedFrom", dashboard.generatedFromItemCount)}
        </span>
        <div className="relative ml-auto min-w-[220px]">
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder={t("hostDetail.filterPlaceholder")}
            className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-1 pr-6 font-mono text-[11px] text-ink"
          />
          {filterText !== "" && (
            <button
              type="button"
              onClick={() => setFilterText("")}
              title={t("hostDetail.filterClear")}
              aria-label={t("hostDetail.filterClear")}
              className="absolute inset-y-0 right-1.5 text-ink-muted hover:text-ink"
            >
              ×
            </button>
          )}
        </div>
        <RangePicker value={range} onChange={setRange} live={live} onLiveChange={setLive} />
      </div>

      {filterEmpty ? (
        <div className="rounded-lg border border-line-soft bg-surface px-3.5 py-3 text-sm text-ink-muted">
          {t("hostDetail.filterNoMatch")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredDashboard.sections.map((section) => (
            <DashboardSection key={section.section} section={section} range={range} onBrush={onBrush} />
          ))}

          {filteredDashboard.textItems.length > 0 && (
            <div className="rounded-lg border border-line bg-surface">
              <div className="border-b border-line-soft px-3.5 py-2.5">
                <span className="text-sm font-semibold text-ink">{t("hostDetail.status")}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3.5 max-[700px]:grid-cols-1">
                {filteredDashboard.textItems.map((item) => (
                  <div key={item.itemid} className="flex items-baseline justify-between gap-2 text-[12.5px]">
                    <span className="truncate text-ink-2">{item.name}</span>
                    <span className="truncate font-mono text-ink">{item.lastvalue ?? "–"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
