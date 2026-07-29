import { ALL_SEVERITIES, SEVERITY_LABEL, type Severity } from "../../lib/severity";
import { severityDotClass } from "../../components/SeverityBadge";
import type { EnrichedProblem } from "../../lib/problems";
import { countBySeverity } from "../../lib/problems";

export function FilterChips({
  problems,
  activeSeverities,
  unackOnly,
  onToggleSeverity,
  onToggleUnack,
}: {
  problems: EnrichedProblem[];
  activeSeverities: Set<Severity>;
  unackOnly: boolean;
  onToggleSeverity: (severity: Severity) => void;
  onToggleUnack: () => void;
}) {
  const counts = countBySeverity(problems);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
      {ALL_SEVERITIES.filter((s) => s !== 0 || counts[0] > 0).map((severity) => {
        const on = activeSeverities.has(severity);
        return (
          <button
            key={severity}
            type="button"
            onClick={() => onToggleSeverity(severity)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs transition-opacity ${
              on ? "border-accent/50 text-ink font-semibold opacity-100" : "border-line text-ink-2 opacity-40"
            }`}
          >
            <i className={`inline-block h-2 w-2 rounded-sm ${severityDotClass(severity)}`} />
            {SEVERITY_LABEL[severity]} {counts[severity]}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onToggleUnack}
        aria-pressed={unackOnly}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs ${
          unackOnly ? "border-accent/50 text-ink font-semibold" : "border-line text-ink-2"
        }`}
      >
        nur unbestätigte
      </button>
    </div>
  );
}
