import { useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { ZabbixHost } from "@auzui/zabbix-client";
import { useHostGroups, useHostProblemCounts, useHosts } from "../hosts/use-hosts";
import { useProblems } from "../problems/use-problems";
import { formatAge } from "../../lib/problems";
import { SEVERITY_TOKEN } from "../../lib/severity";
import { aggregateGroupProblems, utilColorMix } from "../../lib/explorer";
import { validateExplorerSearch } from "./search-params";
import { useHostCpuUtil } from "./use-explorer";

type ColorMode = "status" | "util";

function sevBgClass(severity: number): string {
  return severity < 0 ? "bg-sev-ok" : `bg-${SEVERITY_TOKEN[severity as 0 | 1 | 2 | 3 | 4 | 5]}`;
}

/**
 * Infrastructure Explorer (PLAN.md Phase 2 / Entwurf 1) — Drilldown-Heatmap
 * Hostgruppen → Hosts. Klick auf einen Host geht direkt in den Host Deep-Dive
 * (/hosts/$hostId); eine dritte Komponenten-Ebene bauen wir bewusst nicht,
 * das übernimmt bereits die Host-Detailseite.
 */
export function ExplorerPage() {
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateExplorerSearch(rawSearch);
  const navigate = useNavigate();

  const [colorMode, setColorMode] = useState<ColorMode>("status");

  const hostsQuery = useHosts();
  const groupsQuery = useHostGroups();
  const problemsByHost = useHostProblemCounts();
  const { problems: allProblems } = useProblems();

  const hosts = hostsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];

  const groupSummaries = useMemo(() => aggregateGroupProblems(hosts, problemsByHost), [hosts, problemsByHost]);

  const selectedGroup = search.group ? groups.find((g) => g.groupid === search.group) : undefined;

  const hostsInGroup = useMemo(
    () =>
      selectedGroup
        ? hosts
            .filter((h) => (h.hostgroups ?? []).some((g) => g.groupid === selectedGroup.groupid))
            .sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host))
        : [],
    [hosts, selectedGroup],
  );

  const hostIdsInGroup = useMemo(() => hostsInGroup.map((h) => h.hostid), [hostsInGroup]);
  const utilByHost = useHostCpuUtil(hostIdsInGroup, Boolean(selectedGroup) && colorMode === "util");

  const scopedProblems = useMemo(() => {
    if (!selectedGroup) return allProblems;
    const hostIdSet = new Set(hostIdsInGroup);
    return allProblems.filter((p) => p.hostId && hostIdSet.has(p.hostId));
  }, [allProblems, selectedGroup, hostIdsInGroup]);

  const sortedProblems = useMemo(
    () => [...scopedProblems].sort((a, b) => b.severity - a.severity || b.clock - a.clock),
    [scopedProblems],
  );

  function openGroup(groupId: string) {
    void navigate({ to: "/explorer", search: { group: groupId } });
  }

  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-16 pt-4.5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">Infrastructure Explorer</h1>
        <span className="text-[13px] text-ink-2">
          Wo brennt es, wo ist es voll? — Drilldown Gruppen → Hosts
        </span>
        <span className="font-mono text-[10.5px] text-ink-muted">
          generiert aus {hosts.length} Hosts · 0 Konfiguration
        </span>
      </div>

      <div className="grid grid-cols-[1fr_300px] items-start gap-3.5 max-[980px]:grid-cols-1">
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[12.5px] text-ink-2">
            <Link to="/explorer" search={{}} className={selectedGroup ? "text-accent" : "font-semibold text-ink"}>
              Alle Gruppen
            </Link>
            {selectedGroup && (
              <>
                <span className="text-ink-muted">›</span>
                <span className="font-semibold text-ink">{selectedGroup.name}</span>
              </>
            )}
          </div>

          <div className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                {selectedGroup ? selectedGroup.name : "Hostgruppen"}
              </span>
              {selectedGroup && (
                <div className="ml-auto flex items-center gap-1.5 text-[11.5px] text-ink-2">
                  <span>Farbe:</span>
                  <div className="inline-flex gap-0.5 rounded-md bg-surface-3 p-0.5">
                    {(["status", "util"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setColorMode(mode)}
                        className={`rounded px-2 py-1 text-[11px] ${
                          colorMode === mode ? "bg-surface font-semibold text-ink" : "text-ink-2"
                        }`}
                      >
                        {mode === "status" ? "Status" : "Auslastung"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {hostsQuery.isLoading || groupsQuery.isLoading ? (
              <div className="p-6 text-sm text-ink-2">Lade…</div>
            ) : !selectedGroup ? (
              <div className="grid grid-cols-3 gap-2.5 p-3.5 max-[700px]:grid-cols-1">
                {groups.map((g) => {
                  const summary = groupSummaries.get(g.groupid);
                  const hostCount = summary?.hostCount ?? 0;
                  const maxSeverity = summary?.maxSeverity ?? -1;
                  return (
                    <button
                      key={g.groupid}
                      type="button"
                      onClick={() => openGroup(g.groupid)}
                      className="flex flex-col items-start gap-1.5 rounded-md border border-line bg-surface-2 p-3 text-left hover:bg-surface-3"
                    >
                      <span className="truncate text-[13px] font-semibold text-ink">{g.name}</span>
                      <span className="font-mono text-[11px] text-ink-muted">{hostCount} Hosts</span>
                      <span className={`h-1.5 w-full rounded-full ${sevBgClass(maxSeverity)}`} />
                      <span className="font-mono text-[10.5px] text-ink-muted">
                        {summary && summary.problemCount > 0 ? `${summary.problemCount} Probleme` : "keine Probleme"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2.5 p-3.5 max-[980px]:grid-cols-2 max-[560px]:grid-cols-1">
                {hostsInGroup.map((host) => (
                  <HostTile
                    key={host.hostid}
                    host={host}
                    colorMode={colorMode}
                    problem={problemsByHost.get(host.hostid)}
                    utilPct={utilByHost.get(host.hostid)}
                  />
                ))}
                {hostsInGroup.length === 0 && (
                  <div className="col-span-full p-6 text-center text-sm text-ink-2">
                    Keine Hosts in dieser Gruppe.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-lg border border-line bg-surface">
            <div className="flex items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                Aktive Probleme
              </span>
              <span className="ml-auto font-mono text-[10.5px] text-ink-muted">{sortedProblems.length}</span>
            </div>
            {sortedProblems.length === 0 ? (
              <div className="p-4 text-sm text-ink-2">Keine aktiven Probleme in dieser Ansicht.</div>
            ) : (
              <div>
                {sortedProblems.slice(0, 12).map((p) => (
                  <Link
                    key={p.eventid}
                    to="/"
                    search={{ event: p.eventid }}
                    className="flex items-start gap-2 border-b border-line-soft px-3.5 py-2 text-[12px] last:border-b-0 hover:bg-surface-2"
                  >
                    <span className={`mt-1 h-2 w-2 flex-none rounded-sm ${sevBgClass(p.severity)}`} />
                    <span className="min-w-0 flex-1">
                      <div className="truncate text-ink">{p.name}</div>
                      <div className="truncate font-mono text-[10.5px] text-ink-muted">{p.hostName}</div>
                    </span>
                    <span className="flex-none font-mono text-[10.5px] text-ink-muted">
                      {formatAge(p.clock)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function HostTile({
  host,
  colorMode,
  problem,
  utilPct,
}: {
  host: ZabbixHost;
  colorMode: ColorMode;
  problem: { count: number; maxSeverity: number } | undefined;
  utilPct: number | undefined;
}) {
  const role = host.parentTemplates?.[0]?.name;
  const style =
    colorMode === "util" && utilPct !== undefined ? { backgroundColor: utilColorMix(utilPct) } : undefined;
  const dotClass = sevBgClass(problem && problem.count > 0 ? problem.maxSeverity : -1);

  return (
    <Link
      to="/hosts/$hostId"
      params={{ hostId: host.hostid }}
      className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 p-3 text-left hover:bg-surface-3"
    >
      <span className="flex items-center gap-1.5">
        {colorMode === "status" ? (
          <span className={`h-2 w-2 flex-none rounded-sm ${dotClass}`} />
        ) : (
          <span className="h-2 w-2 flex-none rounded-sm" style={style} />
        )}
        <span className="truncate text-[12.5px] font-semibold text-ink">{host.name || host.host}</span>
        {host.maintenance_status === "1" && <span title="Maintenance">🔧</span>}
      </span>
      {role && <span className="truncate font-mono text-[10.5px] text-ink-muted">{role}</span>}
      <span className="font-mono text-[11px] text-ink-2">
        {colorMode === "util"
          ? utilPct !== undefined
            ? `${utilPct.toFixed(0)} %`
            : "–"
          : problem && problem.count > 0
            ? `${problem.count} Probleme`
            : "OK"}
      </span>
    </Link>
  );
}
