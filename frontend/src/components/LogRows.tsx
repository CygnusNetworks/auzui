import { useState } from "react";
import type { LogMessage } from "@auzui/logs";
import { logLevelBadgeClass } from "../lib/log-level";

const timeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function applicationName(fields: Record<string, unknown>): string | undefined {
  const v = fields.application_name;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function fullMessage(msg: LogMessage): string | undefined {
  const v = msg.fields.full_message;
  return typeof v === "string" && v.length > 0 && v !== msg.message ? v : undefined;
}

/**
 * Dichte Log-Zeilenliste mit Expand (Zeit · Level · Application · Message,
 * Klick öffnet Fulltext + Fields) — extrahiert aus
 * features/host-detail/LogsPanel.tsx (PLAN.md Abschnitt H), damit der
 * Stream-Browser (/logs) und das Host-Panel dieselbe Zeilendarstellung
 * teilen.
 *
 * Die Message-Zeile wird NICHT mehr einzeilig abgeschnitten (Nutzerbeschwerde:
 * "Logzeile wird nicht komplett dargestellt") — im Ruhezustand ein
 * `line-clamp-2`-Vorschau-Block, expandiert der volle Text plus ggf.
 * `fields.full_message` in einem eigenen Block.
 */
export function LogRows({ messages }: { messages: LogMessage[] }) {
  const [expanded, setExpanded] = useState<number | undefined>(undefined);

  return (
    <div className="divide-y divide-line-soft">
      {messages.map((msg, i) => {
        const isOpen = expanded === i;
        const appName = applicationName(msg.fields);
        const full = fullMessage(msg);
        return (
          <div key={`${msg.timestamp}-${i}`}>
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? undefined : i)}
              className="grid w-full grid-cols-[130px_60px_1fr] items-start gap-2 px-3.5 py-1.5 text-left text-[12px] hover:bg-surface-2"
            >
              <span className="pt-0.5 font-mono text-[11px] text-ink-muted">
                {timeFmt.format(new Date(msg.timestamp * 1000))}
              </span>
              <span
                className={`inline-flex h-fit items-center justify-center rounded border px-1 py-px font-mono text-[10px] font-semibold ${logLevelBadgeClass(msg.level)}`}
              >
                {msg.level ?? "?"}
              </span>
              <span className="min-w-0">
                <span className="mb-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-mono text-[11px] text-ink-2">{msg.source}</span>
                  {appName && (
                    <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                      {appName}
                    </span>
                  )}
                </span>
                <span
                  className={`block whitespace-pre-wrap break-words font-mono text-[11.5px] text-ink ${
                    isOpen ? "" : "line-clamp-2"
                  }`}
                >
                  {msg.message}
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="border-t border-line-soft bg-surface-2 px-3.5 py-2.5 text-[12px]">
                <div className="mb-2 whitespace-pre-wrap break-words font-mono text-[11.5px]">
                  {msg.message}
                </div>
                {full && (
                  <div className="mb-2">
                    <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                      full_message
                    </div>
                    <div className="whitespace-pre-wrap break-words rounded border border-line-soft bg-surface p-2 font-mono text-[11.5px]">
                      {full}
                    </div>
                  </div>
                )}
                {Object.keys(msg.fields).length > 0 && (
                  <div className="grid grid-cols-[minmax(0,160px)_1fr] gap-x-3 gap-y-1 font-mono text-[11px] text-ink-2">
                    {Object.entries(msg.fields).map(([key, value]) => (
                      <span key={key} className="contents">
                        <span className="truncate text-ink-muted">{key}</span>
                        <span className="truncate">{String(value)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
