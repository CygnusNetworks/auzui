import { useT } from "../../lib/i18n";
import type { VisibilityBreakdown } from "../../lib/problems";

/** One legend entry: a swatch, its count, its label and (usually) a way back. */
function Segment({
  swatchClass,
  count,
  label,
  action,
  onAction,
}: {
  swatchClass: string;
  count: number;
  label: string;
  action?: string;
  onAction?: () => void;
}) {
  const body = (
    <>
      <i className={`inline-block h-2 w-2 shrink-0 rounded-[2px] ${swatchClass}`} />
      <b className="font-mono font-semibold tabular-nums text-ink">{count}</b>
      {label}
      {action && <span className="text-accent">{action}</span>}
    </>
  );
  if (!action || !onAction) {
    return <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5">{body}</span>;
  }
  return (
    <button
      type="button"
      onClick={onAction}
      className="inline-flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 hover:border-line hover:bg-surface-2 hover:text-ink"
    >
      {body}
    </button>
  );
}

/**
 * "6 aktiv = 4 angezeigt + 1 bestätigt + 1 Severity" — the arithmetic between
 * the (unfiltered) header counts and the list below it, rendered right above
 * the list where the gap is noticed. Every hidden bucket doubles as the control
 * that brings those problems back, so the way out of a filter is where its
 * effect is visible instead of buried in the chip row.
 *
 * Renders nothing when nothing is hidden — the line is a correction, not chrome.
 */
export function VisibilityBalance({
  breakdown,
  hostFilter,
  onShowAcknowledged,
  onShowSuppressed,
  onClearSeverities,
  onClearHostFilter,
}: {
  breakdown: VisibilityBreakdown;
  hostFilter?: string;
  onShowAcknowledged: () => void;
  onShowSuppressed: () => void;
  onClearSeverities: () => void;
  onClearHostFilter?: () => void;
}) {
  const t = useT();
  if (breakdown.hiddenTotal === 0) return null;

  const { total, shown } = breakdown;
  return (
    <div className="flex flex-col gap-2 border-b border-line-soft px-3.5 py-2.5">
      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-line-soft"
        role="img"
        aria-label={t("problems.balance.barAria", shown, total, breakdown.hiddenTotal)}
      >
        <span className="bg-accent" style={{ flex: shown }} />
        <span className="bg-sev-ok/70" style={{ flex: breakdown.hiddenByAck }} />
        <span className="bg-ink-muted/50" style={{ flex: breakdown.hiddenBySuppressed }} />
        <span className="bg-line" style={{ flex: breakdown.hiddenBySeverity + breakdown.hiddenByHost }} />
      </div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11.5px] text-ink-2">
        <span className="px-1.5">
          <b className="font-mono font-semibold tabular-nums text-ink">{total}</b>{" "}
          {t("problems.balance.active")}
        </span>
        <span className="text-ink-muted">=</span>
        <Segment swatchClass="bg-accent" count={shown} label={t("problems.balance.shown")} />
        {breakdown.hiddenByAck > 0 && (
          <>
            <span className="text-ink-muted">+</span>
            <Segment
              swatchClass="bg-sev-ok/70"
              count={breakdown.hiddenByAck}
              label={t("problems.balance.acknowledged")}
              action={t("problems.balance.showAction")}
              onAction={onShowAcknowledged}
            />
          </>
        )}
        {breakdown.hiddenBySuppressed > 0 && (
          <>
            <span className="text-ink-muted">+</span>
            <Segment
              swatchClass="bg-ink-muted/50"
              count={breakdown.hiddenBySuppressed}
              label={t("problems.balance.suppressed")}
              action={t("problems.balance.showAction")}
              onAction={onShowSuppressed}
            />
          </>
        )}
        {breakdown.hiddenBySeverity > 0 && (
          <>
            <span className="text-ink-muted">+</span>
            <Segment
              swatchClass="bg-line"
              count={breakdown.hiddenBySeverity}
              label={t("problems.balance.bySeverity")}
              action={t("problems.balance.resetAction")}
              onAction={onClearSeverities}
            />
          </>
        )}
        {breakdown.hiddenByHost > 0 && (
          <>
            <span className="text-ink-muted">+</span>
            <Segment
              swatchClass="bg-line"
              count={breakdown.hiddenByHost}
              label={t("problems.balance.byHost", hostFilter ?? "")}
              action={t("problems.balance.resetAction")}
              onAction={onClearHostFilter}
            />
          </>
        )}
      </div>
    </div>
  );
}
