import { useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ALL_SEVERITIES, type Severity } from "../../lib/severity";
import { filterProblems, groupIntoLanes } from "../../lib/problems";
import { useLocalStorageState } from "../../lib/use-local-storage-state";
import { useProblems } from "./use-problems";
import { useSparklines } from "./use-sparklines";
import { FilterChips } from "./FilterChips";
import { LaneSection, type ViewMode } from "./LaneSection";
import { DetailPanel } from "./DetailPanel";
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
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateProblemsSearch(rawSearch);
  const navigate = useNavigate();

  const { problems, isLoading, isError, error, refetch } = useProblems();
  const [mode, setMode] = useLocalStorageState<ViewMode>("auzui-problems-view-mode", "rows");
  const [laneOpen, setLaneOpen] = useLocalStorageState<Record<Severity, boolean>>(
    "auzui-problems-lane-open",
    DEFAULT_LANE_OPEN,
  );

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

  const counts = {
    total: problems.length,
    high: problems.filter((p) => p.severity === 4).length,
    avg: problems.filter((p) => p.severity === 3).length,
    warn: problems.filter((p) => p.severity === 2).length,
    info: problems.filter((p) => p.severity === 1).length,
  };

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-16 pt-4.5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">Problems</h1>
        <span className="text-[13px] text-ink-2">Alle aktiven Probleme der Instanz</span>
        {!isLoading && !isError && (
          <span className="rounded-full border border-accent/35 bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] text-accent">
            {counts.total} aktiv · {counts.high} High · {counts.avg} Average · {counts.warn} Warning ·{" "}
            {counts.info} Info
          </span>
        )}
      </div>

      {isError ? (
        <ErrorPanel error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="grid grid-cols-[1fr_330px] items-start gap-3.5 max-[1100px]:grid-cols-1">
          <div className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
              <span className="text-xs text-ink-muted">Ansicht:</span>
              <div className="inline-flex gap-0.5 rounded-md bg-surface-3 p-0.5">
                <button
                  type="button"
                  onClick={() => setMode("rows")}
                  className={`rounded px-2.5 py-1 text-[11.5px] ${mode === "rows" ? "bg-surface font-semibold text-ink" : "text-ink-2"}`}
                >
                  Zeilen
                </button>
                <button
                  type="button"
                  onClick={() => setMode("cards")}
                  className={`rounded px-2.5 py-1 text-[11.5px] ${mode === "cards" ? "bg-surface font-semibold text-ink" : "text-ink-2"}`}
                >
                  Karten + Sparkline
                </button>
              </div>
            </div>

            <FilterChips
              problems={problems}
              activeSeverities={activeSeverities}
              unackOnly={unackOnly}
              onToggleSeverity={toggleSeverity}
              onToggleUnack={() => updateSearch({ unack: unackOnly ? "0" : undefined })}
            />
            {search.host && (
              <div className="flex items-center gap-2 border-b border-line-soft px-3.5 py-2 text-xs text-ink-2">
                gefiltert auf Host <b className="font-mono">{search.host}</b>
                <button
                  type="button"
                  onClick={() => updateSearch({ host: undefined })}
                  className="rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-ink-muted"
                >
                  ✕ entfernen
                </button>
              </div>
            )}

            {isLoading ? (
              <div className="p-6 text-sm text-ink-2">Lade Probleme…</div>
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
                  />
                ))}
              </div>
            )}
            <div className="px-3.5 py-2.5 text-[11.5px] text-ink-muted">
              {filtered.length} von {problems.length} Problemen · Lanes einklappbar · Filter in der
              URL (teilbar)
            </div>
          </div>

          <aside className="rounded-lg border border-line bg-surface">
            <DetailPanel problem={selected} />
          </aside>
        </div>
      )}
    </div>
  );
}

function EmptyState({ hasProblems }: { hasProblems: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-16 text-center">
      <div className="text-2xl">✓</div>
      <div className="text-sm font-semibold">
        {hasProblems ? "Keine Probleme mit diesen Filtern" : "Keine aktiven Probleme"}
      </div>
      <div className="text-xs text-ink-2">
        {hasProblems
          ? "Severity-Filter oder „nur unbestätigte“ zurücksetzen, um mehr zu sehen."
          : "Die Instanz ist ruhig — alles im grünen Bereich."}
      </div>
    </div>
  );
}

function ErrorPanel({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : "Unbekannter Fehler";
  return (
    <div className="rounded-lg border border-sev-high/40 bg-surface p-6 text-center">
      <div className="mb-1 text-sm font-semibold text-sev-high">
        Probleme konnten nicht geladen werden
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
