import { useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ALL_SEVERITIES, type Severity } from "../../lib/severity";
import { filterProblems, groupIntoLanes } from "../../lib/problems";
import { useLocalStorageState } from "../../lib/use-local-storage-state";
import { useHostsInMaintenance } from "../maintenance/use-maintenance";
import { useProblems } from "./use-problems";
import { useSparklines } from "./use-sparklines";
import { useAcknowledge } from "./use-acknowledge";
import { FilterChips } from "./FilterChips";
import { LaneSection, type ViewMode } from "./LaneSection";
import { DetailPanel } from "./DetailPanel";
import { BulkActionBar } from "./BulkActionBar";
import { useT } from "../../lib/i18n";
import {
  severitiesFromSearch,
  severitiesToSearchValue,
  validateProblemsSearch,
  type ProblemsSearch,
} from "./search-params";

const DEFAULT_LANE_OPEN: Record<Severity, boolean> = {
  5: true,
  4: true,
  3: true,
  2: true,
  1: false,
  0: false,
};

export function ProblemsPage() {
  const t = useT();
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateProblemsSearch(rawSearch);
  const navigate = useNavigate();

  const { problems, isLoading, isError, error, refetch } = useProblems();
  const { data: hostsInMaintenance } = useHostsInMaintenance();
  const [mode, setMode] = useLocalStorageState<ViewMode>("auzui-problems-view-mode", "rows");
  const [laneOpen, setLaneOpen] = useLocalStorageState<Record<Severity, boolean>>(
    "auzui-problems-lane-open",
    DEFAULT_LANE_OPEN,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const acknowledge = useAcknowledge();

  const activeSeverities = useMemo(() => new Set(severitiesFromSearch(search)), [search]);
  // Default: nur unbestätigte — Abschalten wird explizit als unack=0 kodiert.
  const unackOnly = search.unack !== "0";

  const filtered = useMemo(
    () => filterProblems(problems, { severities: activeSeverities, unackOnly, host: search.host }),
    [problems, activeSeverities, unackOnly, search.host],
  );
  const lanes = useMemo(() => groupIntoLanes(filtered, ALL_SEVERITIES), [filtered]);

  const sparklines = useSparklines(mode === "cards" ? filtered : []);

  const selected = useMemo(
    () => filtered.find((p) => p.eventid === search.event) ?? filtered[0],
    [filtered, search.event],
  );

  function updateSearch(patch: Partial<ProblemsSearch>) {
    void navigate({
      to: "/",
      search: (prev: ProblemsSearch) => ({ ...prev, ...patch }),
      replace: true,
    });
  }

  function toggleSeverity(severity: Severity) {
    const next = new Set(activeSeverities);
    if (next.has(severity)) next.delete(severity);
    else next.add(severity);
    updateSearch({ sev: severitiesToSearchValue([...next]) });
  }

  function selectProblem(eventid: string) {
    updateSearch({ event: eventid });
  }

  function toggleSelect(eventid: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventid)) next.delete(eventid);
      else next.add(eventid);
      return next;
    });
  }

  function toggleSelectAll(eventids: string[], checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of eventids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  // Nur noch tatsächlich sichtbare Auswahl behalten, falls Probleme durch
  // Ack/Filterwechsel aus der Liste fallen.
  const visibleSelectedIds = useMemo(() => {
    const visible = new Set(filtered.map((p) => p.eventid));
    return new Set([...selectedIds].filter((id) => visible.has(id)));
  }, [selectedIds, filtered]);

  const counts = {
    total: problems.length,
    high: problems.filter((p) => p.severity === 4).length,
    avg: problems.filter((p) => p.severity === 3).length,
    warn: problems.filter((p) => p.severity === 2).length,
    info: problems.filter((p) => p.severity === 1).length,
  };

  return (
    <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pb-16 pt-4.5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">{t("problems.page.title")}</h1>
        <span className="text-[13px] text-ink-2">{t("problems.page.subtitle")}</span>
        {!isLoading && !isError && (
          <span className="rounded-full border border-accent/35 bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] text-accent">
            {t(
              "problems.page.summary",
              counts.total,
              counts.high,
              counts.avg,
              counts.warn,
              counts.info,
            )}
          </span>
        )}
        {hostsInMaintenance && hostsInMaintenance.length > 0 && (
          <Link
            to="/maintenance"
            className="rounded-full border border-sev-warn/40 bg-sev-warn/15 px-2.5 py-0.5 font-mono text-[11px] text-sev-warn"
          >
            {t("problems.page.hostsInMaintenance", hostsInMaintenance.length)}
          </Link>
        )}
      </div>

      {isError ? (
        <ErrorPanel error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="grid grid-cols-[1fr_330px] items-start gap-3.5 max-[1100px]:grid-cols-1">
          <div className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
              <span className="text-xs text-ink-muted">{t("problems.page.view")}</span>
              <div className="inline-flex gap-0.5 rounded-md bg-surface-3 p-0.5">
                <button
                  type="button"
                  onClick={() => setMode("rows")}
                  className={`rounded px-2.5 py-1 text-[11.5px] ${mode === "rows" ? "bg-surface font-semibold text-ink" : "text-ink-2"}`}
                >
                  {t("problems.page.viewRows")}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("cards")}
                  className={`rounded px-2.5 py-1 text-[11.5px] ${mode === "cards" ? "bg-surface font-semibold text-ink" : "text-ink-2"}`}
                >
                  {t("problems.page.viewCards")}
                </button>
              </div>
            </div>

            <FilterChips
              problems={problems}
              activeSeverities={activeSeverities}
              unackOnly={unackOnly}
              hostFilter={search.host}
              onToggleSeverity={toggleSeverity}
              onToggleUnack={() => updateSearch({ unack: unackOnly ? "0" : undefined })}
              onClearHostFilter={() => updateSearch({ host: undefined })}
            />

            {isLoading ? (
              <div className="p-6 text-sm text-ink-2">{t("problems.page.loading")}</div>
            ) : lanes.length === 0 ? (
              <EmptyState hasProblems={problems.length > 0} />
            ) : (
              <div className="pb-2.5">
                {lanes.map((lane) => (
                  <LaneSection
                    key={lane.severity}
                    severity={lane.severity}
                    problems={lane.problems}
                    mode={mode}
                    open={laneOpen[lane.severity]}
                    onToggleOpen={() =>
                      setLaneOpen({ ...laneOpen, [lane.severity]: !laneOpen[lane.severity] })
                    }
                    selectedEventId={selected?.eventid}
                    onSelect={(p) => selectProblem(p.eventid)}
                    sparklines={sparklines}
                    selectedIds={visibleSelectedIds}
                    onToggleSelect={toggleSelect}
                    onToggleSelectAll={toggleSelectAll}
                  />
                ))}
              </div>
            )}
            <div className="px-3.5 py-2.5 text-[11.5px] text-ink-muted">
              {t("problems.page.footer", filtered.length, problems.length)}
            </div>
          </div>

          <aside className="rounded-lg border border-line bg-surface">
            <DetailPanel problem={selected} />
          </aside>
        </div>
      )}

      <BulkActionBar
        selectedIds={visibleSelectedIds}
        pending={acknowledge.isPending}
        onAck={(message) =>
          acknowledge.mutate(
            { eventids: [...visibleSelectedIds], ack: true, message },
            { onSuccess: () => setSelectedIds(new Set()) },
          )
        }
        onUnack={(message) =>
          acknowledge.mutate(
            { eventids: [...visibleSelectedIds], unack: true, message },
            { onSuccess: () => setSelectedIds(new Set()) },
          )
        }
        onClear={() => setSelectedIds(new Set())}
      />
    </div>
  );
}

function EmptyState({ hasProblems }: { hasProblems: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-16 text-center">
      <div className="text-2xl">✓</div>
      <div className="text-sm font-semibold">
        {hasProblems ? t("problems.page.emptyFiltered") : t("problems.page.emptyNone")}
      </div>
      <div className="text-xs text-ink-2">
        {hasProblems ? t("problems.page.emptyFilteredHint") : t("problems.page.emptyNoneHint")}
      </div>
    </div>
  );
}

function ErrorPanel({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const message = error instanceof Error ? error.message : t("problems.page.unknownError");
  return (
    <div className="rounded-lg border border-sev-high/40 bg-surface p-6 text-center">
      <div className="mb-1 text-sm font-semibold text-sev-high">{t("problems.page.loadError")}</div>
      <div className="mb-3 text-xs text-ink-2">{message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-2"
      >
        {t("problems.page.retry")}
      </button>
    </div>
  );
}
