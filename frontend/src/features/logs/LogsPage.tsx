import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { LogFilterField } from "@auzui/logs";
import { rangeFromPreset } from "@auzui/timeseries";
import { LogRows } from "../../components/LogRows";
import { RangePicker, type RangeValue } from "../../components/RangePicker";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { useLogsEnabled, useLogSource } from "../../lib/use-logs";
import { buildLevelQuery, LOG_LEVEL_CHIPS } from "../../lib/log-level";
import {
  activeFilterMode,
  toggleFilter,
  type LogFilterMode,
  type LogFilterState,
} from "../../lib/log-filters";
import {
  clearLogFilters,
  hasStoredValues,
  readLogFilters,
  writeLogFilters,
} from "../../lib/log-filter-storage";
import { useAuthStore, zabbixApi } from "../../lib/auth/store";
import { filtersFromSearch, filtersToSearchValue, validateLogsSearch } from "./search-params";
import { useLogSearch, useLogStreams } from "./use-logs-page";
import { useT } from "../../lib/i18n";

const DEBOUNCE_MS = 400;

/** Parses the ?host= URL param ("web01,web02") into a list of host technical names. */
function parseHostParam(host: string | undefined): string[] {
  return host
    ? host
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean)
    : [];
}

/** `source:"web01" OR source:"web02"`, parenthesized when combined with the rest of the query. */
function buildHostQuery(hostNames: string[]): string {
  if (hostNames.length === 0) return "";
  const clause = hostNames.map((h) => `source:"${h}"`).join(" OR ");
  return hostNames.length > 1 ? `(${clause})` : clause;
}

/** AND-combines two already-complete query fragments, skipping empty ones. */
function combineQueries(...parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.includes(" OR ") ? `(${p})` : p))
    .join(" AND ");
}

/**
 * Graylog Stream-Browser (PLAN.md Abschnitt H, /logs) — nur relevant, wenn
 * der Gateway Graylog konfiguriert hat; sonst nur ein Hinweis, der Rest der
 * App bleibt unberührt (useLogsEnabled ist dieselbe Feature-Gate-Abfrage wie
 * im Host-Detail-Panel).
 */
export function LogsPage() {
  const t = useT();
  const { data: logsEnabled, isLoading: statusLoading } = useLogsEnabled();

  if (statusLoading) {
    return (
      <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pt-4.5 text-sm text-ink-2">
        {t("logs.loading")}
      </div>
    );
  }
  if (!logsEnabled) {
    return (
      <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pb-16 pt-4.5">
        <h1 className="mb-3 text-[19px] font-bold tracking-tight">{t("logs.title")}</h1>
        <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">
          {t("logs.notConfigured")}
        </div>
      </div>
    );
  }
  return <LogsBrowser />;
}

