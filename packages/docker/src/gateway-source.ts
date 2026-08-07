import type {
  DockerAction,
  DockerActionResult,
  DockerComposePs,
  DockerContainer,
  DockerContainersParams,
  DockerContainersResult,
  DockerHostError,
  DockerHostsResult,
  DockerInspect,
  DockerLogLine,
  DockerLogsParams,
  DockerLogsResult,
  DockerPermissions,
  DockerPort,
  DockerResourceRow,
  DockerSearchParams,
  DockerSearchResult,
  DockerSource,
  DockerStack,
  DockerStackAction,
  DockerStackActionResult,
  DockerStackConfig,
  DockerStacksResult,
  DockerStats,
  DockerStatsBulkResult,
  DockerStatsMap,
  DockerUpdateInfo,
  DockerUpdatesMap,
  DockerUpdatesResult,
} from "./source";

export interface GatewayDockerSourceOptions {
  /** Base URL of the auzui-gateway, default "" (same origin). */
  gatewayBase?: string;
  /** Zabbix session token — the gateway checks host/action permissions with it. */
  getToken: () => string | undefined;
  fetchFn?: typeof fetch;
}

interface GatewayHostSummary {
  id: string;
  label: string;
  readonly: boolean;
  compose: boolean;
  zabbix_host: string;
  engine_version: string;
  containers_running: number;
  containers_stopped: number;
  images: number;
}

interface GatewayHostError {
  host_id: string;
  message: string;
}

interface GatewayHostsResult {
  hosts: GatewayHostSummary[];
  errors: GatewayHostError[];
}

interface GatewayPort {
  private: number | null;
  public: number | null;
  type: string;
  ip: string;
}

interface GatewayContainer {
  id: string;
  host_id: string;
  name: string;
  names: string[];
  image: string;
  tag: string;
  image_id: string;
  state: string;
  status: string;
  health: string | null;
  created: number;
  ports: GatewayPort[];
  project: string;
  service: string;
  compose_working_dir: string;
  labels: Record<string, string>;
}

interface GatewayContainersResult {
  containers: GatewayContainer[];
  errors: GatewayHostError[];
}

interface GatewayStats {
  cpu_pct: number;
  mem_used: number;
  mem_limit: number;
  net_rx: number;
  net_tx: number;
  blk_read: number;
  blk_write: number;
}

interface GatewayStatsBulkResult {
  stats: Record<string, Record<string, GatewayStats>>;
  errors: GatewayHostError[];
}

interface GatewayLogLine {
  ts: number;
  stream: "stdout" | "stderr";
  message: string;
}

interface GatewayLogsResult {
  lines: GatewayLogLine[];
  cursor: string | null;
}

interface GatewayResourceRow {
  host_id: string;
  used_by?: string[];
  [key: string]: unknown;
}

interface GatewaySearchResult {
  results: {
    containers: GatewayContainer[];
    images: GatewayResourceRow[];
    volumes: GatewayResourceRow[];
    networks: GatewayResourceRow[];
  };
  errors: GatewayHostError[];
}

interface GatewayUpdateInfo {
  tag: string;
  local_digest: string;
  remote_digest: string;
  status: "current" | "outdated" | "unknown";
}

interface GatewayUpdatesResult {
  updates: Record<string, Record<string, GatewayUpdateInfo>>;
  errors: GatewayHostError[];
}

interface GatewayActionResult {
  action?: string;
  container_id: string;
  updated?: boolean;
  digest?: string;
}

interface GatewayStack {
  project: string;
  containers: GatewayContainer[];
  ps?: DockerComposePs[];
}

interface GatewayStacksResult {
  stacks: GatewayStack[];
  compose: boolean;
  errors: GatewayHostError[];
}

interface GatewayStackConfig {
  path: string;
  content: string;
}

function toPort(p: GatewayPort): DockerPort {
  return { private: p.private, public: p.public, type: p.type, ip: p.ip };
}

function toContainer(c: GatewayContainer): DockerContainer {
  return {
    id: c.id,
    hostId: c.host_id,
    name: c.name,
    names: c.names,
    image: c.image,
    tag: c.tag,
    imageId: c.image_id,
    state: c.state,
    status: c.status,
    health: c.health,
    created: c.created,
    ports: (c.ports ?? []).map(toPort),
    project: c.project,
    service: c.service,
    composeWorkingDir: c.compose_working_dir,
    labels: c.labels ?? {},
  };
}

function toErrors(errors: GatewayHostError[] | undefined): DockerHostError[] {
  return (errors ?? []).map((e) => ({ hostId: e.host_id, message: e.message }));
}

function toStats(s: GatewayStats): DockerStats {
  return {
    cpuPct: s.cpu_pct,
    memUsed: s.mem_used,
    memLimit: s.mem_limit,
    netRx: s.net_rx,
    netTx: s.net_tx,
    blkRead: s.blk_read,
    blkWrite: s.blk_write,
  };
}

