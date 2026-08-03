import { type ReactNode } from "react";
import { severityLabel, type Severity } from "../../lib/severity";
import { severityBorderLeftClass, severityDotClass } from "../../components/SeverityBadge";
import { Sparkline } from "../../components/Sparkline";
import { formatAge, formatSuppressUntil, type EnrichedProblem } from "../../lib/problems";
import { useAnimatedPresence } from "../../lib/use-animated-presence";
import { useLocale, useT } from "../../lib/i18n";
import { shouldShowSparkline } from "./use-sparklines";
import { laneTriState, type TriState } from "./selection";
import type { Series } from "@auzui/timeseries";

export type ViewMode = "rows" | "cards";

/**
 * Grid-rows 1fr↔0fr collapse trick: animates an arbitrary-height row/card
 * to zero height without knowing its content height up front, unlike a
 * plain max-height transition. Respects prefers-reduced-motion via
 * `motion-reduce:transition-none` (row keeps position, just vanishes).
 */
function CollapseOnLeave({ leaving, children }: { leaving: boolean; children: ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: leaving ? "0fr" : "1fr" }}
    >
      <div className="overflow-hidden">
        <div
          className={`transition-opacity duration-200 motion-reduce:transition-none ${leaving ? "pointer-events-none opacity-0" : "opacity-100"}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Custom round selection control for the Problems "Auswahlmodus". Deliberately
 * NOT a native <input type="checkbox"> — it renders as a filled accent disc
 * with a check (or a dash for the lane header's mixed state) and exposes
 * role="checkbox"/aria-checked for a11y. `stopPropagation` keeps a click from
 * bubbling to the row/card toggle (which would immediately re-toggle it).
 */
function RoundCheck({
  state,
  label,
  onToggle,
}: {
  state: TriState;
  label: string;
  onToggle: () => void;
}) {
  const filled = state === "all" || state === "some";
  return (
    <span
      role="checkbox"
      aria-checked={state === "some" ? "mixed" : state === "all"}
      aria-label={label}
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }
      }}
      className={`inline-flex h-[17px] w-[17px] shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors duration-150 motion-reduce:transition-none ${
        filled
          ? "border-accent bg-accent text-accent-ink"
          : "border-accent/60 bg-transparent text-transparent hover:border-accent"
      }`}
    >
      {state === "some" ? (
        <span className="h-[2px] w-2 rounded-full bg-accent-ink" />
      ) : (
        <svg
          viewBox="0 0 12 12"
          className="h-2.5 w-2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2.5 6.2 5 8.5 9.5 3.5" />
        </svg>
      )}
    </span>
  );
}

/**
 * Unified ack/suppressed status chips (rows and cards). Outline style on
 * purpose: a filled background would drown in the selection/hover tint —
 * exactly the inconsistency this replaces. Renders nothing for a plain
 * unacked, unsuppressed problem (no "— ack" placeholder noise).
 */
function StatusChips({ problem }: { problem: EnrichedProblem }) {
  const t = useT();
  const { locale } = useLocale();
  if (!problem.acknowledged && !problem.suppressed) return null;
  return (
    <span className="flex items-center justify-end gap-1.5">
      {problem.acknowledged && (
        <span className="whitespace-nowrap rounded-full border border-sev-ok/55 px-2 font-mono text-[10px] leading-[16px] text-sev-ok">
          {t("problems.lane.ackChip")}
        </span>
      )}
      {problem.suppressed && (
        <span className="whitespace-nowrap rounded-full border border-ink-muted/60 px-2 font-mono text-[10px] leading-[16px] text-ink-muted">
          {problem.suppressUntil
            ? t(
                "problems.lane.suppressedUntilChip",
                formatSuppressUntil(problem.suppressUntil, locale),
              )
            : t("problems.lane.suppressedChip")}
        </span>
      )}
    </span>
  );
}

/** Leading track that slides in when select mode activates. */
function SelectSpur({ width, children }: { width: number; children: ReactNode }) {
  return (
    <span
      className="animate-select-spur-in flex shrink-0 items-center justify-center overflow-hidden"
      style={{ width: `${width}px`, ["--select-spur-width" as string]: `${width}px` }}
    >
      {children}
    </span>
  );
}

export function LaneSection({
  severity,
  problems,
  mode,
  open,
  onToggleOpen,
  selectedEventId,
  onSelect,
  sparklines,
  selectMode,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  ackHidden = 0,
}: {
  severity: Severity;
  problems: EnrichedProblem[];
  mode: ViewMode;
  open: boolean;
  onToggleOpen: () => void;
  selectedEventId: string | undefined;
  onSelect: (problem: EnrichedProblem) => void;
  sparklines: Map<string, Series>;
  /** When true, the lane shows selection controls and rows toggle selection. */
  selectMode: boolean;
  /** Bulk-selection (multi-select action bar), keyed by eventid. */
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (eventid: string) => void;
  onToggleSelectAll: (eventids: string[], checked: boolean) => void;
  /**
   * Acknowledged problems of this severity that the "unacknowledged only"
   * filter keeps out of the lane. Named explicitly instead of the old bare
   * "0 ack", which read as "there are no acknowledged ones" when it meant
   * "none of the visible ones are acknowledged".
   */
  ackHidden?: number;
}) {
  const t = useT();
  const { locale } = useLocale();
  const acked = problems.filter((p) => p.acknowledged).length;
  const laneIds = problems.map((p) => p.eventid);
  const triState = laneTriState(selectedIds, laneIds);

  const presence = useAnimatedPresence(problems, (p) => p.eventid);

  return (
    <div>
      <div className="flex items-baseline gap-2.5 px-3.5 pt-3">
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          className="w-[18px] font-mono text-xs text-ink-muted"
        >
          {open ? "▾" : "▸"}
        </button>
        {selectMode && (
          <span className="self-center">
            <RoundCheck
              state={triState}
              label={t("problems.lane.selectAllAria", severityLabel(severity, locale))}
              onToggle={() => onToggleSelectAll(laneIds, triState !== "all")}
            />
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold">
          <i className={`inline-block h-1.5 w-1.5 rounded-sm ${severityDotClass(severity)}`} />
          {severityLabel(severity, locale).toUpperCase()}
        </span>
        <span className="font-mono text-[11px] text-ink-muted">
          {problems.length}
          {ackHidden > 0
            ? ` · ${t("problems.lane.ackHidden", ackHidden)}`
            : acked > 0
              ? ` · ${t("problems.lane.ackedCount", acked)}`
              : ""}
        </span>
        <span className="h-px flex-1 bg-line-soft" />
      </div>

      {open &&
        (mode === "cards" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5 px-3.5 pb-1 pt-2.5">
            {presence.map(({ item: p, leaving }) => (
              <CollapseOnLeave key={p.eventid} leaving={leaving}>
                <ProblemCard
                  problem={p}
                  selected={p.eventid === selectedEventId}
                  onSelect={onSelect}
                  series={p.itemId ? sparklines.get(p.itemId) : undefined}
                  selectMode={selectMode}
                  checked={selectedIds.has(p.eventid)}
                  onToggleSelect={onToggleSelect}
                />
              </CollapseOnLeave>
            ))}
          </div>
        ) : (
          <div className="px-3.5 pb-1 pt-1.5">
            <div
              className="overflow-x-auto"
              role="table"
              aria-label={t("problems.lane.tableAria", severityLabel(severity, locale))}
            >
              {presence.map(({ item: p, leaving }) => (
                <CollapseOnLeave key={p.eventid} leaving={leaving}>
                  <ProblemRow
                    problem={p}
                    selected={p.eventid === selectedEventId}
                    onSelect={onSelect}
                    selectMode={selectMode}
                    checked={selectedIds.has(p.eventid)}
                    onToggleSelect={onToggleSelect}
                  />
                </CollapseOnLeave>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

const ROW_GRID_COLS = "70px 170px minmax(220px,1fr) 170px 90px";

function ProblemRow({
  problem,
  selected,
  onSelect,
  selectMode,
  checked,
  onToggleSelect,
}: {
  problem: EnrichedProblem;
  selected: boolean;
  onSelect: (problem: EnrichedProblem) => void;
  selectMode: boolean;
  checked: boolean;
  onToggleSelect: (eventid: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const handleClick = () => {
    if (selectMode) onToggleSelect(problem.eventid);
    else onSelect(problem);
  };
  const leftAndBg =
    selectMode && checked
      ? "border-l-accent bg-accent-soft"
      : `${severityBorderLeftClass(problem.severity)} ${!selectMode && selected ? "bg-accent-soft" : ""}`;
  // Unterdrückte Probleme treten optisch zurück — nur die Statuschips bleiben voll sichtbar.
  const dimClass = problem.suppressed ? "opacity-55" : "";
  return (
    <div
      role="row"
      onClick={handleClick}
      aria-selected={selectMode ? checked : undefined}
      className={`flex cursor-pointer items-stretch border-b border-l-[3px] border-line-soft text-xs hover:bg-surface-2 ${leftAndBg}`}
    >
      {selectMode && (
        <SelectSpur width={30}>
          <RoundCheck
            state={checked ? "all" : "none"}
            label={t("problems.lane.selectRowAria", problem.name)}
            onToggle={() => onToggleSelect(problem.eventid)}
          />
        </SelectSpur>
      )}
      <div
        className="grid flex-1 items-center gap-2.5 py-1.5 pl-2"
        style={{ gridTemplateColumns: ROW_GRID_COLS }}
      >
        <span className={`pr-2.5 font-mono text-[11.5px] text-ink-muted ${dimClass}`}>
          −{formatAge(problem.clock, undefined, locale)}
        </span>
        <span className={`pr-2.5 font-mono text-[11.5px] ${dimClass}`}>
          <b>{problem.hostName ?? "—"}</b>
        </span>
        <span className={`flex items-center gap-1.5 pr-2.5 ${dimClass}`}>
          <span className="truncate">{problem.name}</span>
        </span>
        <span className={`pr-2.5 ${dimClass}`}>
          {problem.tags.slice(0, 1).map((tag) => (
            <span
              key={tag.tag}
              className="mr-1 inline-block whitespace-nowrap rounded bg-surface-3 px-1.5 font-mono text-[10px] text-ink-2"
            >
              {tag.tag}
              {tag.value ? `:${tag.value}` : ""}
            </span>
          ))}
        </span>
        <StatusChips problem={problem} />
      </div>
    </div>
  );
}

function ProblemCard({
  problem,
  selected,
  onSelect,
  series,
  selectMode,
  checked,
  onToggleSelect,
}: {
  problem: EnrichedProblem;
  selected: boolean;
  onSelect: (problem: EnrichedProblem) => void;
  series: Series | undefined;
  selectMode: boolean;
  checked: boolean;
  onToggleSelect: (eventid: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const handleActivate = () => {
    if (selectMode) onToggleSelect(problem.eventid);
    else onSelect(problem);
  };
  const highlight =
    selectMode && checked
      ? "border-accent bg-accent-soft"
      : !selectMode && selected
        ? "border-accent bg-accent-soft"
        : "";
  // Unterdrückte Probleme treten optisch zurück — nur die Statuschips bleiben voll sichtbar.
  const dimClass = problem.suppressed ? "opacity-55" : "";
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selectMode ? checked : undefined}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivate();
        }
      }}
      className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border border-line border-l-[3px] bg-surface p-2.5 text-left hover:border-accent ${severityBorderLeftClass(
        problem.severity,
      )} ${highlight}`}
    >
      <span className={`flex items-center justify-between gap-2 font-mono text-[11.5px] ${dimClass}`}>
        <span className="flex min-w-0 items-center gap-1.5">
          {selectMode && (
            <SelectSpur width={24}>
              <RoundCheck
                state={checked ? "all" : "none"}
                label={t("problems.lane.selectRowAria", problem.name)}
                onToggle={() => onToggleSelect(problem.eventid)}
              />
            </SelectSpur>
          )}
          <span className="truncate font-bold">{problem.hostName ?? "—"}</span>
        </span>
        <span className="whitespace-nowrap text-[10.5px] text-ink-muted">
          −{formatAge(problem.clock, undefined, locale)}
        </span>
      </span>
      <span className={`text-[12.5px] leading-snug ${dimClass}`}>{problem.name}</span>
      {shouldShowSparkline(problem.itemValueType, series) && (
        <span className={`-mx-0.5 mt-0.5 ${dimClass}`}>
          <Sparkline points={series!.points} height={26} />
        </span>
      )}
      <span className="mt-0.5 flex items-center justify-between gap-1.5">
        <span className={`flex min-w-0 items-center gap-1.5 ${dimClass}`}>
          <span className="truncate rounded bg-surface-3 px-1.5 font-mono text-[10px] text-ink-2">
            {problem.tags[0]?.tag ?? ""}
          </span>
        </span>
        <StatusChips problem={problem} />
      </span>
    </div>
  );
}
