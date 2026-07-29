import { useEffect, useState } from "react";
import type { LogSource } from "@auzui/logs";
import { useHostLogs } from "./use-host-logs";

const DEBOUNCE_MS = 400;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const timeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * "Logs"-Sektion des Host Deep-Dive (PLAN.md Abschnitt H / M4-Teil). Range ist
 * an die globale Chart-Range der Seite gekoppelt — ein Brush in irgendeinem
 * Chart refetcht auch die Logs. Nur gerendert, wenn /api/logs/status enabled
 * ist (HostDetailPage prüft das über useLogsEnabled).
 */
export function LogsPanel({
  source,
  hostId,
  range,
}: {
  source: LogSource;
  hostId: string;
  range: { from: number; to: number };
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const [expanded, setExpanded] = useState<number | undefined>(undefined);

  const { data, isLoading, isError } = useHostLogs(source, hostId, range, debouncedQuery);

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">logs · graylog</span>
        <span className="text-sm font-semibold">Logs</span>
        {data?.matchedSources && data.matchedSources.length > 0 && (
          <span className="text-[11.5px] text-ink-muted">
            matched: {data.matchedSources.map((s, i) => (
              <span key={s}>
                {i > 0 && ", "}
                <b className="font-mono text-ink-2">{s}</b>
              </span>
            ))}
          </span>
        )}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Freitext filtern…"
          className="ml-auto min-w-[180px] rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink"
        />
      </div>

      {isLoading ? (
        <div className="p-4 text-sm text-ink-2">Lade Logs…</div>
      ) : isError ? (
        <div className="p-4 text-sm text-sev-warn">Logs konnten nicht geladen werden.</div>
      ) : !data || data.messages.length === 0 ? (
        <div className="p-4 text-sm text-ink-2">
          {data?.matchedSources && data.matchedSources.length === 0
            ? "keine Log-Quelle gefunden"
            : "keine Logs im Zeitraum"}
        </div>
      ) : (
        <div className="divide-y divide-line-soft">
          {data.messages.map((msg, i) => {
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
      )}
    </div>
  );
}