function toStatsMap(raw: Record<string, Record<string, GatewayStats>>): DockerStatsMap {
  const out: DockerStatsMap = {};
  for (const [hostId, byCid] of Object.entries(raw ?? {})) {
    const mapped: Record<string, DockerStats> = {};
    for (const [cid, stats] of Object.entries(byCid ?? {})) mapped[cid] = toStats(stats);
    out[hostId] = mapped;
  }
  return out;
}

function toResourceRow(r: GatewayResourceRow): DockerResourceRow {
  const { host_id, used_by, ...rest } = r;
  return { hostId: host_id, usedBy: used_by ?? [], ...rest };
}

function toUpdateInfo(u: GatewayUpdateInfo): DockerUpdateInfo {
  return { tag: u.tag, localDigest: u.local_digest, remoteDigest: u.remote_digest, status: u.status };
}

function toUpdatesMap(raw: Record<string, Record<string, GatewayUpdateInfo>>): DockerUpdatesMap {
  const out: DockerUpdatesMap = {};
  for (const [hostId, byCid] of Object.entries(raw ?? {})) {
    const mapped: Record<string, DockerUpdateInfo> = {};
    for (const [cid, info] of Object.entries(byCid ?? {})) mapped[cid] = toUpdateInfo(info);
    out[hostId] = mapped;
  }
  return out;
}

function toStack(s: GatewayStack): DockerStack {
  return {
    project: s.project,
    containers: (s.containers ?? []).map(toContainer),
    ...(s.ps !== undefined ? { ps: s.ps } : {}),
  };
}

/**
 * Builds a query string. Array values are repeated once per key
 * (`?hosts=a&hosts=b`), NOT comma-joined — docker_routes.py declares
 * `hosts`/`types` as plain `Query(list[str])` params, which is FastAPI's
 * repeated-key convention, unlike the comma-split `cors_origins`-style CSV
 * settings elsewhere in the gateway.
 */
