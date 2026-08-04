import type { WebScenarioStatus } from "../../lib/web-scenarios";
import { useT } from "../../lib/i18n";

const BG_CLASS: Record<WebScenarioStatus, string> = {
  ok: "bg-sev-ok/15 text-sev-ok",
  degraded: "bg-sev-warn/15 text-sev-warn",
  failed: "bg-sev-high/15 text-sev-high",
  disabled: "bg-ink-muted/15 text-ink-muted",
};

const DOT_CLASS: Record<WebScenarioStatus, string> = {
  ok: "bg-sev-ok",
  degraded: "bg-sev-warn",
  failed: "bg-sev-high",
  disabled: "bg-ink-muted",
};

export function statusDotClass(status: WebScenarioStatus): string {
  return DOT_CLASS[status];
}

export function StatusBadge({ status, className = "" }: { status: WebScenarioStatus; className?: string }) {
  const t = useT();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded font-mono text-[11px] font-semibold px-1.5 py-px ${BG_CLASS[status]} ${className}`}
    >
      <i className={`inline-block h-1.5 w-1.5 rounded-sm ${DOT_CLASS[status]}`} />
      {t(`webScenarios.status.${status}`).toUpperCase()}
    </span>
  );
}
