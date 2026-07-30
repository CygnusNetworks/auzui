import { useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ZabbixHost } from "@auzui/zabbix-client";
import { matchesHostSearch, sortHosts, summarizeNames, type HostSortKey } from "../../lib/hosts";
import { useHostGroups, useHostProblemCounts, useHosts } from "./use-hosts";
import { useT } from "../../lib/i18n";

const GROUP_VISIBLE_LIMIT = 4;

const SEV_BG: Record<number, string> = {
  5: "bg-sev-disaster",
  4: "bg-sev-high",
  3: "bg-sev-avg",
  2: "bg-sev-warn",
  1: "bg-sev-info",
  0: "bg-ink-muted",
};

const ROW_HEIGHT = 52;

export function HostsPage() {
  const t = useT();
  const hostsQuery = useHosts();
  const groupsQuery = useHostGroups();
  const problemsByHost = useHostProblemCounts();

  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState<string>("");
  const [sortKey, setSortKey] = useState<HostSortKey>("severity");

  const hosts = hostsQuery.data ?? [];

  const filtered = useMemo(() => {
    let result = hosts;
    if (groupId) {
      result = result.filter((h) => (h.hostgroups ?? []).some((g) => g.groupid === groupId));
    }
    if (search.trim()) {
      result = result.filter((h) => matchesHostSearch(h, search));
    }
    return sortHosts(result, sortKey, problemsByHost);
  }, [hosts, groupId, search, sortKey, problemsByHost]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  return (
    <div className="mx-auto max-w-[1400px] px-3 pb-16 pt-4.5 min-[700px]:px-5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">{t("hosts.title")}</h1>
        <span className="text-[13px] text-ink-2">{t("hosts.subtitle", hosts.length)}</span>
      </div>

      <div className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("hosts.searchPlaceholder")}
            className="min-w-[200px] flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink max-[700px]:w-full"
          />
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
          >
            <option value="">{t("hosts.allGroups")}</option>
            {(groupsQuery.data ?? []).map((g) => (
              <option key={g.groupid} value={g.groupid}>
                {g.name}
              </option>
            ))}
          </select>
          <div className="inline-flex gap-0.5 rounded-md bg-surface-3 p-0.5 text-[11.5px]">
            <button
              type="button"
              onClick={() => setSortKey("name")}
              className={`rounded px-2.5 py-1 ${sortKey === "name" ? "bg-surface font-semibold text-ink" : "text-ink-2"}`}
            >
              {t("hosts.sortName")}
            </button>
            <button
              type="button"
              onClick={() => setSortKey("severity")}
              className={`rounded px-2.5 py-1 ${sortKey === "severity" ? "bg-surface font-semibold text-ink" : "text-ink-2"}`}
            >
              {t("hosts.sortSeverity")}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[20px_1fr_70px_24px] gap-2 border-b border-line-soft px-2.5 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted min-[700px]:grid-cols-[24px_1.6fr_1.4fr_90px_28px] min-[700px]:px-3.5 min-[1000px]:grid-cols-[24px_1.6fr_1.4fr_1.2fr_90px_28px]">
          <span />
          <span>{t("hosts.colHost")}</span>
          <span className="hidden min-[700px]:block">{t("hosts.colGroups")}</span>
          <span className="hidden min-[1000px]:block">{t("hosts.colInterfaces")}</span>
          <span>{t("hosts.colProblems")}</span>
          <span />
        </div>

        {hostsQuery.isLoading ? (
          <div className="p-6 text-sm text-ink-2">{t("hosts.loading")}</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-2">{t("hosts.empty")}</div>
        ) : (
          <div ref={scrollRef} className="max-h-[70vh] overflow-y-auto">
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((row) => {
                const host = filtered[row.index]!;
                return (
                  <div
                    key={host.hostid}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${row.start}px)`,
                      height: ROW_HEIGHT,
                    }}
                  >
                    <HostRow host={host} problem={problemsByHost.get(host.hostid)} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HostRow({
  host,
  problem,
}: {
  host: ZabbixHost;
  problem: { count: number; maxSeverity: number } | undefined;
}) {
  const t = useT();
  const navigate = useNavigate();
  const groups = host.hostgroups ?? [];
  const groupSummary = summarizeNames(
    groups.map((g) => g.name),
    GROUP_VISIBLE_LIMIT,
  );
  const roleNames = (host.parentTemplates ?? []).map((template) => template.name);
  const roleText = roleNames.join(", ") || t("hosts.noValue");
  const iface = host.interfaces?.[0];
  const ifaceLabel = iface
    ? iface.useip === "1"
      ? iface.ip
      : iface.dns || iface.ip
    : t("hosts.noValue");
  const statusColor = problem && problem.count > 0 ? SEV_BG[problem.maxSeverity]! : "bg-sev-ok";

  function goToProblems(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // unack:"0" disables the Problems page's unack-only default (unack !== "0"),
    // so acknowledged problems for this host stay visible too.
    void navigate({ to: "/", search: { host: host.host, unack: "0" } });
  }

  return (
    <Link
      to="/hosts/$hostId"
      params={{ hostId: host.hostid }}
      className="grid h-full grid-cols-[20px_1fr_70px_24px] items-center gap-2 border-b border-line-soft px-2.5 text-[12.5px] hover:bg-surface-2 min-[700px]:grid-cols-[24px_1.6fr_1.4fr_90px_28px] min-[700px]:px-3.5 min-[1000px]:grid-cols-[24px_1.6fr_1.4fr_1.2fr_90px_28px]"
    >
      <span className={`h-2 w-2 rounded-sm ${statusColor}`} />
      <span className="min-w-0" title={roleNames.length > 0 ? `${t("hosts.colRole")}: ${roleText}` : undefined}>
        <div className="truncate font-medium text-ink">{host.name || host.host}</div>
        <div className="truncate font-mono text-[10.5px] text-ink-muted">{host.host}</div>
      </span>
      <span className="hidden min-w-0 flex-wrap gap-1 min-[700px]:flex">
        {groupSummary.visible.map((name, i) => (
          <span
            key={groups[i]!.groupid}
            className="whitespace-nowrap rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-2"
          >
            {name}
          </span>
        ))}
        {groupSummary.extraCount > 0 && (
          <span
            title={groupSummary.fullText}
            className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted"
          >
            +{groupSummary.extraCount}
          </span>
        )}
      </span>
      <span className="hidden truncate font-mono text-[11.5px] text-ink-2 min-[1000px]:block">
        {ifaceLabel}
      </span>
      <span>
        {problem && problem.count > 0 ? (
          <button
            type="button"
            onClick={goToProblems}
            title={t("hosts.showProblemsTitle")}
            className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold text-white ${SEV_BG[problem.maxSeverity]}`}
          >
            {problem.count}
          </button>
        ) : (
          <span className="font-mono text-[11px] text-ink-muted">0</span>
        )}
      </span>
      <span title={t("hosts.maintenanceTitle")} className="text-ink-muted">
        {host.maintenance_status === "1" ? "🔧" : ""}
      </span>
    </Link>
  );
}

