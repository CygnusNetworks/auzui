/** A single configured Docker host, as exposed by GET /api/docker/hosts
 * (never carries URLs, TLS material, or SSH keys — see CONTRACT 2.2
 * DockerService.host_list). */
export interface DockerHostInfo {
  id: string;
  label: string;
  readonly: boolean;
  compose: boolean;
  /** Zabbix host technical name for the metrics deep-link, "" if unmapped. */
  zabbixHost: string;
}

/** One host's engine summary (GET /api/docker/hosts row), fanned out from
 * docker version + docker info. */
export interface DockerHostSummary extends DockerHostInfo {
  engineVersion: string;
  containersRunning: number;
  containersStopped: number;
  images: number;
}

/** Per-host failure entry — the fan-out shape shared by every /api/docker/*
 * route that queries multiple hosts (graylog.py-style partial results). */
export interface DockerHostError {
  hostId: string;
  message: string;
}

export interface DockerHostsResult {
  hosts: DockerHostSummary[];
  errors: DockerHostError[];
}

export interface DockerPort {
  private: number | null;
  public: number | null;
  type: string;
  ip: string;
}

/** Normalized container row (CONTRACT 2.2 "Normalisierte Container-Row"). */
export interface DockerContainer {
  id: string;
  hostId: string;
  name: string;
  names: string[];
  image: string;
  tag: string;
  imageId: string;
  state: string;
  status: string;
  health: string | null;
  /** Unix seconds. */
  created: number;
  ports: DockerPort[];
  /** From label com.docker.compose.project; "" when not part of a stack. */
  project: string;
  service: string;
  composeWorkingDir: string;
  labels: Record<string, string>;
}

export interface DockerContainersParams {
  hostIds?: string[];
  /** Include stopped/exited containers too (default true, mirrors `all=1`). */
  all?: boolean;
  signal?: AbortSignal;
}

export interface DockerContainersResult {
  containers: DockerContainer[];
  errors: DockerHostError[];
}

/** Trimmed `docker inspect` payload (Config, Mounts, NetworkSettings,
 * HostConfig.RestartPolicy, State.Health, Image RepoDigests, ...) plus the
 * host it was fetched from. Passed through largely as-is — the gateway only
 * trims, it does not rename these inner Docker-native keys. */
export interface DockerInspect {
  hostId: string;
  [key: string]: unknown;
}

/** Normalized single-sample stats (CONTRACT 2.3 calc_stats output). */
export interface DockerStats {
  cpuPct: number;
  memUsed: number;
  memLimit: number;
  netRx: number;
  netTx: number;
  blkRead: number;
  blkWrite: number;
}

/** hostId -> containerId -> stats, as returned by POST /api/docker/stats. */
export type DockerStatsMap = Record<string, Record<string, DockerStats>>;

export interface DockerStatsBulkResult {
  stats: DockerStatsMap;
  errors: DockerHostError[];
}

export interface DockerLogLine {
  /** Unix seconds (fractional, nanosecond precision from the daemon). */
  ts: number;
  stream: "stdout" | "stderr";
  message: string;
}

export interface DockerLogsResult {
  lines: DockerLogLine[];
  /** Opaque RFC3339Nano cursor for the next live-log poll; null if empty. */
  cursor: string | null;
}

export interface DockerLogsParams {
  /** Unix seconds. */
  since?: number;
  /** Unix seconds. */
  until?: number;
  /** Number of trailing lines (gateway bounds: 1..100000). */
  tail?: number;
  stdout?: boolean;
  stderr?: boolean;
  signal?: AbortSignal;
}

export type DockerSearchType = "containers" | "images" | "volumes" | "networks";

export interface DockerSearchParams {
  q: string;
  types?: DockerSearchType[];
  hostIds?: string[];
  signal?: AbortSignal;
}

/** Raw (mostly Docker-native-keyed) image/volume/network row plus the host
 * it came from — the gateway only tags host_id -> hostId onto these, it
 * does not otherwise remap their keys (CONTRACT 2.2 search()). */
export interface DockerResourceRow {
  hostId: string;
  [key: string]: unknown;
}

