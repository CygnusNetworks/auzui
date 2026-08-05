import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { DockerContainer, DockerSource, DockerUpdateInfo } from "@auzui/docker";
import { RangePicker, type RangeValue } from "../../components/RangePicker";
import { TimeChartPanel } from "../../components/charts/TimeChartPanel";
import { rangeFromPreset } from "@auzui/timeseries";
import { formatImageTag, formatPorts, logLineKey, type DockerBadgeTone } from "../../lib/docker";
import { useLogsEnabled } from "../../lib/use-logs";
import { useT } from "../../lib/i18n";
import { ActionButtons } from "./ActionButtons";
import { useDockerInspect } from "./use-docker-page";
import { useDockerLogs } from "./use-docker-logs";
import type { DockerDetailTab } from "./search-params";

/** Dot classes per DockerBadgeTone — same sev-ok/sev-warn/sev-high/ink-muted
 * convention as SeverityBadge/StatusBadge, reused by DockerPage row badges
 * and StackPanel's per-container dots. */
export const DOT_TONE_CLASS: Record<DockerBadgeTone, string> = {
  ok: "bg-sev-ok",
  warn: "bg-sev-warn",
  danger: "bg-sev-high",
  neutral: "bg-ink-muted",
};

export const BG_TONE_CLASS: Record<DockerBadgeTone, string> = {
  ok: "bg-sev-ok/15 text-sev-ok",
  warn: "bg-sev-warn/15 text-sev-warn",
  danger: "bg-sev-high/15 text-sev-high",
  neutral: "bg-ink-muted/15 text-ink-muted",
};

const STATS_POLL_MS = 3_000;
const STATS_BUFFER_CAP = 120;

interface StatsSample {
  ts: number;
  cpuPct: number;
  memUsed: number;
}

/**
 * Live stats buffer for the Stats tab: polls the single-container stats
 * endpoint every 3s (plan D5 — the bulk endpoint is for the list view only)
 * and keeps a capped in-memory window. Stops cleanly whenever the panel/tab
 * unmounts or the target container changes.
 */