function LogsBrowser() {
  const t = useT();
  const fieldLabels: Record<LogFilterField, string> = {
    source: t("logs.fieldLabels.source"),
    facility: t("logs.fieldLabels.facility"),
    application_name: t("logs.fieldLabels.application_name"),
  };
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
  const [hostQuery, setHostQuery] = useState("");
  const [hostFocused, setHostFocused] = useState(false);

  const username = useAuthStore((s) => s.username);

  const selectedHosts = useMemo(() => parseHostParam(search.host), [search.host]);
  const includeFilters = useMemo(() => filtersFromSearch(search.include), [search.include]);
  const excludeFilters = useMemo(() => filtersFromSearch(search.exclude), [search.exclude]);

  /**
   * Einheitlicher Filterzustand für toggleFilter: Ein Include auf `source`
   * lebt in der bestehenden Host-Chip-Liste (?host=), nicht in ?include= —
   * hier wieder zusammengeführt, damit gegenseitige Exklusivität (ein
   * Host-Include und ein Host-Exclude schließen sich aus) und die aktive
   * Markierung in der Zeile über EINE reine Funktion laufen.
   */
  const filterState = useMemo<LogFilterState>(
    () => ({
      include: [...selectedHosts.map((h) => ({ field: "source" as const, value: h })), ...includeFilters],
      exclude: excludeFilters,
    }),
    [selectedHosts, includeFilters, excludeFilters],
  );

  const activeModeFor = useCallback(
    (field: LogFilterField, value: string) => activeFilterMode(filterState, field, value),
    [filterState],
  );

  // Per-User-Persistenz (PLAN Aufgabe 3): gespeicherte Filter beim ersten
  // Öffnen ohne URL-Params anwenden (URL hat Vorrang); danach jede Änderung
  // zurückschreiben. `hydrated` verhindert, dass der Schreib-Effekt vor der
  // Anwendung feuert; ein evtl. leerer Zwischenstand wird durch das folgende
  // Navigate sofort mit den echten Werten überschrieben.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (username && !search.include && !search.exclude && !search.host && !search.stream) {
      const stored = readLogFilters(username);
      if (stored && hasStoredValues(stored)) {
        void navigate({ to: "/logs", search: { ...stored }, replace: true });
      }
    }
    setHydrated(true);
    // Nur einmal beim Mount: gespeicherte Filter anwenden, dann persistieren.
  }, []);
  useEffect(() => {
    if (!hydrated || !username) return;
    writeLogFilters(username, {
      stream: search.stream,
      host: search.host,
      include: search.include,
      exclude: search.exclude,
    });
  }, [hydrated, username, search.stream, search.host, search.include, search.exclude]);

  // Beim ersten Laden ohne ?stream= den is_default-Stream vorauswählen, statt
  // stillschweigend "alle Streams" zu durchsuchen (Nutzerbeschwerde: Default
  // sollte ein Stream sein).
  useEffect(() => {
    if (search.stream === undefined && streams.length > 0) {
      const defaultStream = streams.find((s) => s.isDefault && !s.disabled);
      if (defaultStream) {
        void navigate({
          to: "/logs",
          search: { stream: defaultStream.id, host: search.host },
          replace: true,
        });
      }
    }
  }, [search.stream, search.host, streams, navigate]);

  const allHostsQuery = useQuery({
    queryKey: ["all-hosts"],
    queryFn: () => zabbixApi.hostGet({ output: ["hostid", "host", "name"], sortfield: "name" }),
    staleTime: 5 * 60_000,
  });
  const hostOptions = useMemo(
    () =>
      (allHostsQuery.data ?? [])
        .filter((h) => !selectedHosts.includes(h.host))
        .filter((h) => {
          const q = hostQuery.trim().toLowerCase();
          return q ? h.host.toLowerCase().includes(q) || h.name.toLowerCase().includes(q) : true;
        })
        .slice(0, 8),
    [allHostsQuery.data, hostQuery, selectedHosts],
  );

  function setHosts(hosts: string[]) {
    const host = hosts.length > 0 ? hosts.join(",") : undefined;
    void navigate({ to: "/logs", search: { ...search, host } });
  }

  /**
   * Setzt/entfernt einen Filter über die reine Funktion `toggleFilter`
   * (gegenseitige Exklusivität + Toggle-off, PLAN Aufgabe 2). Danach wird der
   * neue Zustand wieder in die URL zerlegt: Source-Includes in `?host=` (damit
   * die bestehende Host-Auswahl nicht dupliziert wird), alles andere in
   * `?include=`/`?exclude=`. Auch das Entfernen eines Filter-Chips läuft
   * hierüber (erneuter Klick auf den aktiven Modus = entfernen).
   */
  function handleFilter(field: LogFilterField, value: string, mode: LogFilterMode) {
    const next = toggleFilter(filterState, field, value, mode);
    const hostSources = next.include.filter((f) => f.field === "source").map((f) => f.value);
    const genericInclude = next.include.filter((f) => f.field !== "source");
    void navigate({
      to: "/logs",
      search: {
        ...search,
        host: hostSources.length > 0 ? hostSources.join(",") : undefined,
        include: filtersToSearchValue(genericInclude),
        exclude: filtersToSearchValue(next.exclude),
      },
    });
  }

  function resetFilters() {
    if (username) clearLogFilters(username);
    void navigate({ to: "/logs", search: { stream: search.stream }, replace: true });
  }

  // Level-Chips sind ein Standard-Syslog-Feld und müssen immer wählbar sein —
  // nicht nur, wenn das Feld zufällig schon in den aktuellen Ergebnissen
  // auftaucht (das war der Grund, warum die Chips teils "verschwanden").
  const hostClause = useMemo(() => buildHostQuery(selectedHosts), [selectedHosts]);
  const effectiveQuery = useMemo(
    () => combineQueries(buildLevelQuery(debouncedQuery, maxLevel), hostClause),
    [debouncedQuery, maxLevel, hostClause],
  );

  const resultQuery = useLogSearch(source, {
    streamId: search.stream,
    query: effectiveQuery,
    range,
    include: includeFilters,
    exclude: excludeFilters,
  });
  const messages = resultQuery.data?.pages.flatMap((p) => p.messages) ?? [];
  const total = resultQuery.data?.pages[0]?.total;

  function selectStream(streamId: string | undefined) {
    void navigate({ to: "/logs", search: { ...search, stream: streamId } });
  }

  const hasActiveFilters =
    includeFilters.length > 0 || excludeFilters.length > 0 || selectedHosts.length > 0;

  return (
    <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pb-16 pt-4.5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">{t("logs.title")}</h1>
        <span className="text-[13px] text-ink-2">{t("logs.subtitle")}</span>
      </div>

      <div className="grid grid-cols-[260px_1fr] items-start gap-3.5 max-[980px]:grid-cols-1">
        <aside className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line-soft px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
            {t("logs.streams")}
          </div>
          <button
            type="button"
            onClick={() => selectStream(undefined)}
            className={`block w-full border-b border-line-soft px-3.5 py-2 text-left text-[12.5px] hover:bg-surface-2 ${
              !search.stream ? "bg-surface-2 font-semibold text-ink" : "text-ink-2"
            }`}
          >
            {t("logs.allStreams")}
          </button>
          {streamsQuery.isLoading ? (
            <div className="p-3.5 text-sm text-ink-2">{t("logs.loadingStreams")}</div>
          ) : streams.length === 0 ? (
            <div className="p-3.5 text-sm text-ink-2">{t("logs.noStreams")}</div>
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
                placeholder='level:<=3'
                className="min-w-[260px] flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-ink"
              />
              <RangePicker value={range} onChange={setRange} live={live} onLiveChange={setLive} />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10.5px] text-ink-muted">{t("logs.hostsLabel")}</span>
              {selectedHosts.map((h) => (
                <span
                  key={h}
                  className="inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2"
                >
                  {h}
                  <button
                    type="button"
                    onClick={() => setHosts(selectedHosts.filter((x) => x !== h))}
                    className="text-ink-muted"
                    aria-label={t("logs.removeHost", h)}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <div className="relative">
                <input
                  type="text"
                  value={hostQuery}
                  onChange={(e) => setHostQuery(e.target.value)}
                  onFocus={() => setHostFocused(true)}
                  onBlur={() => setHostFocused(false)}
                  placeholder={t("logs.addHostPlaceholder")}
                  className="w-40 rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10.5px] text-ink"
                />
                {hostFocused && hostOptions.length > 0 && (
                  <ul className="absolute z-10 mt-1 max-h-48 w-56 overflow-y-auto rounded-md border border-line bg-surface shadow-md">
                    {hostOptions.map((h) => (
                      <li key={h.hostid}>
                        <button
                          type="button"
                          onMouseDown={() => {
                            setHosts([...selectedHosts, h.host]);
                            setHostQuery("");
                          }}
                          className="block w-full px-2.5 py-1.5 text-left text-[12px] text-ink hover:bg-surface-2"
                        >
                          {h.name || h.host}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10.5px] text-ink-muted">{t("logs.levelLabel")}</span>
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

            {hasActiveFilters && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10.5px] text-ink-muted">{t("logs.filterLabel")}</span>
                {includeFilters.map((f) => (
                  <span
                    key={`inc-${f.field}-${f.value}`}
                    title={t("logs.include", f.value)}
                    className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10.5px] text-accent"
                  >
                    <span aria-hidden>＋</span>
                    {fieldLabels[f.field]}: {f.value}
                    <button
                      type="button"
                      onClick={() => handleFilter(f.field, f.value, "include")}
                      aria-label={t("logs.removeFilter", f.value)}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {excludeFilters.map((f) => (
                  <span
                    key={`exc-${f.field}-${f.value}`}
                    title={t("logs.exclude", f.value)}
                    className="inline-flex items-center gap-1 rounded bg-sev-high/15 px-1.5 py-0.5 font-mono text-[10.5px] text-sev-high"
                  >
                    <span aria-hidden>－</span>
                    {t("logs.not")} {fieldLabels[f.field]}: {f.value}
                    <button
                      type="button"
                      onClick={() => handleFilter(f.field, f.value, "exclude")}
                      aria-label={t("logs.removeFilter", f.value)}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={resetFilters}
                  className="ml-auto rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-ink-muted hover:bg-surface-2 hover:text-ink"
                >
                  {t("logs.resetFilters")}
                </button>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-line bg-surface">
            {resultQuery.isLoading ? (
              <div className="p-4 text-sm text-ink-2">{t("logs.loadingLogs")}</div>
            ) : resultQuery.isError ? (
              <div className="p-4 text-sm text-sev-high">
                {t(
                  "logs.loadError",
                  resultQuery.error instanceof Error ? resultQuery.error.message : t("logs.unknownError"),
                )}
              </div>
            ) : messages.length === 0 ? (
              <div className="p-4 text-sm text-ink-2">{t("logs.noResults")}</div>
            ) : (
              <>
                <div className="border-b border-line-soft px-3.5 py-1.5 font-mono text-[10.5px] text-ink-muted">
                  {t("logs.hits", total ?? messages.length)}
                </div>
                <LogRows messages={messages} onFilter={handleFilter} activeModeFor={activeModeFor} />
                {resultQuery.hasNextPage && (
                  <div className="border-t border-line-soft p-2 text-center">
                    <button
                      type="button"
                      onClick={() => void resultQuery.fetchNextPage()}
                      disabled={resultQuery.isFetchingNextPage}
                      className="rounded-md border border-line px-3 py-1 font-mono text-[11px] text-ink-2 hover:bg-surface-2 disabled:opacity-50"
                    >
                      {resultQuery.isFetchingNextPage
                        ? t("logs.loadingMore")
                        : t("logs.loadMore", messages.length, total)}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
