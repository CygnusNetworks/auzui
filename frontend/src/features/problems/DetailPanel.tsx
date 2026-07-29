import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { SeverityBadge } from "../../components/SeverityBadge";
import { ALL_SEVERITIES, severityLabel, type Severity } from "../../lib/severity";
import { formatAge, type EnrichedProblem } from "../../lib/problems";
import { useAcknowledge } from "./use-acknowledge";
import { useEventTimeline } from "./use-event-timeline";
import { useAppConfig } from "../../lib/use-app-config";
import { useLogsEnabled } from "../../lib/use-logs";
import { useLocale, useT } from "../../lib/i18n";

const LOGS_CONTEXT_WINDOW_SECONDS = 15 * 60;

export function DetailPanel({ problem }: { problem: EnrichedProblem | undefined }) {
  const t = useT();
  const { locale } = useLocale();
  const [comment, setComment] = useState("");
  const [newSeverity, setNewSeverity] = useState<Severity | undefined>(undefined);
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

  function submitComment() {
    if (!problem || comment.trim().length === 0) return;
    acknowledge.mutate(
      { eventids: [problem.eventid], message: comment },
      { onSuccess: () => setComment("") },
    );
  }

  function submitSeverity() {
    if (!problem || newSeverity === undefined) return;
    acknowledge.mutate(
      { eventids: [problem.eventid], severity: newSeverity },
      { onSuccess: () => setNewSeverity(undefined) },
    );
  }

  return (
    <div>
      <div className="border-b border-line-soft p-3.5">
        <div className="mb-1 flex items-center gap-2">
          <SeverityBadge severity={problem.severity} />
          {problem.hostName && (
            <span className="font-mono text-xs font-bold">{problem.hostName}</span>
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
          {(timeline.data?.[0]?.acknowledges ?? []).map((entry) => (
            <div key={entry.acknowledgeid} className="flex items-baseline gap-2">
              <span className="whitespace-nowrap font-mono text-[10.5px] text-ink-muted">
                −{formatAge(Number(entry.clock), undefined, locale)}
              </span>
              <span>
                {(Number(entry.action) & 2) !== 0 && t("problems.detailPanel.acknowledged")}
                {(Number(entry.action) & 16) !== 0 && t("problems.detailPanel.unacknowledgedEntry")}
                {entry.message ? ` — „${entry.message}“` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("problems.detailPanel.actions")}
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {problem.acknowledged ? (
            <button
              type="button"
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate({ eventids: [problem.eventid], unack: true })}
            >
              {t("problems.detailPanel.unack")}
            </button>
          ) : (
            <button
              type="button"
              className="rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate({ eventids: [problem.eventid], ack: true })}
            >
              {t("problems.detailPanel.acknowledge")}
            </button>
          )}
          {problem.suppressed ? (
            <button
              type="button"
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate({ eventids: [problem.eventid], unsuppress: true })}
            >
              {t("problems.detailPanel.unsuppress")}
            </button>
          ) : (
            <button
              type="button"
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
              disabled={acknowledge.isPending}
              onClick={() =>
                acknowledge.mutate({ eventids: [problem.eventid], suppress: true, suppressUntil: 0 })
              }
            >
              {t("problems.detailPanel.suppress")}
            </button>
          )}
        </div>
        <div className="mb-2 flex gap-1.5">
          <select
            value={newSeverity ?? ""}
            onChange={(e) =>
              setNewSeverity(e.target.value === "" ? undefined : (Number(e.target.value) as Severity))
            }
            className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink outline-none focus-visible:border-accent"
          >
            <option value="">{t("problems.detailPanel.changeSeverity")}</option>
            {ALL_SEVERITIES.map((sev) => (
              <option key={sev} value={sev}>
                {severityLabel(sev, locale)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 disabled:opacity-40"
            disabled={acknowledge.isPending || newSeverity === undefined || newSeverity === problem.severity}
            onClick={submitSeverity}
          >
            {t("problems.detailPanel.apply")}
          </button>
        </div>
        <div className="flex gap-1.5">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("problems.detailPanel.commentPlaceholder")}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink outline-none focus-visible:border-accent"
          />
          <button
            type="button"
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 disabled:opacity-40"
            disabled={acknowledge.isPending || comment.trim().length === 0}
            onClick={submitComment}
          >
            {t("problems.detailPanel.send")}
          </button>
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