function useStatsBuffer(source: DockerSource, hostId: string | undefined, cid: string | undefined, active: boolean) {
  const [samples, setSamples] = useState<StatsSample[]>([]);

  useEffect(() => {
    setSamples([]);
    if (!active || !source.enabled || !hostId || !cid) return;
    let cancelled = false;
    function poll() {
      source
        .stats(hostId!, cid!)
        .then((s) => {
          if (cancelled) return;
          setSamples((prev) => {
            const next = [...prev, { ts: Math.floor(Date.now() / 1000), cpuPct: s.cpuPct, memUsed: s.memUsed }];
            return next.length > STATS_BUFFER_CAP ? next.slice(next.length - STATS_BUFFER_CAP) : next;
          });
        })
        .catch(() => {
          // Transient stats failures (host briefly unreachable) just skip a sample.
        });
    }
    poll();
    const id = setInterval(poll, STATS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, source, hostId, cid]);

  return samples;
}

export function ContainerDetailPanel({
  source,
  container,
  updateInfo,
  zabbixHost,
  canAct,
  readonlyReason,
  tab,
  onTabChange,
  live,
  onLiveChange,
}: {
  source: DockerSource;
  container: DockerContainer | undefined;
  updateInfo: DockerUpdateInfo | undefined;
  /** Zabbix host technical name mapped to this container's Docker host, "" if unmapped. */
  zabbixHost: string;
  canAct: boolean;
  /** Set when this container's host is readonly — actions render disabled. */
  readonlyReason?: string;
  tab: DockerDetailTab;
  onTabChange: (tab: DockerDetailTab) => void;
  live: boolean;
  onLiveChange: (live: boolean) => void;
}) {
  const t = useT();

  if (!container) {
    return <div className="p-3.5 text-sm text-ink-2">{t("docker.detailPanel.noneSelected")}</div>;
  }

  return (
    <div>
      <div className="border-b border-line-soft p-3.5">
        <div className="text-sm font-semibold">{container.name}</div>
        <div className="mt-1 font-mono text-[11.5px] text-ink-muted">
          {formatImageTag(container.image, container.tag)}
        </div>
        <div className="mt-2">
          <ActionButtons
            source={source}
            hostId={container.hostId}
            cid={container.id}
            state={container.state}
            canAct={canAct}
            disabledReason={readonlyReason}
          />
          {readonlyReason && canAct && (
            <div className="mt-1.5 text-[11px] text-ink-muted">{readonlyReason}</div>
          )}
        </div>
      </div>

      <div className="flex border-b border-line-soft">
        {(["info", "stats", "logs"] as DockerDetailTab[]).map((tabId) => (
          <button
            key={tabId}
            type="button"
            onClick={() => onTabChange(tabId)}
            aria-pressed={tab === tabId}
            className={`flex-1 px-2.5 py-2 text-center font-mono text-[11px] uppercase tracking-wider ${
              tab === tabId ? "border-b-2 border-accent text-ink font-semibold" : "text-ink-muted"
            }`}
          >
            {t(`docker.detailPanel.tab.${tabId}`)}
          </button>
        ))}
      </div>

      {tab === "info" && (
        <InfoTab source={source} container={container} updateInfo={updateInfo} zabbixHost={zabbixHost} />
      )}
      {tab === "stats" && (
        <StatsTab source={source} container={container} zabbixHost={zabbixHost} />
      )}
      {tab === "logs" && (
        <LogsTab source={source} container={container} live={live} onLiveChange={onLiveChange} />
      )}
    </div>
  );
}

function InfoTab({
  source,
  container,
  updateInfo,
  zabbixHost,
}: {
  source: DockerSource;
  container: DockerContainer;
  updateInfo: DockerUpdateInfo | undefined;
  zabbixHost: string;
}) {
  const t = useT();
  const inspectQuery = useDockerInspect(source, container.hostId, container.id);
  const inspect = inspectQuery.data;
  const mounts = (inspect?.Mounts as { Source?: string; Destination?: string; RW?: boolean }[] | undefined) ?? [];
  const health = (inspect?.State as { Health?: { Status?: string } } | undefined)?.Health?.Status;

  return (
    <div>
      <div className="border-b border-line-soft p-3.5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("docker.detailPanel.status")}
        </div>
        <div className="grid grid-cols-2 gap-1.5 font-mono text-[11.5px] text-ink-2">
          <span>{t("docker.detailPanel.state")}</span>
          <span className="text-ink">{container.state}</span>
          {health && (
            <>
              <span>{t("docker.detailPanel.health")}</span>
              <span className="text-ink">{health}</span>
            </>
          )}
          <span>{t("docker.detailPanel.created")}</span>
          <span className="text-ink">{new Date(container.created * 1000).toLocaleString()}</span>
          {updateInfo && (
            <>
              <span>{t("docker.detailPanel.updateStatus")}</span>
              <span className="text-ink">{t(`docker.updateStatus.${updateInfo.status}`)}</span>
            </>
          )}
        </div>
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("docker.detailPanel.ports")}
        </div>
        {container.ports.length > 0 ? (
          <div className="font-mono text-[11.5px] text-ink-2">{formatPorts(container.ports)}</div>
        ) : (
          <div className="text-[11.5px] text-ink-muted">{t("docker.detailPanel.noPorts")}</div>
        )}
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("docker.detailPanel.mounts")}
        </div>
        {mounts.length > 0 ? (
          <div className="flex flex-col gap-1">
            {mounts.map((m, i) => (
              <div key={i} className="truncate font-mono text-[11px] text-ink-2">
                {m.Source} → {m.Destination} {m.RW === false ? `(${t("docker.detailPanel.readOnly")})` : ""}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[11.5px] text-ink-muted">{t("docker.detailPanel.noMounts")}</div>
        )}
      </div>

      <div className="p-3.5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("docker.detailPanel.labels")}
        </div>
        {Object.keys(container.labels).length > 0 ? (
          <div className="flex flex-col gap-1">
            {Object.entries(container.labels).map(([k, v]) => (
              <div key={k} className="truncate font-mono text-[10.5px] text-ink-muted">
                <span className="text-ink-2">{k}</span> = {v}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[11.5px] text-ink-muted">{t("docker.detailPanel.noLabels")}</div>
        )}
        {zabbixHost && (
          <Link
            to="/metrics"
            search={{ q: `host:${zabbixHost}` }}
            className="mt-3 inline-block rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
          >
            {t("docker.detailPanel.zabbixMetrics")}
          </Link>
        )}
      </div>
    </div>
  );
}

function StatsTab({
  source,
  container,
  zabbixHost,
}: {
  source: DockerSource;
  container: DockerContainer;
  zabbixHost: string;
}) {
  const t = useT();
  const samples = useStatsBuffer(source, container.hostId, container.id, true);
  const cpuPoints: [number, number | null][] = samples.map((s) => [s.ts, s.cpuPct]);
  const memPoints: [number, number | null][] = samples.map((s) => [s.ts, s.memUsed]);

  return (
    <div>
      <div className="border-b border-line-soft p-3.5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("docker.detailPanel.cpuTitle")}
        </div>
        <TimeChartPanel
          series={[{ label: "CPU", points: cpuPoints }]}
          unit="%"
          height={120}
          isLoading={samples.length === 0}
          slow={false}
          onRetry={() => {}}
        />
      </div>
      <div className="border-b border-line-soft p-3.5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("docker.detailPanel.memTitle")}
        </div>
        <TimeChartPanel
          series={[{ label: "Mem", points: memPoints }]}
          unit="B"
          height={120}
          isLoading={samples.length === 0}
          slow={false}
          onRetry={() => {}}
        />
      </div>
      {zabbixHost && (
        <div className="p-3.5">
          <Link
            to="/metrics"
            search={{ q: `host:${zabbixHost}` }}
            className="inline-block rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
          >
            {t("docker.detailPanel.zabbixMetrics")}
          </Link>
        </div>
      )}
    </div>
  );
}

const LOGS_TAIL = 500;

/** Below this scroll offset the log view is considered "at the tail" and keeps
 * following new lines; scrolling further down means the user is reading back
 * and must not be yanked to the top by the next poll. */
const FOLLOW_THRESHOLD_PX = 24;

function LogsTab({
  source,
  container,
  live,
  onLiveChange,
}: {
  source: DockerSource;
  container: DockerContainer;
  live: boolean;
  onLiveChange: (live: boolean) => void;
}) {
  const t = useT();
  const { data: logsEnabled } = useLogsEnabled();
  const [range, setRange] = useState<RangeValue>(() => rangeFromPreset("1h"));
  const history = live ? { tail: LOGS_TAIL } : { since: range.from, until: range.to, tail: LOGS_TAIL };
  const { lines, isLoading } = useDockerLogs(source, container.hostId, container.id, history, live);
  // Newest first (like /logs and the host Logs panel): the buffer itself stays
  // chronological — the cursor poll appends to it — only the view is flipped.
  const newestFirst = useMemo(() => [...lines].reverse(), [lines]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // With the newest line at the top, "follow the tail" means staying at scroll
  // position 0. Only nudge when the user hasn't scrolled down to read history.
  useEffect(() => {
    const el = scrollRef.current;
    if (live && el && el.scrollTop < FOLLOW_THRESHOLD_PX) el.scrollTop = 0;
  }, [live, lines.length]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft p-2.5">
        {/* In live mode the range is ignored (the poll always tails), so the
            picker only appears once the user opts out of live. */}
        {!live && <RangePicker value={range} onChange={setRange} live={false} onLiveChange={() => {}} />}
        <button
          type="button"
          onClick={() => onLiveChange(!live)}
          aria-pressed={live}
          className={`ml-auto rounded-full border px-2.5 py-1 font-mono text-[10.5px] ${
            live ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-ink-muted"
          }`}
        >
          {t("docker.detailPanel.liveToggle")} {live ? "✓" : ""}
        </button>
        {logsEnabled && (
          // Router link, not an <a target="_blank">: the session token lives in
          // sessionStorage (docs/authentication.md), which a new tab opened with
          // rel="noreferrer" does NOT inherit — that link landed on the login
          // form. Same tab, client-side navigation, session intact.
          <Link
            to="/logs"
            search={{ q: container.name }}
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] text-ink-2"
          >
            {t("docker.detailPanel.graylogLink")}
          </Link>
        )}
      </div>
      <div ref={scrollRef} className="max-h-[420px] overflow-y-auto p-2.5 font-mono text-[11px]">
        {isLoading && lines.length === 0 ? (
          <div className="text-ink-2">{t("docker.detailPanel.logsLoading")}</div>
        ) : lines.length === 0 ? (
          <div className="text-ink-muted">{t("docker.detailPanel.logsEmpty")}</div>
        ) : (
          newestFirst.map((l) => (
            <div
              key={logLineKey(l)}
              className={`animate-log-row-in whitespace-pre-wrap ${
                l.stream === "stderr" ? "text-sev-high" : "text-ink-2"
              }`}
            >
              <span className="text-ink-muted">{new Date(l.ts * 1000).toLocaleTimeString()}</span> {l.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
