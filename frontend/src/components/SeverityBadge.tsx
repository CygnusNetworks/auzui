import { SEVERITY_LABEL, type Severity } from "../lib/severity";

const BG_CLASS: Record<Severity, string> = {
  5: "bg-sev-disaster/15 text-sev-disaster",
  4: "bg-sev-high/15 text-sev-high",
  3: "bg-sev-avg/15 text-sev-avg",
  2: "bg-sev-warn/15 text-sev-warn",
  1: "bg-sev-info/15 text-sev-info",
  0: "bg-ink-muted/15 text-ink-muted",
};

const DOT_CLASS: Record<Severity, string> = {
  5: "bg-sev-disaster",
  4: "bg-sev-high",
  3: "bg-sev-avg",
  2: "bg-sev-warn",
  1: "bg-sev-info",
  0: "bg-ink-muted",
};

const TEXT_CLASS: Record<Severity, string> = {
  5: "text-sev-disaster",
  4: "text-sev-high",
  3: "text-sev-avg",
  2: "text-sev-warn",
  1: "text-sev-info",
  0: "text-ink-muted",
};

const BORDER_LEFT_CLASS: Record<Severity, string> = {
  5: "border-l-sev-disaster",
  4: "border-l-sev-high",
  3: "border-l-sev-avg",
  2: "border-l-sev-warn",
  1: "border-l-sev-info",
  0: "border-l-ink-muted",
};

export function severityDotClass(severity: Severity): string {
  return DOT_CLASS[severity];
}

export function severityTextClass(severity: Severity): string {
  return TEXT_CLASS[severity];
}

export function severityBorderLeftClass(severity: Severity): string {
  return BORDER_LEFT_CLASS[severity];
}

export function SeverityBadge({
  severity,
  className = "",
}: {
  severity: Severity;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded font-mono text-[11px] font-semibold px-1.5 py-px ${BG_CLASS[severity]} ${className}`}
    >
      <i className={`inline-block h-1.5 w-1.5 rounded-sm ${DOT_CLASS[severity]}`} />
      {SEVERITY_LABEL[severity].toUpperCase()}
    </span>
  );
}