export interface DockerSearchResult {
  results: {
    containers: DockerContainer[];
    images: DockerResourceRow[];
    volumes: DockerResourceRow[];
    networks: DockerResourceRow[];
  };
  errors: DockerHostError[];
}

export type DockerUpdateStatus = "current" | "outdated" | "unknown";

/** One container's registry-digest comparison (CONTRACT 2.4 UpdateChecker.check). */
export interface DockerUpdateInfo {
  tag: string;
  localDigest: string;
  remoteDigest: string;
  status: DockerUpdateStatus;
}

/** hostId -> containerId -> update info. */
export type DockerUpdatesMap = Record<string, Record<string, DockerUpdateInfo>>;

export interface DockerUpdatesResult {
  updates: DockerUpdatesMap;
  errors: DockerHostError[];
}

/** GET /api/docker/permissions — UI blends action buttons on/off; the
 * gateway enforces the same check server-side regardless. */
export interface DockerPermissions {
  canAct: boolean;
}

export type DockerAction = "start" | "stop" | "restart" | "pull_recreate";

/** Response of POST .../action. Plain actions echo {action, containerId};
 * pull_recreate additionally reports whether a replacement happened and
 * its new digest/container id (docker_hosts.py DockerHostClient.pull_recreate). */
export interface DockerActionResult {
  action?: string;
  containerId: string;
  updated?: boolean;
  digest?: string;
}

/** One row of `docker compose ps --format json` (Docker-native keys, passed
 * through as-is — see DockerService/ComposeRunner.ps in docker_compose.py). */
export interface DockerComposePs {
  [key: string]: unknown;
}

export interface DockerStack {
  project: string;
  containers: DockerContainer[];
  /** Live `docker compose ps` rows for this project, only present for hosts
   * with `compose: true`; absent (not just empty) for non-compose hosts, and
   * empty when the `ps` call itself failed (see the stack's entry in
   * DockerStacksResult.errors). */
  ps?: DockerComposePs[];
}

export interface DockerStacksResult {
  stacks: DockerStack[];
  /** Whether this host supports compose actions (SSH hosts with compose=true). */
  compose: boolean;
  errors: DockerHostError[];
}

/** GET /api/docker/stacks/{host}/{project}/config — read-only compose-file
 * content (ComposeRunner.config_file), for hosts with `compose: true`. */
export interface DockerStackConfig {
  /** Absolute path of the stack's primary compose file on the host. */
  path: string;
  content: string;
}

export type DockerStackAction = "pull" | "up" | "restart";

/** Response of POST .../stacks/{host}/{project}/action (ComposeRunner.act). */
export interface DockerStackActionResult {
  stdout: string;
  stderr: string;
}

/**
 * Abstraction over the optional Docker management backend (auzui-docker-plan.md).
 * The SPA asks GET /api/docker/status once; when disabled it gets a
 * NullDockerSource and every Docker UI surface simply does not render —
 * same convention as @auzui/logs' LogSource / @auzui/timeseries' TimeSource.
 */
export interface DockerSource {
  readonly enabled: boolean;
  hosts(signal?: AbortSignal): Promise<DockerHostsResult>;
  containers(params?: DockerContainersParams): Promise<DockerContainersResult>;
  inspect(hostId: string, cid: string, signal?: AbortSignal): Promise<DockerInspect>;
  stats(hostId: string, cid: string, signal?: AbortSignal): Promise<DockerStats>;
  bulkStats(targets: Record<string, string[]>, signal?: AbortSignal): Promise<DockerStatsBulkResult>;
  logs(hostId: string, cid: string, params?: DockerLogsParams): Promise<DockerLogsResult>;
  search(params: DockerSearchParams): Promise<DockerSearchResult>;
  updates(hostIds?: string[], signal?: AbortSignal): Promise<DockerUpdatesResult>;
  permissions(signal?: AbortSignal): Promise<DockerPermissions>;
  action(hostId: string, cid: string, action: DockerAction): Promise<DockerActionResult>;
  stacks(hostId: string, signal?: AbortSignal): Promise<DockerStacksResult>;
  stackConfig(hostId: string, project: string, signal?: AbortSignal): Promise<DockerStackConfig>;
  stackAction(hostId: string, project: string, action: DockerStackAction): Promise<DockerStackActionResult>;
}
