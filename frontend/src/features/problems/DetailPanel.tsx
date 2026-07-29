import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { SeverityBadge } from "../../components/SeverityBadge";
import { formatAge, type EnrichedProblem } from "../../lib/problems";
import { useAcknowledge } from "./use-acknowledge";
import { useEventTimeline } from "./use-event-timeline";
import { useAppConfig } from "../../lib/use-app-config";

export function DetailPanel({ problem }: { problem: EnrichedProblem | undefined }) {
  const [comment, setComment] = useState("");
  const acknowledge = useAcknowledge();
  const timeline = useEventTimeline(problem?.eventid);
  const { data: config } = useAppConfig();

  if (!problem) {
    return (
      <div className="p-3.5 text-sm text-ink-2">Kein Problem ausgewählt.</div>
    );
  }

  const oldUiUrl = config?.zabbix_ui_url
    ? `${config.zabbix_ui_url}/tr_events.php?triggerid=${encodeURIComponent(problem.objectid)}&eventid=${encodeURIComponent(problem.eventid)}`
    : undefined;

  function submitComment() {
    if (!problem || comment.trim().length === 0) return;
    acknowledge.mutate(
      { eventid: problem.eventid, message: comment },
      { onSuccess: () => setComment("") },
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
          seit {formatAge(problem.clock)} · Event #{problem.eventid}
        </div>
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          Trigger
        </div>
        <div className="break-all font-mono text-[11.5px] text-ink-2">
          {problem.triggerExpression ?? "—"}
        </div>
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          Timeline
        </div>
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex items-baseline gap-2">
            <span className="whitespace-nowrap font-mono text-[10.5px] text-ink-muted">
              −{formatAge(problem.clock)}
            </span>
            <span>PROBLEM erkannt</span>
          </div>
          {(timeline.data?.[0]?.acknowledges ?? []).map((entry) => (
            <div key={entry.acknowledgeid} className="flex items-baseline gap-2">
              <span className="whitespace-nowrap font-mono text-[10.5px] text-ink-muted">
                −{formatAge(Number(entry.clock))}
              </span>
              <span>
                {(Number(entry.action) & 2) !== 0 && "✓ bestätigt"}
                {(Number(entry.action) & 16) !== 0 && "↺ un-ack"}
                {entry.message ? ` — „${entry.message}“` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          Aktionen
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {problem.acknowledged ? (
            <button
              type="button"
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate({ eventid: problem.eventid, unack: true })}
            >
              Un-Ack
            </button>
          ) : (
            <button
              type="button"
              className="rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate({ eventid: problem.eventid, ack: true })}
            >
              ✓ Bestätigen
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Kommentar…"
            className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink outline-none focus-visible:border-accent"
          />
          <button
            type="button"
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 disabled:opacity-40"
            disabled={acknowledge.isPending || comment.trim().length === 0}
            onClick={submitComment}
          >
            Senden
          </button>
        </div>
      </div>

      <div className="p-3.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          Kontext
        </div>
        <div className="flex flex-wrap gap-1.5">
          {problem.hostId && (
            <Link
              to="/hosts/$hostId"
              params={{ hostId: problem.hostId }}
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
            >
              Host Deep-Dive →
            </Link>
          )}
          {oldUiUrl && (
            <a
              href={oldUiUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
            >
              im alten UI öffnen ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
