import { ALL_SEVERITIES, severityLabel, type Severity } from "../../lib/severity";
import { severityDotClass } from "../../components/SeverityBadge";
import type { EnrichedProblem } from "../../lib/problems";
import { countBySeverity } from "../../lib/problems";
import { useLocale, useT } from "../../lib/i18n";

export function FilterChips({
  problems,
  activeSeverities,
  unackOnly,
  hostFilter,
  onToggleSeverity,
  onToggleUnack,
  onClearHostFilter,
}: {
  problems: EnrichedProblem[];
  activeSeverities: Set<Severity>;
  unackOnly: boolean;
  /** Restrict to one host's problems (set via the Hosts-Tabelle or the ⌘K palette). */
  hostFilter?: string;
  onToggleSeverity: (severity: Severity) => void;
  onToggleUnack: () => void;
  onClearHostFilter?: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
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
            {severityLabel(severity, locale)} {counts[severity]}
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
        {t("problems.filterChips.unackOnly")}
      </button>
      {hostFilter && (
        <button
          type="button"
          onClick={onClearHostFilter}
          aria-pressed="true"
          className="inline-flex items-center gap-1.5 rounded-full border border-accent/50 px-2.5 py-1 font-mono text-xs font-semibold text-ink"
        >
          {t("problems.filterChips.hostFilter", hostFilter)}
        </button>
      )}
    </div>
  );
}
