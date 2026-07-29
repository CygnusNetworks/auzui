import { useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { rangeFromPreset } from "@auzui/timeseries";
import { LogRows } from "../../components/LogRows";
import { RangePicker, type RangeValue } from "../../components/RangePicker";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { useLogsEnabled, useLogSource } from "../../lib/use-logs";
import { buildLevelQuery, messagesHaveLevelField, LOG_LEVEL_CHIPS } from "../../lib/log-level";
import { validateLogsSearch } from "./search-params";
import { useLogSearch, useLogStreams } from "./use-logs-page";

const DEBOUNCE_MS = 400;

/**
 * Graylog Stream-Browser (PLAN.md Abschnitt H, /logs) — nur relevant, wenn
 * der Gateway Graylog konfiguriert hat; sonst nur ein Hinweis, der Rest der
 * App bleibt unberührt (useLogsEnabled ist dieselbe Feature-Gate-Abfrage wie
 * im Host-Detail-Panel).
 */
export function LogsPage() {
  const { data: logsEnabled, isLoading: statusLoading } = useLogsEnabled();

  if (statusLoading) {
    return <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pt-4.5 text-sm text-ink-2">Lade…</div>;
  }
  if (!logsEnabled) {
    return (
      <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pb-16 pt-4.5">
        <h1 className="mb-3 text-[19px] font-bold tracking-tight">Logs</h1>
        <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">
          Graylog nicht konfiguriert.
        </div>
      </div>
    );
  }
  return <LogsBrowser />;
}

function LogsBrowser() {
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateLogsSearch(rawSearch);
  const navigate = useNavigate();

  const source = useLogSource();
  const streamsQuery = useLogStreams(source);
  const streams = streamsQuery.data ?? [];

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const [range, setRange] = useState<RangeValue>(() => rangeFromPreset("1h"));
  const [live, setLive] = useState(true);
  const [maxLevel, setMaxLevel] = useState<number | undefined>(undefined);

  const effectiveQuery = useMemo(() => buildLevelQuery(debouncedQuery, maxLevel), [debouncedQuery, maxLevel]);

  const resultQuery = useLogSearch(source, { streamId: search.stream, query: effectiveQuery, range });
  const messages = resultQuery.data?.messages ?? [];
  const showLevelChips = messagesHaveLevelField(messages) || maxLevel !== undefined;

  function selectStream(streamId: string | undefined) {
    void navigate({ to: "/logs", search: { stream: streamId } });
  }

  return (
    <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pb-16 pt-4.5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">Logs</h1>
        <span className="text-[13px] text-ink-2">Graylog Stream-Browser</span>
      </div>

      <div className="grid grid-cols-[260px_1fr] items-start gap-3.5 max-[980px]:grid-cols-1">
        <aside className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line-soft px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
            Streams
          </div>
          <button
            type="button"
            onClick={() => selectStream(undefined)}
            className={`block w-full border-b border-line-soft px-3.5 py-2 text-left text-[12.5px] hover:bg-surface-2 ${
              !search.stream ? "bg-surface-2 font-semibold text-ink" : "text-ink-2"
            }`}
          >
            Alle Streams
          </button>
          {streamsQuery.isLoading ? (
            <div className="p-3.5 text-sm text-ink-2">Lade Streams…</div>
          ) : streams.length === 0 ? (
            <div className="p-3.5 text-sm text-ink-2">Keine Streams verfügbar.</div>
          ) : (
            streams.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => selectStream(s.id)}
                disabled={s.disabled}
                className={`block w-full border-b border-line-soft px-3.5 py-2 text-left last:border-b-0 hover:bg-surface-2 disabled:opacity-40 ${
                  search.stream === s.id ? "bg-surface-2 font-semibold text-ink" : "text-ink-2"
                }`}
              >
                <div className="flex items-center gap-1.5 truncate text-[12.5px]">
                  {s.title}
                  {s.isDefault && (
                    <span className="rounded bg-surface-3 px-1 font-mono text-[9.5px] text-ink-muted">default</span>
                  )}
                </div>
                {s.description && (
                  <div className="truncate font-mono text-[10.5px] text-ink-muted">{s.description}</div>
                )}
              </button>
            ))
          )}
        </aside>

        <div>
          <div className="mb-3 flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='source:"host" AND level:<=3'
                className="min-w-[260px] flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-ink"
              />
              <RangePicker value={range} onChange={setRange} live={live} onLiveChange={setLive} />
            </div>
            {showLevelChips && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10.5px] text-ink-muted">Level:</span>
                {LOG_LEVEL_CHIPS.map((chip) => (
                  <button
                    key={chip.maxLevel}
                    type="button"
                    onClick={() => setMaxLevel(maxLevel === chip.maxLevel ? undefined : chip.maxLevel)}
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10.5px] ${
                      maxLevel === chip.maxLevel
                        ? "border-accent/40 bg-accent-soft text-accent"
                        : "border-line text-ink-muted"
                    }`}
                  >
                    ≤{chip.maxLevel} {chip.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-line bg-surface">
            {resultQuery.isLoading ? (
              <div className="p-4 text-sm text-ink-2">Lade Logs…</div>
            ) : resultQuery.isError ? (
              <div className="p-4 text-sm text-sev-warn">Logs konnten nicht geladen werden.</div>
            ) : messages.length === 0 ? (
              <div className="p-4 text-sm text-ink-2">Keine Logs im Zeitraum.</div>
            ) : (
              <>
                <div className="border-b border-line-soft px-3.5 py-1.5 font-mono text-[10.5px] text-ink-muted">
                  {resultQuery.data?.total ?? messages.length} Treffer
                </div>
                <LogRows messages={messages} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
