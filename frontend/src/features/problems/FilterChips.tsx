import { ALL_SEVERITIES, severityLabel, type Severity } from "../../lib/severity";
import { severityDotClass } from "../../components/SeverityBadge";
import type { EnrichedProblem } from "../../lib/problems";
import { countBySeverity } from "../../lib/problems";
import { useLocale, useT } from "../../lib/i18n";

export function FilterChips({
  problems,
  activeSeverities,
  unackOnly,
  showSuppressed,
  hostFilter,
  onToggleSeverity,
  onToggleUnack,
  onToggleSuppressed,
  onClearHostFilter,
  selectMode,
  onToggleSelectMode,
  hiddenByAck = 0,
}: {
  problems: EnrichedProblem[];
  activeSeverities: Set<Severity>;
  unackOnly: boolean;
  showSuppressed: boolean;
  /** Restrict to one host's problems (set via the Hosts-Tabelle or the ⌘K palette). */
  hostFilter?: string;
  onToggleSeverity: (severity: Severity) => void;
  onToggleUnack: () => void;
  onToggleSuppressed: () => void;
  onClearHostFilter?: () => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  /** Acknowledged problems currently withheld by this chip — shown as "+n". */
  hiddenByAck?: number;
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
      {/* Beide Chips sprechen jetzt dieselbe Sprache wie die Severity-Chips:
          gedrückt = wird angezeigt. Vorher hieß gedrückt bei „nur unbestätigte"
          versteckt mehr und bei „unterdrückte anzeigen" zeigt mehr — gleiche
          Optik, gegenläufige Bedeutung. Label und Chips bleiben als Gruppe
          zusammen, sonst rutscht „unterdrückte" ohne sein Label in die nächste
          Zeile. */}
      <span className="ml-1 flex items-center gap-2">
        <span className="font-mono text-[11px] text-ink-muted">
          {t("problems.filterChips.alsoShow")}
        </span>
        <button
          type="button"
          onClick={onToggleUnack}
          aria-pressed={!unackOnly}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs ${
            !unackOnly ? "border-accent/50 text-ink font-semibold" : "border-line text-ink-2"
          }`}
        >
          {t("problems.filterChips.acknowledged")}
          {unackOnly && hiddenByAck > 0 && (
            <span className="tabular-nums text-ink-muted">+{hiddenByAck}</span>
          )}
        </button>
        <button
          type="button"
          onClick={onToggleSuppressed}
          aria-pressed={showSuppressed}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs ${
            showSuppressed ? "border-accent/50 text-ink font-semibold" : "border-line text-ink-2"
          }`}
        >
          {t("problems.filterChips.suppressed")}
        </button>
      </span>
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
      <button
        type="button"
        onClick={onToggleSelectMode}
        aria-pressed={selectMode}
        className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs transition-colors ${
          selectMode
            ? "border-accent bg-accent-soft font-semibold text-accent"
            : "border-line text-ink-2 hover:text-ink"
        }`}
      >
        {selectMode ? t("problems.selectMode.active") : t("problems.selectMode.enter")}
      </button>
    </div>
  );
}
