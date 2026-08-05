import { useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { DockerContainer, DockerSearchType, DockerUpdateInfo, DockerUpdatesMap } from "@auzui/docker";
import {
  containerBadgeTone,
  formatPorts,
  groupContainersByStack,
  sortContainersByState,
  UNGROUPED_STACK,
} from "../../lib/docker";
import { useDockerEnabled, useDockerHosts, useDockerPermissions, useDockerSource } from "../../lib/use-docker";
import { useT } from "../../lib/i18n";
import { ActionButtons } from "./ActionButtons";
import { ContainerDetailPanel, DOT_TONE_CLASS } from "./ContainerDetailPanel";
import { StackPanel } from "./StackPanel";
import {
  useDockerBulkStats,
  useDockerContainers,
  useDockerSearch,
  useDockerUpdates,
} from "./use-docker-page";
import {
  decodeSelection,
  DOCKER_SEARCH_TYPES,
  encodeContainerSelection,
  encodeStackSelection,
  hostsToSearchValue,
  parseHostsParam,
  parseStateParam,
  stateToSearchValue,
  validateDockerSearch,
  type DockerDetailTab,
  type DockerSearch,
  type DockerSearchTypeParam,
} from "./search-params";

/** State/health/update chips offered above the lanes — a mix of raw Docker
 * container states and two derived pseudo-states (unhealthy, outdated) so
 * the whole triage vocabulary lives in one row (plan: "State-Filter-Chips
 * (running/exited/unhealthy/paused/…); Update-Badge-Filter"). */
const STATE_CHIPS = [
  "running",
  "restarting",
  "paused",
  "exited",
  "dead",
  "unhealthy",
  "outdated",
] as const;

function containerMatchesChips(
  container: DockerContainer,
  updateInfo: DockerUpdateInfo | undefined,
  chips: ReadonlySet<string>,
): boolean {
  if (chips.size === 0) return true;
  for (const chip of chips) {
    if (chip === "unhealthy") {
      if (container.health === "unhealthy") return true;
    } else if (chip === "outdated") {
      if (updateInfo?.status === "outdated") return true;
    } else if (container.state === chip) {
      return true;
    }
  }
  return false;
}

function containerMatchesQuery(container: DockerContainer, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    container.name.toLowerCase().includes(needle) ||
    container.image.toLowerCase().includes(needle) ||
    container.project.toLowerCase().includes(needle)
  );
}

function updateFor(updates: DockerUpdatesMap, hostId: string, cid: string): DockerUpdateInfo | undefined {
  return updates[hostId]?.[cid];
}

export function DockerPage() {
  const t = useT();
  const { data: dockerEnabled, isLoading: statusLoading } = useDockerEnabled();

  if (statusLoading) {
    return (
      <div className="mx-auto max-w-[1400px] px-3 pb-16 pt-4.5 min-[700px]:px-5 text-sm text-ink-2">
        {t("docker.loading")}
      </div>
    );
  }
  if (!dockerEnabled) {
    return (
      <div className="mx-auto max-w-[1400px] px-3 pb-16 pt-4.5 min-[700px]:px-5">
        <h1 className="mb-3 text-[19px] font-bold tracking-tight">{t("docker.title")}</h1>
        <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">
          {t("docker.notConfigured")}
        </div>
      </div>
    );
  }
  return <DockerBrowser />;
}

