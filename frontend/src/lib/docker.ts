import type { DockerContainer, DockerLogLine, DockerPort, DockerResourceRow } from "@auzui/docker";

/** Literal id used for containers that aren't part of any compose project
 * (no com.docker.compose.project label) — Dockge-style stack grouping. */
export const UNGROUPED_STACK = "ungrouped";

export interface DockerStackGroup {
  /** Compose project name, or UNGROUPED_STACK for standalone containers. */
  project: string;
  containers: DockerContainer[];
}

/**
 * Groups a flat container list by compose project (Dockge's "stack" view).
 * Containers without a project label land in one UNGROUPED_STACK group.
 * Named groups sort alphabetically; the ungrouped group always sorts last
 * so it doesn't visually compete with real stacks. Pure, no network access.
 */
export function groupContainersByStack(containers: DockerContainer[]): DockerStackGroup[] {
  const groups = new Map<string, DockerContainer[]>();
  for (const container of containers) {
    const key = container.project || UNGROUPED_STACK;
    const list = groups.get(key);
    if (list) list.push(container);
    else groups.set(key, [container]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === UNGROUPED_STACK) return 1;
      if (b === UNGROUPED_STACK) return -1;
      return a.localeCompare(b);
    })
    .map(([project, group]) => ({ project, containers: group }));
}

/**
 * Sort weight per container state — lower sorts first. Running containers
 * lead the list (the common case); everything else follows in roughly
 * "how far from running" order, with unknown/exotic states sorted last.
 */
const STATE_WEIGHT: Record<string, number> = {
  running: 0,
  restarting: 1,
  paused: 2,
  created: 3,
  removing: 4,
  exited: 5,
  dead: 6,
};

/** Sort weight for one container's `state` (docker-py's `Container.status`
 * field values: running/restarting/paused/created/removing/exited/dead).
 * Unknown values sort after all known states. */
export function containerStateWeight(state: string): number {
  return STATE_WEIGHT[state] ?? Object.keys(STATE_WEIGHT).length;
}

/**
 * Sorts containers by state weight (running first), then by name for a
 * stable order within the same state. Pure — does not mutate the input.
 */
export function sortContainersByState(containers: DockerContainer[]): DockerContainer[] {
  return [...containers].sort((a, b) => {
    const delta = containerStateWeight(a.state) - containerStateWeight(b.state);
    return delta !== 0 ? delta : a.name.localeCompare(b.name);
  });
}

export type DockerBadgeTone = "ok" | "warn" | "danger" | "neutral";

/**
 * Maps a container's state (+ optional health check result) to a badge
 * tone, for reuse with the same sev-ok/sev-warn/sev-high/ink-muted token
 * convention as StatusBadge (features/web-scenarios). Health, when known,
 * takes priority over the bare state (a "running" container that just
 * failed its healthcheck is a problem, not "ok").
 */
export function containerBadgeTone(state: string, health?: string | null): DockerBadgeTone {
  if (health === "unhealthy") return "danger";
  if (health === "starting") return "warn";
  switch (state) {
    case "running":
      return "ok";
    case "restarting":
      return "warn";
    case "exited":
    case "dead":
      return "danger";
    case "paused":
    case "created":
    case "removing":
      return "neutral";
    default:
      return "neutral";
  }
}

/** "8080:80/tcp" (published) or "80/tcp" (unpublished); "1.2.3.4:8080:80/tcp"
 * when the publish is bound to a specific host IP (not 0.0.0.0/::). */
export function formatPort(port: DockerPort): string {
  if (port.public) {
    const boundIp = port.ip && port.ip !== "0.0.0.0" && port.ip !== "::" ? `${port.ip}:` : "";
    return `${boundIp}${port.public}:${port.private}/${port.type}`;
  }
  return `${port.private}/${port.type}`;
}

/** Comma-joined formatPort() list; "" when the container publishes nothing. */
export function formatPorts(ports: DockerPort[]): string {
  return ports.map(formatPort).join(", ");
}

/** "nginx:1.27" (tagged) or bare "nginx" when no tag is set (e.g. digest-pinned). */
export function formatImageTag(image: string, tag: string): string {
  if (!image) return "";
  return tag ? `${image}:${tag}` : image;
}

/** Human-readable byte size — container memory in a lane row, image size in
 * the images lane. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** The cross-type search types that are NOT containers — containers have
 * their own richly-typed row and lane. */
export type DockerResourceType = "images" | "volumes" | "networks";

/**
 * One image/volume/network as a lane row. The gateway passes these rows
 * through with their Docker-native keys (CONTRACT 2.2 search()), so the
 * per-type key knowledge lives here rather than in JSX — pure and testable
 * against real docker-py `.attrs` shapes.
 */
