import { useMemo, useState } from "react";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { rangeFromPreset } from "@auzui/timeseries";
import { RangePicker, type RangeValue } from "../../components/RangePicker";
import { SeverityBadge } from "../../components/SeverityBadge";
import { severityFromWire } from "../../lib/severity";
import { useLogsEnabled, useLogSource } from "../../lib/use-logs";
import { buildDashboard } from "../../lib/auto-dashboard";
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

  const { host, items, triggers, problems, isLoading } = useHostDetail(hostId);
  const dashboard = useMemo(
    () => buildDashboard(host ?? {}, items, triggers),
    [host, items, triggers],
  );

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
        {templates.map((template) => (
          <span
            key={template.templateid}
            className="whitespace-nowrap rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-ink-muted"
          >
            {template.name}
          </span>
        ))}
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

      {logsEnabled && hasLogEntries && (
        <div className="mb-4">
          <LogsPanel source={logSource} hostId={hostId} range={range} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[10.5px] text-ink-muted">
          {t("hostDetail.generatedFrom", dashboard.generatedFromItemCount)}
        </span>
        <div className="ml-auto">
          <RangePicker value={range} onChange={setRange} live={live} onLiveChange={setLive} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {dashboard.sections.map((section) => (
          <DashboardSection key={section.section} section={section} range={range} onBrush={onBrush} />
        ))}

        {dashboard.textItems.length > 0 && (
          <div className="rounded-lg border border-line bg-surface">
            <div className="border-b border-line-soft px-3.5 py-2.5">
              <span className="text-sm font-semibold text-ink">{t("hostDetail.status")}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3.5 max-[700px]:grid-cols-1">
              {dashboard.textItems.map((item) => (
                <div key={item.itemid} className="flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="truncate text-ink-2">{item.name}</span>
                  <span className="truncate font-mono text-ink">{item.lastvalue ?? "–"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {logsEnabled && !hasLogEntries && (
          <LogsPanel source={logSource} hostId={hostId} range={range} />
        )}
      </div>
    </div>
  );
}
