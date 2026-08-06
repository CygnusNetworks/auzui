import { useLocale } from "../../lib/i18n";
import { formatUnitValue } from "../../lib/format-units";
import {
  hasNumericValue,
  parseThreshold,
  valueBreachState,
  type EnrichedProblem,
  type ValueBreachState,
} from "../../lib/problems";

const STATE_CLASS: Record<ValueBreachState, string> = {
  breach: "border-sev-high/45 bg-sev-high/10 text-sev-high",
  ok: "border-sev-ok/45 bg-sev-ok/10 text-sev-ok",
  unknown: "border-line bg-surface-2 text-ink-2",
};

/** ▲ if the value is above the threshold, ▼ if below, none if exactly equal. */
function arrowFor(value: number, thresholdValue: number): "▲" | "▼" | undefined {
  if (value > thresholdValue) return "▲";
  if (value < thresholdValue) return "▼";
  return undefined;
}

/**
 * Pill showing a problem's current item value, colored red/green by whether
 * it currently breaches the trigger's threshold (parseThreshold/valueBreachState
 * — undefined/"unknown" for compound expressions renders neutrally, no arrow).
 * Renders nothing for text/log items or a missing/non-numeric lastvalue —
 * consistent with use-sparklines' shouldShowSparkline gate, so no chip
 * appears where there is nothing meaningful to show.
 */
export function ValueChip({ problem }: { problem: EnrichedProblem }) {
  const { locale } = useLocale();
  if (!hasNumericValue(problem)) return null;

  const value = Number(problem.itemLastValue);
  const state = valueBreachState(problem);
  const threshold = parseThreshold(problem.triggerExpression);
  const arrow = threshold ? arrowFor(value, threshold.value) : undefined;

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-px font-mono text-[11px] font-semibold [font-variant-numeric:tabular-nums] ${STATE_CLASS[state]}`}
    >
      {arrow && <span aria-hidden="true">{arrow}</span>}
      {formatUnitValue(value, problem.itemUnits, 1, locale)}
    </span>
  );
}
