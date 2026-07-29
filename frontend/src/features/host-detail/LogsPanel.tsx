import { useState } from "react";
import type { LogSource } from "@auzui/logs";
import { LogRows } from "../../components/LogRows";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { useHostLogs } from "./use-host-logs";

const DEBOUNCE_MS = 400;

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
        <LogRows messages={data.messages} />
      )}
    </div>
  );
}
