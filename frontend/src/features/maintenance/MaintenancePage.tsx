import { useMemo, useState } from "react";
import type { ZabbixMaintenance } from "@auzui/zabbix-client";
import {
  describeTimeperiod,
  formatFrame,
  formatWindow,
  maintenanceStatus,
  type MaintenanceStatus,
} from "../../lib/maintenance";
import { useHostsInMaintenance, useMaintenance } from "./use-maintenance";
import { useDeleteMaintenance } from "./use-maintenance-mutations";
import { CreateMaintenanceForm } from "./CreateMaintenanceForm";
import { useLocale, useT } from "../../lib/i18n";

const MAX_EXPIRED = 10;

export function MaintenancePage() {
  const t = useT();
  const { data: maintenances, isLoading, isError, error, refetch } = useMaintenance();
  const { data: hostsInMaintenance } = useHostsInMaintenance();
  const [expiredOpen, setExpiredOpen] = useState(false);

  const activeMaintenanceIds = useMemo(
    () =>
      new Set((hostsInMaintenance ?? []).map((h) => h.maintenanceid).filter((id): id is string => Boolean(id))),
    [hostsInMaintenance],
  );

  const nowSeconds = Date.now() / 1000;
  const grouped = groupByStatus(maintenances ?? [], nowSeconds, activeMaintenanceIds);

  return (
    <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pb-16 pt-4.5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">{t("maintenance.page.title")}</h1>
        <span className="text-[13px] text-ink-2">{t("maintenance.page.subtitle")}</span>
      </div>

      {isError ? (
        <ErrorPanel error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="grid grid-cols-[1fr_330px] items-start gap-3.5 max-[1100px]:grid-cols-1">
          <div className="rounded-lg border border-line bg-surface">
            {isLoading ? (
              <div className="p-6 text-sm text-ink-2">{t("maintenance.page.loading")}</div>
            ) : (maintenances ?? []).length === 0 ? (
              <div className="p-6 text-sm text-ink-2">{t("maintenance.page.noneExist")}</div>
            ) : (
              <div className="flex flex-col gap-4 p-3.5">
                <StatusGroup
                  title={t("maintenance.page.active")}
                  accentClass="border-l-sev-warn"
                  items={grouped.active}
                />
                <StatusGroup
                  title={t("maintenance.page.planned")}
                  accentClass="border-l-accent"
                  items={grouped.planned}
                />
                {grouped.expired.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setExpiredOpen((v) => !v)}
                      aria-expanded={expiredOpen}
                      className="flex items-center gap-1.5 font-mono text-xs font-semibold text-ink-muted"
                    >
                      {expiredOpen ? "▾" : "▸"} {t("maintenance.page.expired", grouped.expired.length)}
                    </button>
                    {expiredOpen && (
                      <div className="mt-2">
                        <StatusGroup
                          title=""
                          accentClass="border-l-line"
                          items={grouped.expired.slice(0, MAX_EXPIRED)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <aside className="rounded-lg border border-line bg-surface">
            <CreateMaintenanceForm />
          </aside>
        </div>
      )}
    </div>
  );
}

function groupByStatus(
  maintenances: ZabbixMaintenance[],
  nowSeconds: number,
  activeMaintenanceIds: ReadonlySet<string>,
): Record<MaintenanceStatus, ZabbixMaintenance[]> {
  const groups: Record<MaintenanceStatus, ZabbixMaintenance[]> = {
    active: [],
    planned: [],
    expired: [],
  };
  for (const m of maintenances) {
    groups[maintenanceStatus(m, nowSeconds, activeMaintenanceIds)].push(m);
  }
  groups.expired.sort((a, b) => Number(b.active_till) - Number(a.active_till));
  return groups;
}

function StatusGroup({
  title,
  accentClass,
  items,
}: {
  title: string;
  accentClass: string;
  items: ZabbixMaintenance[];
}) {
  const t = useT();
  if (items.length === 0 && title) return null;
  return (
    <div className="flex flex-col gap-2">
      {title && (
        <span className="font-mono text-xs font-semibold text-ink-muted">
          {title} ({items.length})
        </span>
      )}
      {items.length === 0 ? (
        <span className="text-xs text-ink-muted">{t("maintenance.page.none")}</span>
      ) : (
        items.map((m) => <MaintenanceRow key={m.maintenanceid} maintenance={m} accentClass={accentClass} />)
      )}
    </div>
  );
}

function MaintenanceRow({
  maintenance,
  accentClass,
}: {
  maintenance: ZabbixMaintenance;
  accentClass: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const deleteMutation = useDeleteMaintenance();

  function onDelete() {
    if (!window.confirm(t("maintenance.page.confirmDelete", maintenance.name))) return;
    deleteMutation.mutate(maintenance.maintenanceid);
  }

  const firstTimeperiod = maintenance.timeperiods?.[0];
  const isRecurring = firstTimeperiod !== undefined && firstTimeperiod.timeperiod_type !== "0";

  return (
    <div className={`flex flex-col gap-1.5 rounded-md border border-line border-l-[3px] bg-surface-2 p-2.5 ${accentClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">{maintenance.name}</span>
          {isRecurring ? (
            <>
              <span className="font-mono text-[11px] text-ink-2">
                {describeTimeperiod(firstTimeperiod, locale)}
              </span>
              <span className="font-mono text-[10px] text-ink-muted">
                {formatFrame(Number(maintenance.active_since), Number(maintenance.active_till), locale)}
              </span>
            </>
          ) : (
            <span className="font-mono text-[11px] text-ink-muted">
              {formatWindow(Number(maintenance.active_since), Number(maintenance.active_till), locale)}
            </span>
          )}
          {maintenance.maintenance_type === "1" && (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] text-ink-2">
              {t("maintenance.page.noDataCollection")}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteMutation.isPending}
          className="rounded border border-line px-2 py-1 font-mono text-[10.5px] text-ink-muted disabled:opacity-50"
        >
          {t("maintenance.page.delete")}
        </button>
      </div>

      {(maintenance.hosts?.length || maintenance.hostgroups?.length) && (
        <div className="flex flex-wrap gap-1.5">
          {maintenance.hosts?.map((h) => (
            <span
              key={h.hostid}
              className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2"
            >
              {h.name || h.host}
            </span>
          ))}
          {maintenance.hostgroups?.map((g) => (
            <span
              key={g.groupid}
              className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2"
            >
              {g.name}
            </span>
          ))}
        </div>
      )}

      {maintenance.description && (
        <div className="text-xs text-ink-muted">{maintenance.description}</div>
      )}
    </div>
  );
}

function ErrorPanel({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const message = error instanceof Error ? error.message : t("maintenance.page.unknownError");
  return (
    <div className="rounded-lg border border-sev-high/40 bg-surface p-6 text-center">
      <div className="mb-1 text-sm font-semibold text-sev-high">{t("maintenance.page.loadError")}</div>
      <div className="mb-3 text-xs text-ink-2">{message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-2"
      >
        {t("maintenance.page.retry")}
      </button>
    </div>
  );
}