function qs(params: Record<string, string | string[] | boolean | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) search.append(key, v);
    } else {
      search.set(key, String(value));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

/**
 * Talks to the auzui-gateway /api/docker/* endpoints
 * (auzui-docker-plan.md / CONTRACT.md section 2.2-2.6). The Docker hosts'
 * connection details (URLs, TLS material, SSH keys) never reach the
 * browser; the gateway enforces Zabbix session/role permissions with the
 * caller's session token, same pattern as GraylogSource.
 */
export class GatewayDockerSource implements DockerSource {
  readonly enabled = true;
  private readonly base: string;
  private readonly getToken: () => string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(opts: GatewayDockerSourceOptions) {
    this.base = opts.gatewayBase ?? "";
    this.getToken = opts.getToken;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /** GET /api/docker/status → whether the gateway has any Docker host configured. */
  static async status(
    gatewayBase = "",
    fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  ): Promise<boolean> {
    try {
      const res = await fetchFn(`${gatewayBase}/api/docker/status`);
      if (!res.ok) return false;
      const body = (await res.json()) as { enabled?: boolean };
      return body.enabled === true;
    } catch {
      return false;
    }
  }

  async hosts(signal?: AbortSignal): Promise<DockerHostsResult> {
    const res = await this.request("GET", "/api/docker/hosts", undefined, signal);
    const body = (await res.json()) as GatewayHostsResult;
    return {
      hosts: (body.hosts ?? []).map((h) => ({
        id: h.id,
        label: h.label,
        readonly: h.readonly,
        compose: h.compose,
        zabbixHost: h.zabbix_host,
        engineVersion: h.engine_version,
        containersRunning: h.containers_running,
        containersStopped: h.containers_stopped,
        images: h.images,
      })),
      errors: toErrors(body.errors),
    };
  }

  async containers(params: DockerContainersParams = {}): Promise<DockerContainersResult> {
    const query = qs({ hosts: params.hostIds, all: params.all ?? true ? 1 : 0 });
    const res = await this.request("GET", `/api/docker/containers${query}`, undefined, params.signal);
    const body = (await res.json()) as GatewayContainersResult;
    return { containers: (body.containers ?? []).map(toContainer), errors: toErrors(body.errors) };
  }

  async inspect(hostId: string, cid: string, signal?: AbortSignal): Promise<DockerInspect> {
    const res = await this.request(
      "GET",
      `/api/docker/containers/${encodeURIComponent(hostId)}/${encodeURIComponent(cid)}`,
      undefined,
      signal,
    );
    const body = (await res.json()) as { host_id: string; [key: string]: unknown };
    const { host_id, ...rest } = body;
    return { hostId: host_id, ...rest };
  }

  async stats(hostId: string, cid: string, signal?: AbortSignal): Promise<DockerStats> {
    const res = await this.request(
      "GET",
      `/api/docker/containers/${encodeURIComponent(hostId)}/${encodeURIComponent(cid)}/stats`,
      undefined,
      signal,
    );
    return toStats((await res.json()) as GatewayStats);
  }

  async bulkStats(targets: Record<string, string[]>, signal?: AbortSignal): Promise<DockerStatsBulkResult> {
    const res = await this.request("POST", "/api/docker/stats", { targets }, signal);
    const body = (await res.json()) as GatewayStatsBulkResult;
    return { stats: toStatsMap(body.stats), errors: toErrors(body.errors) };
  }

  async logs(hostId: string, cid: string, params: DockerLogsParams = {}): Promise<DockerLogsResult> {
    const query = qs({
      since: params.since,
      until: params.until,
      tail: params.tail,
      stdout: params.stdout,
      stderr: params.stderr,
    });
    const res = await this.request(
      "GET",
      `/api/docker/containers/${encodeURIComponent(hostId)}/${encodeURIComponent(cid)}/logs${query}`,
      undefined,
      params.signal,
    );
    const body = (await res.json()) as GatewayLogsResult;
    const lines: DockerLogLine[] = (body.lines ?? []).map((l) => ({
      ts: l.ts,
      stream: l.stream,
      message: l.message,
    }));
    return { lines, cursor: body.cursor ?? null };
  }

  async search(params: DockerSearchParams): Promise<DockerSearchResult> {
    const query = qs({ q: params.q, types: params.types, hosts: params.hostIds });
    const res = await this.request("GET", `/api/docker/search${query}`, undefined, params.signal);
    const body = (await res.json()) as GatewaySearchResult;
    return {
      results: {
        containers: (body.results?.containers ?? []).map(toContainer),
        images: (body.results?.images ?? []).map(toResourceRow),
        volumes: (body.results?.volumes ?? []).map(toResourceRow),
        networks: (body.results?.networks ?? []).map(toResourceRow),
      },
      errors: toErrors(body.errors),
    };
  }

  async updates(hostIds?: string[], signal?: AbortSignal): Promise<DockerUpdatesResult> {
    const query = qs({ hosts: hostIds });
    const res = await this.request("GET", `/api/docker/updates${query}`, undefined, signal);
    const body = (await res.json()) as GatewayUpdatesResult;
    return { updates: toUpdatesMap(body.updates), errors: toErrors(body.errors) };
  }

  async permissions(signal?: AbortSignal): Promise<DockerPermissions> {
    const res = await this.request("GET", "/api/docker/permissions", undefined, signal);
    const body = (await res.json()) as { can_act?: boolean };
    return { canAct: body.can_act === true };
  }

  async action(hostId: string, cid: string, action: DockerAction): Promise<DockerActionResult> {
    const res = await this.request(
      "POST",
      `/api/docker/containers/${encodeURIComponent(hostId)}/${encodeURIComponent(cid)}/action`,
      { action },
    );
    const body = (await res.json()) as GatewayActionResult;
    return {
      action: body.action,
      containerId: body.container_id,
      updated: body.updated,
      digest: body.digest,
    };
  }

  async stacks(hostId: string, signal?: AbortSignal): Promise<DockerStacksResult> {
    const res = await this.request(
      "GET",
      `/api/docker/stacks/${encodeURIComponent(hostId)}`,
      undefined,
      signal,
    );
    const body = (await res.json()) as GatewayStacksResult;
    return {
      stacks: (body.stacks ?? []).map(toStack),
      compose: body.compose === true,
      errors: toErrors(body.errors),
    };
  }

  async stackConfig(hostId: string, project: string, signal?: AbortSignal): Promise<DockerStackConfig> {
    const res = await this.request(
      "GET",
      `/api/docker/stacks/${encodeURIComponent(hostId)}/${encodeURIComponent(project)}/config`,
      undefined,
      signal,
    );
    const body = (await res.json()) as GatewayStackConfig;
    return { path: body.path, content: body.content };
  }

  async stackAction(
    hostId: string,
    project: string,
    action: DockerStackAction,
  ): Promise<DockerStackActionResult> {
    const res = await this.request(
      "POST",
      `/api/docker/stacks/${encodeURIComponent(hostId)}/${encodeURIComponent(project)}/action`,
      { action },
    );
    const body = (await res.json()) as { stdout?: string; stderr?: string };
    return { stdout: body.stdout ?? "", stderr: body.stderr ?? "" };
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const token = this.getToken();
    const res = await this.fetchFn(`${this.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!res.ok) {
      throw new Error((await this.extractErrorDetail(res)) ?? `gateway ${path} failed: HTTP ${res.status}`);
    }
    return res;
  }

  /** FastAPI's HTTPException serializes as {"detail": "..."} — surface that text (e.g. "unknown docker host: x") instead of a bare status code. */
  private async extractErrorDetail(res: Response): Promise<string | undefined> {
    try {
      const body = (await res.clone().json()) as { detail?: unknown };
      return typeof body.detail === "string" ? body.detail : undefined;
    } catch {
      return undefined;
    }
  }
}
