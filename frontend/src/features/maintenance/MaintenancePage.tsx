import { useState } from "react";
import type { ZabbixMaintenance } from "@auzui/zabbix-client";
import { formatWindow, maintenanceStatus, type MaintenanceStatus } from "../../lib/maintenance";
import { useMaintenance } from "./use-maintenance";
import { useDeleteMaintenance } from "./use-maintenance-mutations";
import { CreateMaintenanceForm } from "./CreateMaintenanceForm";

const MAX_EXPIRED = 10;

export function MaintenancePage() {
  const { data: maintenances, isLoading, isError, error, refetch } = useMaintenance();
  const [expiredOpen, setExpiredOpen] = useState(false);

  const nowSeconds = Date.now() / 1000;
  const grouped = groupByStatus(maintenances ?? [], nowSeconds);

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-16 pt-4.5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">Maintenance</h1>
        <span className="text-[13px] text-ink-2">
          Wartungsfenster — aktiv, geplant, abgelaufen
        </span>
      </div>

      {isError ? (
        <ErrorPanel error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="grid grid-cols-[1fr_330px] items-start gap-3.5 max-[1100px]:grid-cols-1">
          <div className="rounded-lg border border-line bg-surface">
            {isLoading ? (
              <div className="p-6 text-sm text-ink-2">Lade Wartungsfenster…</div>
            ) : (maintenances ?? []).length === 0 ? (
              <div className="p-6 text-sm text-ink-2">Keine Wartungsfenster vorhanden.</div>
            ) : (
              <div className="flex flex-col gap-4 p-3.5">
                <StatusGroup
                  title="Aktiv"
                  accentClass="border-l-sev-warn"
                  items={grouped.active}
                />
                <StatusGroup title="Geplant" accentClass="border-l-accent" items={grouped.planned} />
                {grouped.expired.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setExpiredOpen((v) => !v)}
                      aria-expanded={expiredOpen}
                      className="flex items-center gap-1.5 font-mono text-xs font-semibold text-ink-muted"
                    >
                      {expiredOpen ? "▾" : "▸"} Abgelaufen ({grouped.expired.length})
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
): Record<MaintenanceStatus, ZabbixMaintenance[]> {
  const groups: Record<MaintenanceStatus, ZabbixMaintenance[]> = {
    active: [],
    planned: [],
    expired: [],
  };
  for (const m of maintenances) {
    groups[maintenanceStatus(m, nowSeconds)].push(m);
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
  if (items.length === 0 && title) return null;
  return (
    <div className="flex flex-col gap-2">
      {title && (
        <span className="font-mono text-xs font-semibold text-ink-muted">
          {title} ({items.length})
        </span>
      )}
      {items.length === 0 ? (
        <span className="text-xs text-ink-muted">Keine.</span>
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
  const deleteMutation = useDeleteMaintenance();

  function onDelete() {
    if (!window.confirm(`Wartungsfenster „${maintenance.name}“ wirklich löschen?`)) return;
    deleteMutation.mutate(maintenance.maintenanceid);
  }

  return (
    <div className={`flex flex-col gap-1.5 rounded-md border border-line border-l-[3px] bg-surface-2 p-2.5 ${accentClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">{maintenance.name}</span>
          <span className="font-mono text-[11px] text-ink-muted">
            {formatWindow(Number(maintenance.active_since), Number(maintenance.active_till))}
          </span>
          {maintenance.maintenance_type === "1" && (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] text-ink-2">
              ohne Datenerfassung
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteMutation.isPending}
          className="rounded border border-line px-2 py-1 font-mono text-[10.5px] text-ink-muted disabled:opacity-50"
        >
          Löschen
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
  const message = error instanceof Error ? error.message : "Unbekannter Fehler";
  return (
    <div className="rounded-lg border border-sev-high/40 bg-surface p-6 text-center">
      <div className="mb-1 text-sm font-semibold text-sev-high">
        Wartungsfenster konnten nicht geladen werden
      </div>
      <div className="mb-3 text-xs text-ink-2">{message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-2"
      >
        Erneut versuchen
      </button>
    </div>
  );
}