function DockerBrowser() {
  const t = useT();
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateDockerSearch(rawSearch);
  const navigate = useNavigate();

  const source = useDockerSource();
  const hostsQuery = useDockerHosts(source);
  const permissionsQuery = useDockerPermissions(source);
  const canAct = permissionsQuery.data?.canAct ?? false;
  const hosts = hostsQuery.data?.hosts ?? [];

  const hostIds = useMemo(() => parseHostsParam(search.hosts), [search.hosts]);
  const stateChips = useMemo(() => parseStateParam(search.state), [search.state]);
  const searchType: DockerSearchTypeParam = search.type ?? "containers";
  const group = search.group ?? "host";
  const selection = decodeSelection(search.sel);
  const query = search.q ?? "";

  function patchSearch(patch: Partial<DockerSearch>) {
    void navigate({ to: "/docker", search: { ...search, ...patch }, replace: true });
  }

  const containersQuery = useDockerContainers(source, hostIds);
  const updatesQuery = useDockerUpdates(source, hostIds);
  const updates = updatesQuery.data?.updates ?? {};
  const allContainers = containersQuery.data?.containers ?? [];
  const containerErrors = containersQuery.data?.errors ?? [];

  const filteredContainers = useMemo(
    () =>
      allContainers.filter(
        (c) =>
          containerMatchesQuery(c, query) &&
          containerMatchesChips(c, updateFor(updates, c.hostId, c.id), stateChips),
      ),
    [allContainers, query, stateChips, updates],
  );

  // Bulk-stats only for the containers actually visible after filtering —
  // grouped per host, matching the gateway's POST /api/docker/stats shape.
  const bulkStatsTargets = useMemo(() => {
    const targets: Record<string, string[]> = {};
    for (const c of filteredContainers) {
      (targets[c.hostId] ??= []).push(c.id);
    }
    return targets;
  }, [filteredContainers]);
  const bulkStatsQuery = useDockerBulkStats(source, bulkStatsTargets);
  const statsMap = bulkStatsQuery.data?.stats ?? {};

  const crossTypeSearch = useDockerSearch(
    source,
    query,
    searchType === "containers" ? [] : [searchType as DockerSearchType],
    hostIds,
  );

  const selectedContainer = useMemo(() => {
    if (selection?.kind !== "container") return undefined;
    return allContainers.find((c) => c.hostId === selection.hostId && c.id === selection.cid);
  }, [allContainers, selection]);

  function selectContainer(c: DockerContainer) {
    patchSearch({ sel: encodeContainerSelection(c.hostId, c.id), dtab: "info" });
  }
  function selectStack(hostId: string, project: string) {
    patchSearch({ sel: encodeStackSelection(hostId, project) });
  }
  function toggleChip(chip: string) {
    const next = new Set(stateChips);
    if (next.has(chip)) next.delete(chip);
    else next.add(chip);
    patchSearch({ state: stateToSearchValue(next) });
  }
  function toggleHost(hostId: string) {
    const next = new Set(hostIds);
    if (next.has(hostId)) next.delete(hostId);
    else next.add(hostId);
    patchSearch({ hosts: hostsToSearchValue([...next]) });
  }

  const visibleHosts = hostIds.length > 0 ? hosts.filter((h) => hostIds.includes(h.id)) : hosts;

  /** Fan-out error for one host, if the last container query failed for it — feeds its header dot. */
  function errorFor(hostId: string): string | undefined {
    return containerErrors.find((e) => e.hostId === hostId)?.message;
  }
  /**
   * Why actions are blocked on this host, or undefined when they aren't.
   * `canAct` alone is the global Zabbix-role gate; a `readonly: true` host
   * rejects every action server-side (docker_routes.py) whatever the role, so
   * the buttons have to mirror that too.
   */
  function readonlyReasonFor(hostId: string): string | undefined {
    return hosts.find((h) => h.id === hostId)?.readonly ? t("docker.actions.readonlyHost") : undefined;
  }

  return (
    <div className="mx-auto max-w-[1400px] px-3 pb-16 pt-4.5 min-[700px]:px-5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">{t("docker.title")}</h1>
        <span className="text-[13px] text-ink-2">{t("docker.subtitle")}</span>
      </div>

      <div className="grid grid-cols-[1fr_350px] items-start gap-3.5 max-[1100px]:grid-cols-1">
        {/* Toolbar card, then one card per host: the page background between
            the cards is what separates the servers from one another. */}
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
              <div className="flex overflow-hidden rounded-md border border-line">
                {DOCKER_SEARCH_TYPES.map((typ) => (
                  <button
                    key={typ}
                    type="button"
                    onClick={() => patchSearch({ type: typ === "containers" ? undefined : typ })}
                    aria-pressed={searchType === typ}
                    className={`px-2 py-1 font-mono text-[10.5px] ${
                      searchType === typ ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-2"
                    }`}
                  >
                    {t(`docker.searchType.${typ}`)}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => patchSearch({ q: e.target.value || undefined })}
                placeholder={t("docker.searchPlaceholder")}
                className="min-w-[200px] flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink max-[700px]:w-full"
              />
              <div className="flex overflow-hidden rounded-md border border-line">
                <button
                  type="button"
                  onClick={() => patchSearch({ group: undefined })}
                  aria-pressed={group === "host"}
                  className={`px-2.5 py-1 font-mono text-[10.5px] ${
                    group === "host" ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-2"
                  }`}
                >
                  {t("docker.groupByHost")}
                </button>
                <button
                  type="button"
                  onClick={() => patchSearch({ group: "stack" })}
                  aria-pressed={group === "stack"}
                  className={`px-2.5 py-1 font-mono text-[10.5px] ${
                    group === "stack" ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-2"
                  }`}
                >
                  {t("docker.groupByStack")}
                </button>
              </div>
            </div>

            {searchType === "containers" && (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line-soft px-3.5 py-2">
                {STATE_CHIPS.map((chip) => {
                  const on = stateChips.has(chip);
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => toggleChip(chip)}
                      aria-pressed={on}
                      className={`rounded-full border px-2.5 py-1 font-mono text-[10.5px] ${
                        on ? "border-accent/50 bg-accent-soft font-semibold text-accent" : "border-line text-ink-2"
                      }`}
                    >
                      {t(`docker.stateChip.${chip}`)}
                    </button>
                  );
                })}
                {hosts.length > 1 && (
                  <span className="ml-auto flex flex-wrap items-center gap-1">
                    {hosts.map((h) => {
                      const on = hostIds.length === 0 || hostIds.includes(h.id);
                      return (
                        <button
                          key={h.id}
                          type="button"
                          onClick={() => toggleHost(h.id)}
                          aria-pressed={on}
                          className={`rounded-full border px-2 py-0.5 font-mono text-[10.5px] ${
                            on ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-ink-muted"
                          }`}
                        >
                          {h.label}
                        </button>
                      );
                    })}
                  </span>
                )}
              </div>
            )}

            {containerErrors.length > 0 && (
              <div className="bg-sev-warn/10 px-3.5 py-1.5 font-mono text-[10.5px] text-sev-warn">
                {t("docker.partialErrors", containerErrors.length)}
              </div>
            )}
          </div>

          {searchType !== "containers" ? (
            <div className="rounded-lg border border-line bg-surface">
              <CrossTypeResults
                type={searchType}
                isLoading={crossTypeSearch.isLoading}
                hasQuery={query.trim().length > 0}
                results={crossTypeSearch.data}
              />
            </div>
          ) : containersQuery.isLoading ? (
            <div className="rounded-lg border border-line bg-surface p-6 text-sm text-ink-2">
              {t("docker.loading")}
            </div>
          ) : visibleHosts.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-surface px-6 py-16 text-center">
              <div className="text-sm font-semibold">{t("docker.empty")}</div>
            </div>
          ) : (
            visibleHosts.map((host) => (
              <HostLane
                key={host.id}
                host={host}
                containers={filteredContainers.filter((c) => c.hostId === host.id)}
                group={group}
                updates={updates}
                stats={statsMap[host.id] ?? {}}
                canAct={canAct}
                error={errorFor(host.id)}
                source={source}
                selectedId={selection?.kind === "container" ? selection.cid : undefined}
                selectedProject={selection?.kind === "stack" ? selection.project : undefined}
                onSelectContainer={selectContainer}
                onSelectStack={(project) => selectStack(host.id, project)}
              />
            ))
          )}
        </div>

        <aside className="rounded-lg border border-line bg-surface">
          {selection?.kind === "stack" ? (
            <StackPanel
              source={source}
              hostId={selection.hostId}
              project={selection.project}
              canAct={canAct}
              readonlyReason={readonlyReasonFor(selection.hostId)}
            />
          ) : (
            <ContainerDetailPanel
              source={source}
              container={selectedContainer}
              updateInfo={
                selectedContainer ? updateFor(updates, selectedContainer.hostId, selectedContainer.id) : undefined
              }
              zabbixHost={hosts.find((h) => h.id === selectedContainer?.hostId)?.zabbixHost ?? ""}
              canAct={canAct}
              readonlyReason={selectedContainer ? readonlyReasonFor(selectedContainer.hostId) : undefined}
              tab={search.dtab ?? "info"}
              onTabChange={(dtab: DockerDetailTab) => patchSearch({ dtab })}
              // Live is the default; only the opt-out lands in the URL (?live=0).
              live={search.live !== "0"}
              onLiveChange={(live) => patchSearch({ live: live ? undefined : "0" })}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * One Docker host as its own card: a `surface-2` header bar (reachability dot,
 * label, flags, engine version, counts) above that host's containers. Each
 * host being a separate card — instead of all hosts sharing one — is what
 * separates the servers visually; the hairline rule this replaces did that
 * job badly once a host had more than a handful of containers.
 */
function HostLane({
  host,
  containers,
  group,
  updates,
  stats,
  canAct,
  error,
  source,
  selectedId,
  selectedProject,
  onSelectContainer,
  onSelectStack,
}: {
  host: { id: string; label: string; readonly: boolean; compose: boolean; engineVersion: string; containersRunning: number; containersStopped: number };
  containers: DockerContainer[];
  group: "host" | "stack";
  updates: DockerUpdatesMap;
  stats: Record<string, { cpuPct: number; memUsed: number; memLimit: number }>;
  canAct: boolean;
  /** Fan-out error for this host, if any — turns the header dot amber. */
  error: string | undefined;
  source: ReturnType<typeof useDockerSource>;
  selectedId: string | undefined;
  selectedProject: string | undefined;
  onSelectContainer: (c: DockerContainer) => void;
  onSelectStack: (project: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const sorted = sortContainersByState(containers);
  // Readonly is a per-host fact, so it is resolved once here rather than per row.
  const readonlyReason = host.readonly ? t("docker.actions.readonlyHost") : undefined;

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div
        className={`flex flex-wrap items-center gap-2.5 border-line bg-surface-2 px-3 py-2 ${
          open ? "rounded-t-lg border-b" : "rounded-lg"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-[14px] font-mono text-[11px] text-ink-muted"
        >
          {open ? "▾" : "▸"}
        </button>
        <span
          title={error}
          aria-label={error ? t("docker.hostLane.unreachable") : undefined}
          className={`h-[7px] w-[7px] shrink-0 rounded-full ring-3 ${
            error ? "bg-sev-avg ring-sev-avg/20" : "bg-sev-ok ring-sev-ok/20"
          }`}
        />
        <span className="font-mono text-[12.5px] font-semibold tracking-tight">{host.label}</span>
        {host.readonly && (
          <span className="rounded bg-surface-3 px-1.5 font-mono text-[9.5px] uppercase tracking-wider text-ink-muted">
            {t("docker.hostLane.readonly")}
          </span>
        )}
        {host.compose && (
          <span className="rounded bg-surface-3 px-1.5 font-mono text-[9.5px] uppercase tracking-wider text-ink-muted">
            {t("docker.hostLane.compose")}
          </span>
        )}
        {host.engineVersion && (
          <span className="font-mono text-[10.5px] text-ink-muted">
            {t("docker.hostLane.engine", host.engineVersion)}
          </span>
        )}
        <span className="ml-auto font-mono text-[10.5px] text-ink-2">
          {t("docker.hostLane.counts", host.containersRunning, host.containersStopped)}
        </span>
      </div>

      {open && (
        <div className="px-3 pb-1.5 pt-0.5">
          {group === "host" ? (
            <div className="overflow-x-auto">
              {sorted.map((c) => (
                <ContainerRow
                  key={c.id}
                  container={c}
                  updateInfo={updateFor(updates, c.hostId, c.id)}
                  stats={stats[c.id]}
                  selected={selectedId === c.id}
                  canAct={canAct}
                  readonlyReason={readonlyReason}
                  source={source}
                  onSelect={() => onSelectContainer(c)}
                />
              ))}
              {sorted.length === 0 && (
                <div className="py-4 text-center text-[12px] text-ink-muted">{t("docker.hostLane.empty")}</div>
              )}
            </div>
          ) : (
            groupContainersByStack(sorted).map((stackGroup) => (
              <div key={stackGroup.project} className="mb-2">
                <button
                  type="button"
                  onClick={() => stackGroup.project !== UNGROUPED_STACK && onSelectStack(stackGroup.project)}
                  disabled={stackGroup.project === UNGROUPED_STACK}
                  className={`mb-0.5 mt-1.5 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider ${
                    selectedProject === stackGroup.project ? "text-accent" : "text-ink-muted"
                  } ${stackGroup.project === UNGROUPED_STACK ? "" : "hover:text-ink"}`}
                >
                  {stackGroup.project === UNGROUPED_STACK
                    ? t("docker.hostLane.ungrouped")
                    : `📦 ${stackGroup.project}`}
                </button>
                <div className="overflow-x-auto">
                  {stackGroup.containers.map((c) => (
                    <ContainerRow
                      key={c.id}
                      container={c}
                      updateInfo={updateFor(updates, c.hostId, c.id)}
                      stats={stats[c.id]}
                      selected={selectedId === c.id}
                      canAct={canAct}
                      readonlyReason={readonlyReason}
                      source={source}
                      onSelect={() => onSelectContainer(c)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** The update badge no longer owns a column of its own — it sits next to the
 * name, where a container property belongs, and CPU/memory take the width. */
const ROW_GRID_COLS = "16px minmax(210px,1fr) 62px 78px";

function ContainerRow({
  container,
  updateInfo,
  stats,
  selected,
  canAct,
  readonlyReason,
  source,
  onSelect,
}: {
  container: DockerContainer;
  updateInfo: DockerUpdateInfo | undefined;
  stats: { cpuPct: number; memUsed: number; memLimit: number } | undefined;
  selected: boolean;
  canAct: boolean;
  /** Set when this container's host is readonly — actions render disabled. */
  readonlyReason: string | undefined;
  source: ReturnType<typeof useDockerSource>;
  onSelect: () => void;
}) {
  const t = useT();
  const tone = containerBadgeTone(container.state, container.health);
  const ports = formatPorts(container.ports);
  return (
    <div
      role="row"
      onClick={onSelect}
      aria-selected={selected}
      className={`flex cursor-pointer items-center gap-2.5 border-b border-line-soft py-1.5 pl-1 text-xs last:border-b-0 hover:bg-surface-2 ${
        selected ? "bg-accent-soft" : ""
      }`}
    >
      <div className="grid flex-1 items-center gap-2.5" style={{ gridTemplateColumns: ROW_GRID_COLS }}>
        <i className={`inline-block h-1.5 w-1.5 rounded-sm ${DOT_TONE_CLASS[tone]}`} />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold text-ink">{container.name}</span>
            {updateInfo?.status === "outdated" && (
              // Short label, full one in the tooltip: "Update verfügbar" next to
              // a container name eats the width the name itself needs.
              <span
                title={t("docker.updateBadge")}
                className="shrink-0 whitespace-nowrap rounded-full border border-sev-warn/35 bg-sev-warn/15 px-1.5 font-mono text-[9.5px] leading-[15px] text-sev-warn"
              >
                ↑ {t("docker.updateBadgeShort")}
              </span>
            )}
          </span>
          {/* The image is the second-most important thing in the row; sharing
              one muted line with the ports made it read as an afterthought.
              Chip + full-ink tag separates "what runs" from "which version". */}
          <span className="mt-0.5 flex min-w-0 items-center gap-2">
            <span className="flex min-w-0 items-baseline overflow-hidden rounded border border-line bg-surface-2 px-1.5 font-mono text-[11px]">
              <span className="truncate text-ink-2">{container.image}</span>
              {container.tag && <span className="shrink-0 font-semibold text-ink">:{container.tag}</span>}
            </span>
            {ports && <span className="truncate font-mono text-[10.5px] text-ink-muted">{ports}</span>}
          </span>
        </span>
        <span className="text-right font-mono text-[11px] tabular-nums text-ink-2">
          {stats ? `${stats.cpuPct.toFixed(1)}%` : "—"}
        </span>
        <span className="text-right font-mono text-[11px] tabular-nums text-ink-2">
          {stats ? formatMem(stats.memUsed) : "—"}
        </span>
      </div>
      <ActionButtons
        source={source}
        hostId={container.hostId}
        cid={container.id}
        state={container.state}
        canAct={canAct}
        disabledReason={readonlyReason}
      />
    </div>
  );
}

function formatMem(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function CrossTypeResults({
  type,
  isLoading,
  hasQuery,
  results,
}: {
  type: Exclude<DockerSearchTypeParam, "containers">;
  isLoading: boolean;
  hasQuery: boolean;
  results: ReturnType<typeof useDockerSearch>["data"];
}) {
  const t = useT();
  if (!hasQuery) return <div className="p-6 text-sm text-ink-2">{t("docker.searchTypeHint")}</div>;
  if (isLoading) return <div className="p-6 text-sm text-ink-2">{t("docker.loading")}</div>;
  const rows = results?.results[type] ?? [];
  if (rows.length === 0) return <div className="p-6 text-sm text-ink-2">{t("docker.empty")}</div>;
  return (
    <div className="flex flex-col">
      {rows.map((row, i) => {
        const label =
          (row as { RepoTags?: string[] }).RepoTags?.[0] ??
          (row as { Name?: string }).Name ??
          (row as { Id?: string }).Id ??
          `#${i}`;
        return (
          <div key={`${row.hostId}-${i}`} className="border-b border-line-soft px-3.5 py-2 text-[12px] last:border-b-0">
            <div className="truncate font-semibold text-ink">{String(label)}</div>
            <div className="font-mono text-[10.5px] text-ink-muted">{row.hostId}</div>
          </div>
        );
      })}
    </div>
  );
}
