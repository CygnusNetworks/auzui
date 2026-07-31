import { severityDotClass } from "../../components/SeverityBadge";
import { ALL_SEVERITIES, severityLabel, type Severity } from "../../lib/severity";
import { useLocale } from "../../lib/i18n";

/**
 * Severity pill row — shared between the detail panel and the bulk selection
 * bar's severity popover. `current` marks the active pill (single-problem
 * case); bulk callers leave it undefined so every severity is selectable.
 */
export function SeverityPills({
  current,
  disabled,
  onSelect,
}: {
  current?: Severity;
  disabled: boolean;
  onSelect: (severity: Severity) => void;
}) {
  const { locale } = useLocale();
  return (
    <div className="flex flex-wrap gap-1">
      {ALL_SEVERITIES.map((sev) => {
        const active = sev === current;
        return (
          <button
            key={sev}
            type="button"
            aria-pressed={active}
            disabled={disabled || active}
            onClick={() => onSelect(sev)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-opacity disabled:cursor-default ${
              active
                ? "border-accent/50 font-semibold text-ink opacity-100"
                : "border-line text-ink-2 opacity-60 hover:opacity-100"
            }`}
          >
            <i className={`inline-block h-2 w-2 rounded-sm ${severityDotClass(sev)}`} />
            {severityLabel(sev, locale)}
          </button>
        );
      })}
    </div>
  );
}
