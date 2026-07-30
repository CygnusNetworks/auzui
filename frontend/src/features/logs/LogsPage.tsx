import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { LogFilterField, LogFilterSet } from "@auzui/logs";
import { rangeFromPreset } from "@auzui/timeseries";
import { LogRows } from "../../components/LogRows";
import { RangePicker, type RangeValue } from "../../components/RangePicker";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { useLogsEnabled, useLogServers, useLogSource } from "../../lib/use-logs";
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
import { isStreamSort, sortLogStreams, STREAM_SORTS, type StreamSort } from "../../lib/log-streams";
import { useAuthStore, zabbixApi } from "../../lib/auth/store";
import {
  filtersFromSearch,
  filtersToSearchValue,
  parseServersParam,
  validateLogsSearch,
  type LogsSearch,
} from "./search-params";
import { useFilterSets, useLogSearch, useLogStreams, PAGE_SIZE } from "./use-logs-page";
import { FilterSetControls } from "./FilterSetControls";
import { Pager } from "./Pager";
import { currentFromSearch, payloadToSearch } from "./filter-set-mapping";
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
 * Graylog Stream-Browser mit Werkzeugleiste (freigegebenes Design) — nur
 * relevant, wenn der Gateway Graylog konfiguriert hat; sonst nur ein Hinweis.
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
  const serversQuery = useLogServers(source);
  const allServers = useMemo(() => serversQuery.data?.servers ?? [], [serversQuery.data]);
  const multiServer = allServers.length > 1;
  // Dedup toggle only exists when the server-side feature flag is on AND there
  // is more than one server to deduplicate across.
  const dedupConfigured = (serversQuery.data?.dedupEnabled ?? false) && multiServer;

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const [range, setRange] = useState<RangeValue>(() => rangeFromPreset("1h"));
  const [live, setLive] = useState(true);
  const [maxLevel, setMaxLevel] = useState<number | undefined>(undefined);
  const [hostQuery, setHostQuery] = useState("");
  const [hostFocused, setHostFocused] = useState(false);
  // Stream-Picker-Sortierung: rein clientseitig, per-User in localStorage
  // gemerkt (kein URL-Param). Default "name".
  const [streamSort, setStreamSort] = useState<StreamSort>("name");
  const sortedStreams = useMemo(() => sortLogStreams(streams, streamSort), [streams, streamSort]);

  const username = useAuthStore((s) => s.username);

  const page = search.page ?? 1;
  const selectedHosts = useMemo(() => parseHostParam(search.host), [search.host]);
  const includeFilters = useMemo(() => filtersFromSearch(search.include), [search.include]);
  const excludeFilters = useMemo(() => filtersFromSearch(search.exclude), [search.exclude]);
  const selectedServerIds = useMemo(() => parseServersParam(search.servers), [search.servers]);
  // Empty selection = all servers.
  const effectiveServerIds = useMemo(
    () => (selectedServerIds.length > 0 ? selectedServerIds : allServers.map((s) => s.id)),
    [selectedServerIds, allServers],
  );

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

  // Per-User-Persistenz: gespeicherte Filter beim ersten Öffnen ohne
  // URL-Params anwenden (URL hat Vorrang); danach jede Änderung zurückschreiben.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (
      username &&
      !search.include &&
      !search.exclude &&
      !search.host &&
      !search.stream &&
      !search.servers &&
      !search.dedupe
    ) {
      const stored = readLogFilters(username);
      if (stored && hasStoredValues(stored)) {
        // streamSort ist kein URL-Param → nicht in die Router-Suche übernehmen.
        void navigate({
          to: "/logs",
          search: {
            stream: stored.stream,
            host: stored.host,
            include: stored.include,
            exclude: stored.exclude,
            servers: stored.servers,
            dedupe: stored.dedupe,
            size: stored.size,
          },
          replace: true,
        });
      }
    }
    // streamSort ist kein URL-Param → immer direkt aus dem Speicher übernehmen.
    if (username) {
      const stored = readLogFilters(username);
      if (stored && isStreamSort(stored.streamSort)) setStreamSort(stored.streamSort);
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated || !username) return;
    writeLogFilters(username, {
      stream: search.stream,
      host: search.host,
      include: search.include,
      exclude: search.exclude,
      servers: search.servers,
      dedupe: search.dedupe,
      streamSort,
      size: search.size,
    });
  }, [
    hydrated,
    username,
    search.stream,
    search.host,
    search.include,
    search.exclude,
    search.servers,
    search.dedupe,
    streamSort,
    search.size,
  ]);

  // Beim ersten Laden ohne ?stream= den is_default-Stream vorauswählen.
  useEffect(() => {
    if (search.stream === undefined && streams.length > 0) {
      const defaultStream = streams.find((s) => s.isDefault && !s.disabled);
      if (defaultStream) {
        void navigate({
          to: "/logs",
          search: { ...search, stream: defaultStream.id },
          replace: true,
        });
      }
    }
  }, [search.stream, streams]);

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

  /** Navigate merging a patch; resets to page 1 unless keepPage is set. */
  const patchSearch = useCallback(
    (patch: Partial<LogsSearch>, opts?: { keepPage?: boolean; replace?: boolean }) => {
      void navigate({
        to: "/logs",
        search: { ...search, ...patch, page: opts?.keepPage ? search.page : undefined },
        replace: opts?.replace,
      });
    },
    [navigate, search],
  );

  // Freitext-Query oder Level ändert die Trefferzahl → zurück auf Seite 1.
  const prevKey = useRef<string>(`${debouncedQuery}|${maxLevel}`);
  useEffect(() => {
    const key = `${debouncedQuery}|${maxLevel}`;
    if (key !== prevKey.current && (search.page ?? 1) > 1) {
      patchSearch({});
    }
    prevKey.current = key;
  }, [debouncedQuery, maxLevel]);

  function setHosts(hosts: string[]) {
    patchSearch({ host: hosts.length > 0 ? hosts.join(",") : undefined });
  }

  function handleFilter(field: LogFilterField, value: string, mode: LogFilterMode) {
    const next = toggleFilter(filterState, field, value, mode);
    const hostSources = next.include.filter((f) => f.field === "source").map((f) => f.value);
    const genericInclude = next.include.filter((f) => f.field !== "source");
    patchSearch({
      host: hostSources.length > 0 ? hostSources.join(",") : undefined,
      include: filtersToSearchValue(genericInclude),
      exclude: filtersToSearchValue(next.exclude),
    });
  }

  function resetFilters() {
    if (username) clearLogFilters(username);
    void navigate({ to: "/logs", search: { stream: search.stream }, replace: true });
    setMaxLevel(undefined);
    setQuery("");
  }

  function selectStream(streamId: string | undefined) {
    patchSearch({ stream: streamId });
  }

  function toggleServer(id: string) {
    const current = new Set(effectiveServerIds);
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    if (current.size === 0) return; // keep at least one server selected
    const next = allServers.map((s) => s.id).filter((sid) => current.has(sid));
    // All selected → drop the param (means "all").
    patchSearch({ servers: next.length === allServers.length ? undefined : next.join(",") });
  }

  function applySet(set: LogFilterSet) {
    const { search: applied, level } = payloadToSearch(set.filters);
    setMaxLevel(level);
    void navigate({ to: "/logs", search: { ...applied, set: set.id } });
  }

  const hostClause = useMemo(() => buildHostQuery(selectedHosts), [selectedHosts]);
  const effectiveQuery = useMemo(
    () => combineQueries(buildLevelQuery(debouncedQuery, maxLevel), hostClause),
    [debouncedQuery, maxLevel, hostClause],
  );

  // Duplikate zusammenfassen: standardmäßig an; nur „aus" wird als ?dedupe=0
  // persistiert. Wirkt nur bei >1 Server (Gateway ignoriert es sonst).
  const dedupeEnabled = search.dedupe !== "0";

  const resultQuery = useLogSearch(source, {
    streamId: search.stream,
    servers: selectedServerIds,
    query: effectiveQuery,
    range,
    include: includeFilters,
    exclude: excludeFilters,
    page,
    live,
    dedupe: dedupeEnabled,
    pageSize: search.size,
  });
  const messages = resultQuery.data?.messages ?? [];
  const total = resultQuery.data?.total ?? 0;
  const partialErrors = resultQuery.data?.errors ?? [];

  const filterSetsQuery = useFilterSets(source);
  const currentFilters = useMemo(
    () => currentFromSearch(search, maxLevel),
    [search, maxLevel],
  );

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
          <div className="flex items-center gap-2 border-b border-line-soft px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
            {t("logs.streams")}
            {multiServer && (
              <div className="ml-auto flex items-center gap-1 normal-case">
                <span className="text-ink-muted">{t("logs.streamSortLabel")}</span>
                <div className="flex overflow-hidden rounded border border-line">
                  {STREAM_SORTS.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setStreamSort(mode)}
                      aria-pressed={streamSort === mode}
                      className={`px-1.5 py-0.5 text-[10px] ${
                        streamSort === mode
                          ? "bg-accent-soft text-accent"
                          : "text-ink-muted hover:bg-surface-2"
                      }`}
                    >
                      {t(`logs.streamSort.${mode}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
            sortedStreams.map((s) => (
              <button
                key={`${s.serverId ?? ""}:${s.id}`}
                type="button"
                onClick={() => selectStream(s.id)}
                disabled={s.disabled}
                className={`block w-full border-b border-line-soft px-3.5 py-2 text-left last:border-b-0 hover:bg-surface-2 disabled:opacity-40 ${
                  search.stream === s.id ? "bg-surface-2 font-semibold text-ink" : "text-ink-2"
                }`}
              >
                <div className="flex items-center gap-1.5 truncate text-[12.5px]">
                  {s.title}
                  {multiServer && s.serverLabel && (
                    <span className="rounded bg-accent-soft px-1 font-mono text-[9.5px] text-accent">
                      {s.serverLabel}
                    </span>
                  )}
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
            {/* Werkzeugleiste: Filter-Set-Dropdown + Query + Range */}
            <div className="flex flex-wrap items-center gap-2">
              <FilterSetControls
                source={source}
                filterSets={filterSetsQuery.data ?? []}
                activeSetId={search.set}
                current={currentFilters}
                username={username}
                onApply={applySet}
                onClearActive={() => patchSearch({ set: undefined }, { keepPage: true })}
                onActivate={(id) => patchSearch({ set: id }, { keepPage: true })}
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="level:<=3"
                className="min-w-[220px] flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-ink"
              />
              <RangePicker
                value={range}
                onChange={setRange}
                live={live && page === 1}
                onLiveChange={setLive}
              />
            </div>

            {multiServer && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10.5px] text-ink-muted">{t("logs.serversLabel")}</span>
                {allServers.map((srv) => {
                  const on = effectiveServerIds.includes(srv.id);
                  return (
                    <button
                      key={srv.id}
                      type="button"
                      onClick={() => toggleServer(srv.id)}
                      aria-pressed={on}
                      className={`rounded-full border px-2 py-0.5 font-mono text-[10.5px] ${
                        on ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-ink-muted"
                      }`}
                    >
                      {srv.label} {on ? "✓" : ""}
                    </button>
                  );
                })}
                {dedupConfigured && (
                  <button
                    type="button"
                    onClick={() =>
                      patchSearch(
                        { dedupe: dedupeEnabled ? "0" : undefined },
                        { keepPage: true },
                      )
                    }
                    aria-pressed={dedupeEnabled}
                    title={t("logs.dedupeToggleHint")}
                    className={`ml-auto rounded-full border px-2 py-0.5 font-mono text-[10.5px] ${
                      dedupeEnabled
                        ? "border-accent/40 bg-accent-soft text-accent"
                        : "border-line text-ink-muted"
                    }`}
                  >
                    {t("logs.dedupeToggle")} {dedupeEnabled ? "✓" : ""}
                  </button>
                )}
              </div>
            )}

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
              <>
                <Pager
                  total={total}
                  page={page}
                  pageSize={search.size ?? PAGE_SIZE}
                  live={live}
                  onPage={(p) => void navigate({ to: "/logs", search: { ...search, page: p === 1 ? undefined : p } })}
                  onPageSize={(n) =>
                    void navigate({
                      to: "/logs",
                      search: { ...search, size: n === PAGE_SIZE ? undefined : n, page: undefined },
                    })
                  }
                />
                <div className="p-4 text-sm text-ink-2">{t("logs.noResults")}</div>
              </>
            ) : (
              <>
                <Pager
                  total={total}
                  page={page}
                  pageSize={search.size ?? PAGE_SIZE}
                  live={live}
                  onPage={(p) => void navigate({ to: "/logs", search: { ...search, page: p === 1 ? undefined : p } })}
                  onPageSize={(n) =>
                    void navigate({
                      to: "/logs",
                      search: { ...search, size: n === PAGE_SIZE ? undefined : n, page: undefined },
                    })
                  }
                />
                {partialErrors.length > 0 && (
                  <div className="border-b border-line-soft bg-sev-warn/10 px-3.5 py-1 font-mono text-[10.5px] text-sev-warn">
                    {t("logs.partialErrors", partialErrors.length)}
                  </div>
                )}
                <LogRows
                  messages={messages}
                  onFilter={handleFilter}
                  activeModeFor={activeModeFor}
                  showServer={multiServer}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
