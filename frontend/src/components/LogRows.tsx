import { useState } from "react";
import type { LogMessage } from "@auzui/logs";

const timeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * Dichte Log-Zeilenliste mit Expand (Zeit · Source · Message-Preview, Klick
 * öffnet Fulltext + Fields) — extrahiert aus features/host-detail/LogsPanel.tsx
 * (PLAN.md Abschnitt H), damit der Stream-Browser (/logs) und das Host-Panel
 * dieselbe Zeilendarstellung teilen.
 */
export function LogRows({ messages }: { messages: LogMessage[] }) {
  const [expanded, setExpanded] = useState<number | undefined>(undefined);

  return (
    <div className="divide-y divide-line-soft">
      {messages.map((msg, i) => {
        const isOpen = expanded === i;
        return (
          <div key={`${msg.timestamp}-${i}`}>
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? undefined : i)}
              className="grid w-full grid-cols-[150px_140px_1fr] items-center gap-2 px-3.5 py-1.5 text-left text-[12px] hover:bg-surface-2"
            >
              <span className="font-mono text-[11px] text-ink-muted">
                {timeFmt.format(new Date(msg.timestamp * 1000))}
              </span>
              <span className="truncate font-mono text-[11px] text-ink-2">{msg.source}</span>
              <span className="truncate text-ink">{msg.message}</span>
            </button>
            {isOpen && (
              <div className="border-t border-line-soft bg-surface-2 px-3.5 py-2.5 text-[12px]">
                <div className="mb-2 whitespace-pre-wrap break-all font-mono text-[11.5px]">
                  {msg.message}
                </div>
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
