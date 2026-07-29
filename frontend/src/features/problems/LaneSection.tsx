import { SEVERITY_LABEL, type Severity } from "../../lib/severity";
import { severityBorderLeftClass, severityDotClass } from "../../components/SeverityBadge";
import { Sparkline } from "../../components/Sparkline";
import { formatAge, type EnrichedProblem } from "../../lib/problems";
import type { Series } from "@auzui/timeseries";

export type ViewMode = "rows" | "cards";

export function LaneSection({
  severity,
  problems,
  mode,
  open,
  onToggleOpen,
  selectedEventId,
  onSelect,
  sparklines,
}: {
  severity: Severity;
  problems: EnrichedProblem[];
  mode: ViewMode;
  open: boolean;
  onToggleOpen: () => void;
  selectedEventId: string | undefined;
  onSelect: (problem: EnrichedProblem) => void;
  sparklines: Map<string, Series>;
}) {
  const acked = problems.filter((p) => p.acknowledged).length;

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
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold">
          <i className={`inline-block h-1.5 w-1.5 rounded-sm ${severityDotClass(severity)}`} />
          {SEVERITY_LABEL[severity].toUpperCase()}
        </span>
        <span className="font-mono text-[11px] text-ink-muted">
          {problems.length} · {acked} ack
        </span>
        <span className="h-px flex-1 bg-line-soft" />
      </div>

      {open &&
        (mode === "cards" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5 px-3.5 pb-1 pt-2.5">
            {problems.map((p) => (
              <ProblemCard
                key={p.eventid}
                problem={p}
                selected={p.eventid === selectedEventId}
                onSelect={onSelect}
                series={p.itemId ? sparklines.get(p.itemId) : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto px-3.5 pb-1 pt-1.5">
            <table className="w-full border-collapse text-xs">
              <tbody>
                {problems.map((p) => (
                  <ProblemRow
                    key={p.eventid}
                    problem={p}
                    selected={p.eventid === selectedEventId}
                    onSelect={onSelect}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

function ProblemRow({
  problem,
  selected,
  onSelect,
}: {
  problem: EnrichedProblem;
  selected: boolean;
  onSelect: (problem: EnrichedProblem) => void;
}) {
  return (
    <tr
      onClick={() => onSelect(problem)}
      className={`cursor-pointer border-b border-line-soft hover:bg-surface-2 ${selected ? "bg-accent-soft" : ""}`}
    >
      <td
        className={`w-[70px] border-l-[3px] py-1.5 pl-2 pr-2.5 font-mono text-[11.5px] text-ink-muted ${severityBorderLeftClass(problem.severity)}`}
      >
        −{formatAge(problem.clock)}
      </td>
      <td className="w-[170px] py-1.5 pr-2.5 font-mono text-[11.5px]">
        <b>{problem.hostName ?? "—"}</b>
      </td>
      <td className="min-w-[220px] py-1.5 pr-2.5">{problem.name}</td>
      <td className="w-[170px] py-1.5 pr-2.5">
        {problem.tags.slice(0, 1).map((t) => (
          <span
            key={t.tag}
            className="mr-1 inline-block whitespace-nowrap rounded bg-surface-3 px-1.5 font-mono text-[10px] text-ink-2"
          >
            {t.tag}
            {t.value ? `:${t.value}` : ""}
          </span>
        ))}
      </td>
      <td className="w-[90px] whitespace-nowrap py-1.5 font-mono text-[11px]">
        {problem.acknowledged ? (
          <span className="text-sev-ok">✓ ack</span>
        ) : (
          <span className="text-ink-muted">— ack</span>
        )}
      </td>
    </tr>
  );
}

function ProblemCard({
  problem,
  selected,
  onSelect,
  series,
}: {
  problem: EnrichedProblem;
  selected: boolean;
  onSelect: (problem: EnrichedProblem) => void;
  series: Series | undefined;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(problem)}
      className={`flex flex-col gap-1.5 rounded-lg border border-line border-l-[3px] bg-surface p-2.5 text-left hover:border-accent ${severityBorderLeftClass(
        problem.severity,
      )} ${selected ? "border-accent bg-accent-soft" : ""}`}
    >
      <span className="flex justify-between gap-2 font-mono text-[11.5px]">
        <span className="font-bold">{problem.hostName ?? "—"}</span>
        <span className="whitespace-nowrap text-[10.5px] text-ink-muted">
          −{formatAge(problem.clock)}
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
    </button>
  );
}
