import { useRef, type ReactNode } from "react";
import { severityLabel, type Severity } from "../../lib/severity";
import { severityBorderLeftClass, severityDotClass } from "../../components/SeverityBadge";
import { Sparkline } from "../../components/Sparkline";
import { formatAge, type EnrichedProblem } from "../../lib/problems";
import { useAnimatedPresence } from "../../lib/use-animated-presence";
import { useLocale, useT } from "../../lib/i18n";
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

export function LaneSection({
  severity,
  problems,
  mode,
  open,
  onToggleOpen,
  selectedEventId,
  onSelect,
  sparklines,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: {
  severity: Severity;
  problems: EnrichedProblem[];
  mode: ViewMode;
  open: boolean;
  onToggleOpen: () => void;
  selectedEventId: string | undefined;
  onSelect: (problem: EnrichedProblem) => void;
  sparklines: Map<string, Series>;
  /** Bulk-selection (multi-select action bar), keyed by eventid. */
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (eventid: string) => void;
  onToggleSelectAll: (eventids: string[], checked: boolean) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const acked = problems.filter((p) => p.acknowledged).length;
  const allSelected = problems.length > 0 && problems.every((p) => selectedIds.has(p.eventid));
  const someSelected = problems.some((p) => selectedIds.has(p.eventid));
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  if (headerCheckboxRef.current) {
    headerCheckboxRef.current.indeterminate = someSelected && !allSelected;
  }

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
        <input
          ref={headerCheckboxRef}
          type="checkbox"
          checked={allSelected}
          onChange={(e) =>
            onToggleSelectAll(
              problems.map((p) => p.eventid),
              e.target.checked,
            )
          }
          aria-label={t("problems.lane.selectAllAria", severityLabel(severity, locale))}
          className="h-3.5 w-3.5 accent-accent"
        />
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold">
          <i className={`inline-block h-1.5 w-1.5 rounded-sm ${severityDotClass(severity)}`} />
          {severityLabel(severity, locale).toUpperCase()}
        </span>
        <span className="font-mono text-[11px] text-ink-muted">
          {problems.length} · {t("problems.lane.ackedCount", acked)}
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
                  checked={selectedIds.has(p.eventid)}
                  onToggleSelect={onToggleSelect}
                />
              </CollapseOnLeave>
            ))}
          </div>
        ) : (
          <div className="px-3.5 pb-1 pt-1.5">
            <div className="overflow-x-auto" role="table" aria-label={t("problems.lane.tableAria", severityLabel(severity, locale))}>
              {presence.map(({ item: p, leaving }) => (
                <CollapseOnLeave key={p.eventid} leaving={leaving}>
                  <ProblemRow
                    problem={p}
                    selected={p.eventid === selectedEventId}
                    onSelect={onSelect}
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

const ROW_GRID_COLS = "24px 70px 170px minmax(220px,1fr) 170px 90px";

function ProblemRow({
  problem,
  selected,
  onSelect,
  checked,
  onToggleSelect,
}: {
  problem: EnrichedProblem;
  selected: boolean;
  onSelect: (problem: EnrichedProblem) => void;
  checked: boolean;
  onToggleSelect: (eventid: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div
      role="row"
      onClick={() => onSelect(problem)}
      className={`grid cursor-pointer items-center gap-2.5 border-b border-line-soft py-1.5 text-xs hover:bg-surface-2 ${selected ? "bg-accent-soft" : ""}`}
      style={{ gridTemplateColumns: ROW_GRID_COLS }}
    >
      <span onClick={(e) => e.stopPropagation()} className="pl-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggleSelect(problem.eventid)}
          aria-label={t("problems.lane.selectRowAria", problem.name)}
          className="h-3.5 w-3.5 accent-accent"
        />
      </span>
      <span
        className={`border-l-[3px] pl-2 pr-2.5 font-mono text-[11.5px] text-ink-muted ${severityBorderLeftClass(problem.severity)}`}
      >
        −{formatAge(problem.clock, undefined, locale)}
      </span>
      <span className="pr-2.5 font-mono text-[11.5px]">
        <b>{problem.hostName ?? "—"}</b>
      </span>
      <span className="pr-2.5">{problem.name}</span>
      <span className="pr-2.5">
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
      <span className="whitespace-nowrap font-mono text-[11px]">
        {problem.acknowledged ? (
          <span className="text-sev-ok">✓ ack</span>
        ) : (
          <span className="text-ink-muted">— ack</span>
        )}
      </span>
    </div>
  );
}

function ProblemCard({
  problem,
  selected,
  onSelect,
  series,
  checked,
  onToggleSelect,
}: {
  problem: EnrichedProblem;
  selected: boolean;
  onSelect: (problem: EnrichedProblem) => void;
  series: Series | undefined;
  checked: boolean;
  onToggleSelect: (eventid: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(problem)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(problem);
        }
      }}
      className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border border-line border-l-[3px] bg-surface p-2.5 text-left hover:border-accent ${severityBorderLeftClass(
        problem.severity,
      )} ${selected ? "border-accent bg-accent-soft" : ""}`}
    >
      <span className="flex items-center justify-between gap-2 font-mono text-[11.5px]">
        <span className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={checked}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect(problem.eventid)}
            aria-label={t("problems.lane.selectRowAria", problem.name)}
            className="h-3.5 w-3.5 accent-accent"
          />
          <span className="font-bold">{problem.hostName ?? "—"}</span>
        </span>
        <span className="whitespace-nowrap text-[10.5px] text-ink-muted">
          −{formatAge(problem.clock, undefined, locale)}
        </span>
      </span>
      <span className="text-[12.5px] leading-snug">{problem.name}</span>
      {series && series.points.length > 1 && (
        <span className="-mx-0.5 mt-0.5">
          <Sparkline points={series.points} height={26} />
        </span>
      )}
      <span className="mt-0.5 flex items-center justify-between">
        <span className="rounded bg-surface-3 px-1.5 font-mono text-[10px] text-ink-2">
          {problem.tags[0]?.tag ?? ""}
        </span>
        {problem.acknowledged ? (
          <span className="font-mono text-[11px] text-sev-ok">✓ ack</span>
        ) : (
          <span className="font-mono text-[11px] text-ink-muted">ack</span>
        )}
      </span>
    </div>
  );
}
