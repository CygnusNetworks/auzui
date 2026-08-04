/** Grouping mode for the container list: by Docker host, or by compose stack (Dockge-style). */
export type DockerGroupMode = "host" | "stack";

/** Row vs. card layout — mirrors LaneSection's ViewMode (features/problems). */
export type DockerViewMode = "rows" | "cards";

/** Which resource type the search box queries. "containers" stays local
 * (filters the already-fetched list); the other three hit GET /api/docker/search. */
export type DockerSearchTypeParam = "containers" | "images" | "volumes" | "networks";
export const DOCKER_SEARCH_TYPES: DockerSearchTypeParam[] = ["containers", "images", "volumes", "networks"];

/** Detail-panel tab for a selected container. */
export type DockerDetailTab = "info" | "stats" | "logs";
export const DOCKER_DETAIL_TABS: DockerDetailTab[] = ["info", "stats", "logs"];

/** Shape of the Docker page's URL search params — teilbare Filter-Links (CONTRACT.md section 3). */
export interface DockerSearch {
  /** Free-text filter; meaning depends on `type` (local filter for containers, /search query otherwise). */
  q?: string;
  /** Comma-separated Docker host ids to restrict the fan-out to; absent = all configured hosts. */
  hosts?: string;
  /** Comma-separated state/health/update chips, e.g. "running,unhealthy,outdated". Absent = all. */
  state?: string;
  /** Search-box resource type tab. Absent = "containers" (the default, local-filtered list). */
  type?: DockerSearchTypeParam;
  /** "host" (default) or "stack" grouping of the container list. */
  group?: DockerGroupMode;
  /** "rows" (default) or "cards" layout, mirrors the Problems lane view toggle. */
  view?: DockerViewMode;
  /** Encoded selection for the detail panel: "c:<hostId>:<cid>" (container) or "s:<hostId>:<project>" (stack). */
  sel?: string;
  /**
   * Active tab within the container detail panel. Absent = "info". Named
   * `dtab` (not the more obvious `tab`) because the Topology page already
   * owns a `tab` search param with a disjoint literal union
   * (features/topology/search-params.ts) — TanStack Router types every
   * `search: (prev) => ...` reducer's `prev` against the FULL cross-route
   * search schema, so two routes sharing a key name with incompatible
   * literal types makes ANY page's own reducer fail to typecheck, not just
   * this one. Same collision class the topology file's own comment warns
   * about for `sev`.
   */
  dtab?: DockerDetailTab;
  /** "1" = live log poll is on. Absent/"0" = off (the default; historical range is shown). */
  live?: string;
}

export function validateDockerSearch(search: Record<string, unknown>): DockerSearch {
  const result: DockerSearch = {};
  if (typeof search.q === "string") result.q = search.q;
  if (typeof search.hosts === "string") result.hosts = search.hosts;
  if (typeof search.state === "string") result.state = search.state;
  if (typeof search.type === "string" && (DOCKER_SEARCH_TYPES as string[]).includes(search.type)) {
    result.type = search.type as DockerSearchTypeParam;
  }
  if (search.group === "stack" || search.group === "host") result.group = search.group;
  if (search.view === "cards" || search.view === "rows") result.view = search.view;
  if (typeof search.sel === "string") result.sel = search.sel;
  if (typeof search.dtab === "string" && (DOCKER_DETAIL_TABS as string[]).includes(search.dtab)) {
    result.dtab = search.dtab as DockerDetailTab;
  }
  if (search.live === "1") result.live = "1";
  return result;
}

/** Parses the `?hosts=` CSV param into a list of host ids. */
export function parseHostsParam(hosts: string | undefined): string[] {
  return hosts
    ? hosts
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean)
    : [];
}

/** Encodes a host id list back into the `hosts` URL param value; empty list clears it. */
export function hostsToSearchValue(hostIds: string[]): string | undefined {
  return hostIds.length > 0 ? hostIds.join(",") : undefined;
}

/** Parses the `?state=` CSV param into a set of active state/health/update chip ids. */
export function parseStateParam(state: string | undefined): Set<string> {
  return new Set(
    state
      ? state
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );
}

/** Encodes the active chip set back into the `state` URL param value; empty set clears it. */
export function stateToSearchValue(states: ReadonlySet<string>): string | undefined {
  return states.size > 0 ? [...states].join(",") : undefined;
}

export interface DockerContainerSelection {
  kind: "container";
  hostId: string;
  cid: string;
}

export interface DockerStackSelection {
  kind: "stack";
  hostId: string;
  project: string;
}

export type DockerSelection = DockerContainerSelection | DockerStackSelection;

/** Encodes a container selection into the `sel` URL param value. */
export function encodeContainerSelection(hostId: string, cid: string): string {
  return `c:${hostId}:${cid}`;
}

/** Encodes a stack selection into the `sel` URL param value. */
export function encodeStackSelection(hostId: string, project: string): string {
  return `s:${hostId}:${project}`;
}

/**
 * Decodes the `sel` URL param. `hostId`/`cid`/`project` may themselves
 * contain ":" (Docker ids don't, but compose project names theoretically
 * could), so only the first two separators are significant — everything
 * after the second colon is the id/project.
 */
export function decodeSelection(sel: string | undefined): DockerSelection | undefined {
  if (!sel) return undefined;
  const first = sel.indexOf(":");
  if (first < 0) return undefined;
  const kind = sel.slice(0, first);
  const rest = sel.slice(first + 1);
  const second = rest.indexOf(":");
  if (second < 0) return undefined;
  const hostId = rest.slice(0, second);
  const tail = rest.slice(second + 1);
  if (!hostId || !tail) return undefined;
  if (kind === "c") return { kind: "container", hostId, cid: tail };
  if (kind === "s") return { kind: "stack", hostId, project: tail };
  return undefined;
}
