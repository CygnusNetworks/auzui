import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { SeverityBadge } from "../../components/SeverityBadge";
import { severityFromWire, severityLabel, type Severity } from "../../lib/severity";
import { formatAge, hasNumericValue, type EnrichedProblem } from "../../lib/problems";
import { useAcknowledge, type AcknowledgeInput } from "./use-acknowledge";
import { ValueChip } from "./ValueChip";
import { SuppressButton } from "./SuppressButton";
import { SeverityPills } from "./SeverityPills";
import { useEventTimeline } from "./use-event-timeline";
import { useAppConfig } from "../../lib/use-app-config";
import { useLogsEnabled } from "../../lib/use-logs";
import { useLocale, useT, type Locale } from "../../lib/i18n";

const LOGS_CONTEXT_WINDOW_SECONDS = 15 * 60;

/** Short local date+time for "suppressed until …" timeline entries. */
function formatClock(unixSeconds: number, locale: Locale): string {
  return new Date(unixSeconds * 1000).toLocaleString(locale === "de" ? "de-DE" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DetailPanel({ problem }: { problem: EnrichedProblem | undefined }) {
  const t = useT();
  const { locale } = useLocale();
  const [comment, setComment] = useState("");
  const acknowledge = useAcknowledge();
  const timeline = useEventTimeline(problem?.eventid);
  const { data: config } = useAppConfig();
  const { data: logsEnabled } = useLogsEnabled();

  if (!problem) {
    return (
      <div className="p-3.5 text-sm text-ink-2">{t("problems.detailPanel.noneSelected")}</div>
    );
  }

  const oldUiUrl = config?.zabbix_ui_url
    ? `${config.zabbix_ui_url}/tr_events.php?triggerid=${encodeURIComponent(problem.objectid)}&eventid=${encodeURIComponent(problem.eventid)}`
    : undefined;

  // Alle Aktionen nehmen das Kommentarfeld als Nachricht mit (ein einziger
  // event.acknowledge-Call, z. B. action 2|4) und leeren es bei Erfolg.
  function act(input: Omit<AcknowledgeInput, "eventids" | "message">) {
    if (!problem) return;
    acknowledge.mutate(
      { eventids: [problem.eventid], message: comment, ...input },
      { onSuccess: () => setComment("") },
    );
  }

  function submitComment() {
    if (comment.trim().length === 0) return;
    act({});
  }

  function changeSeverity(severity: Severity) {
    if (!problem || severity === problem.severity) return;
    act({ severity });
  }

  return (
    <div>
      <div className="border-b border-line-soft p-3.5">
        <div className="mb-1 flex items-center gap-2">
          <SeverityBadge severity={problem.severity} />
          {problem.hostName && (
            <span className="font-mono text-xs font-bold">{problem.hostName}</span>
          )}
          {problem.suppressed && (
            <span className="rounded bg-surface-3 px-1.5 font-mono text-[10px] text-ink-muted">
              {t("problems.lane.suppressedBadge")}
            </span>
          )}
        </div>
        <div className="text-sm font-semibold">{problem.name}</div>
        <div className="mt-1 text-[11.5px] text-ink-muted">
          {t("problems.detailPanel.since", formatAge(problem.clock, undefined, locale))} ·{" "}
          {t("problems.detailPanel.event", problem.eventid)}
        </div>
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("problems.detailPanel.trigger")}
        </div>
        <div className="break-all font-mono text-[11.5px] text-ink-2">
          {problem.triggerExpression ?? "—"}
        </div>
        {hasNumericValue(problem) && (
          <div className="mt-2 flex items-center gap-2">
            <ValueChip problem={problem} />
            {problem.itemLastClock && (
              <span className="text-[10.5px] text-ink-muted">
                {t(
                  "problems.detailPanel.valueAsOf",
                  formatAge(Number(problem.itemLastClock), undefined, locale),
                )}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("problems.detailPanel.timeline")}
        </div>
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex items-baseline gap-2">
            <span className="whitespace-nowrap font-mono text-[10.5px] text-ink-muted">
              −{formatAge(problem.clock, undefined, locale)}
            </span>
            <span>{t("problems.detailPanel.problemDetected")}</span>
          </div>
          {(timeline.data?.[0]?.acknowledges ?? []).map((entry) => {
            const bits = Number(entry.action);
            const parts: string[] = [];
            if (bits & 1) parts.push(t("problems.detailPanel.closedEntry"));
            if (bits & 2) parts.push(t("problems.detailPanel.acknowledged"));
            if (bits & 16) parts.push(t("problems.detailPanel.unacknowledgedEntry"));
            if (bits & 8)
              parts.push(
                t(
                  "problems.detailPanel.severityChangedEntry",
                  severityLabel(severityFromWire(entry.old_severity ?? "0"), locale),
                  severityLabel(severityFromWire(entry.new_severity ?? "0"), locale),
                ),
              );
            if (bits & 32) {
              const until = Number(entry.suppress_until ?? 0);
              parts.push(
                until > 0
                  ? t("problems.detailPanel.suppressedUntilEntry", formatClock(until, locale))
                  : t("problems.detailPanel.suppressedEntry"),
              );
            }
            if (bits & 64) parts.push(t("problems.detailPanel.unsuppressedEntry"));
            // A pure comment (action 4, no other bit) would otherwise render as
            // a bare "— „…“" with nothing in front of it.
            if (parts.length === 0 && bits & 4) parts.push(t("problems.detailPanel.commentEntry"));
            return (
              <div key={entry.acknowledgeid} className="flex items-baseline gap-2">
                <span className="whitespace-nowrap font-mono text-[10.5px] text-ink-muted">
                  −{formatAge(Number(entry.clock), undefined, locale)}
                </span>
                <span>
                  {parts.join(" · ")}
                  {entry.message ? ` — „${entry.message}“` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("problems.detailPanel.actions")}
        </div>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitComment();
          }}
          placeholder={t("problems.detailPanel.commentPlaceholder")}
          className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink outline-none focus-visible:border-accent"
        />
        <div className="mb-2 mt-1 text-[10.5px] text-ink-muted">
          {t("problems.detailPanel.commentHint")}
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {problem.acknowledged ? (
            <button
              type="button"
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
              disabled={acknowledge.isPending}
              onClick={() => act({ unack: true })}
            >
              {t("problems.detailPanel.unack")}
            </button>
          ) : (
            <button
              type="button"
              className="rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent"
              disabled={acknowledge.isPending}
              onClick={() => act({ ack: true })}
            >
              {t("problems.detailPanel.acknowledge")}
            </button>
          )}
          {problem.suppressed ? (
            <button
              type="button"
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
              disabled={acknowledge.isPending}
              onClick={() => act({ unsuppress: true })}
            >
              {t("problems.detailPanel.unsuppress")}
            </button>
          ) : (
            <SuppressButton
              pending={acknowledge.isPending}
              onSuppress={(suppressUntil) => act({ suppress: true, suppressUntil })}
            />
          )}
          {problem.manualClose && (
            <button
              type="button"
              className="ml-auto rounded-md border border-sev-high/45 bg-sev-high/10 px-2.5 py-1 text-xs font-semibold text-sev-high disabled:opacity-40"
              disabled={acknowledge.isPending}
              onClick={() => act({ close: true })}
            >
              {t("problems.detailPanel.close")}
            </button>
          )}
        </div>
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
            {t("problems.detailPanel.changeSeverity")}
          </div>
          <SeverityPills
            current={problem.severity}
            disabled={acknowledge.isPending}
            onSelect={changeSeverity}
          />
        </div>
      </div>

      <div className="p-3.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("problems.detailPanel.context")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {problem.hostId && (
            <Link
              to="/hosts/$hostId"
              params={{ hostId: problem.hostId }}
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
            >
              {t("problems.detailPanel.hostDeepDive")}
            </Link>
          )}
          {problem.hostId && logsEnabled && (
            <Link
              to="/hosts/$hostId"
              params={{ hostId: problem.hostId }}
              search={{
                from: problem.clock - LOGS_CONTEXT_WINDOW_SECONDS,
                to: problem.clock + LOGS_CONTEXT_WINDOW_SECONDS,
              }}
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
            >
              {t("problems.detailPanel.logsWindow")}
            </Link>
          )}
          {oldUiUrl && (
            <a
              href={oldUiUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
            >
              {t("problems.detailPanel.openInOldUi")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