export interface DockerResourceDisplay {
  /** Docker id/name; the React key within one host lane (index-suffixed by
   * the caller, since a malformed row can yield ""). */
  key: string;
  name: string;
  /** Muted second line: extra tags, mountpoint, subnets. "" when there is none. */
  sub: string;
  /** Right-hand column: size for images, driver for volumes/networks. */
  right: string;
  /** Containers referencing this row; empty means unused. */
  usedBy: string[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** "sha256:abcdef0123456…" -> "abcdef012345". */
export function shortDockerId(id: string): string {
  return id.replace(/^sha256:/, "").slice(0, 12);
}

/** docker-py reports an untagged image as this single pseudo-tag. */
const UNTAGGED_IMAGE = "<none>:<none>";

/** CIDRs from a network's `IPAM.Config` ([{Subnet, Gateway}, …]). */
function networkSubnets(row: DockerResourceRow): string[] {
  const config = (row.IPAM as { Config?: unknown } | undefined)?.Config;
  if (!Array.isArray(config)) return [];
  return config
    .map((entry) => (entry && typeof entry === "object" ? str((entry as Record<string, unknown>).Subnet) : ""))
    .filter((subnet) => subnet !== "");
}

export function describeResourceRow(type: DockerResourceType, row: DockerResourceRow): DockerResourceDisplay {
  const usedBy = Array.isArray(row.usedBy) ? row.usedBy.filter((n): n is string => typeof n === "string") : [];
  if (type === "images") {
    const id = shortDockerId(str(row.Id));
    const tags = (Array.isArray(row.RepoTags) ? row.RepoTags : []).filter(
      (tag): tag is string => typeof tag === "string" && tag !== UNTAGGED_IMAGE,
    );
    return {
      key: str(row.Id) || tags[0] || "",
      // A dangling image carries no tag at all — its short id is the only
      // handle a user has on it, so it becomes the name instead of a blank row.
      name: tags[0] ?? id,
      // Named images show their id underneath; extra tags of the same image
      // matter more than the id, so they win the line when there are any.
      sub: tags.length > 1 ? tags.slice(1).join(", ") : tags.length > 0 ? id : "",
      right: typeof row.Size === "number" ? formatBytes(row.Size) : "",
      usedBy,
    };
  }
  if (type === "volumes") {
    return {
      key: str(row.Name),
      name: str(row.Name),
      sub: str(row.Mountpoint),
      right: str(row.Driver),
      usedBy,
    };
  }
  return {
    key: str(row.Id) || str(row.Name),
    name: str(row.Name),
    // `host` and `none` are built-in networks with no IPAM config at all, so
    // this is legitimately empty for them rather than a missing field.
    sub: networkSubnets(row).join(", "),
    right: str(row.Driver),
    usedBy,
  };
}

/** All rows of one type for one host, name-sorted for a stable lane order
 * (the gateway fans out per host concurrently, so its order is arbitrary). */
export function describeResourceRows(
  type: DockerResourceType,
  rows: DockerResourceRow[],
): DockerResourceDisplay[] {
  return rows.map((row) => describeResourceRow(type, row)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Cap on the live-log buffer (auzui-docker-plan.md D6: "Buffer-Cap ~2000 Zeilen"). */
export const DOCKER_LOG_BUFFER_CAP = 2000;

/** Identity key for dedupe: the same (ts, stream, message) triple delivered
 * twice by overlapping cursor polls must collapse to one buffered line.
 * Also the React key of a rendered log row — stable across live polls, so
 * the CSS mount animation only plays for genuinely new lines (see
 * `.animate-log-row-in` in index.css and LogRows.tsx). */
export function logLineKey(line: DockerLogLine): string {
  return `${line.ts} ${line.stream} ${line.message}`;
}

/**
 * Merges a batch of newly-polled log lines into an existing buffer:
 * idempotent (a line already present by (ts, stream, message) is dropped,
 * so re-delivering the same poll result is a no-op), and caps the result at
 * DOCKER_LOG_BUFFER_CAP by trimming from the FRONT (oldest lines first) so
 * the most recent lines are always kept. Pure — does not mutate `existing`.
 */
export function mergeLogLines(existing: DockerLogLine[], incoming: DockerLogLine[]): DockerLogLine[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map(logLineKey));
  const merged = existing.slice();
  for (const line of incoming) {
    const key = logLineKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(line);
  }
  if (merged.length <= DOCKER_LOG_BUFFER_CAP) return merged;
  return merged.slice(merged.length - DOCKER_LOG_BUFFER_CAP);
}
