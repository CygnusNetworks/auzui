import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { DockerSearchType, DockerSource } from "@auzui/docker";
import { useDebouncedValue } from "../../lib/use-debounced-value";

const CONTAINERS_POLL_MS = 30_000;
const BULK_STATS_POLL_MS = 10_000;
const UPDATES_POLL_MS = 5 * 60_000;
const SEARCH_DEBOUNCE_MS = 400;

/** All configured containers across the given hosts (empty = all hosts). Polls
 * every 30s (CONTRACT.md/plan Phase 3), same cadence regardless of grouping —
 * grouping-by-stack is a pure client-side reshape of this same list. */
export function useDockerContainers(source: DockerSource, hostIds: string[]) {
  return useQuery({
    queryKey: ["docker-containers", hostIds],
    queryFn: ({ signal }) => source.containers({ hostIds: hostIds.length > 0 ? hostIds : undefined, signal }),
    enabled: source.enabled,
    staleTime: 15_000,
    refetchInterval: CONTAINERS_POLL_MS,
    placeholderData: keepPreviousData,
  });
}

/**
 * Bulk CPU/Mem stats, but ONLY for the container ids actually visible in the
 * current filtered/grouped view — the gateway fans this out per-container
 * per-host, so polling every configured container regardless of scroll
 * position or active filters would be wasteful (plan D5 / CONTRACT 2.2
 * stats_bulk). `targets` is expected to already be host-scoped and
 * pre-filtered by the caller.
 */
export function useDockerBulkStats(source: DockerSource, targets: Record<string, string[]>) {
  const hasTargets = Object.values(targets).some((ids) => ids.length > 0);
  // Stable key so an equivalent-but-freshly-created targets object doesn't
  // retrigger the query every render.
  const key = useMemo(
    () =>
      Object.entries(targets)
        .filter(([, ids]) => ids.length > 0)
        .map(([hostId, ids]) => `${hostId}:${[...ids].sort().join(",")}`)
        .sort()
        .join("|"),
    [targets],
  );

  return useQuery({
    queryKey: ["docker-bulk-stats", key],
    queryFn: ({ signal }) => source.bulkStats(targets, signal),
    enabled: source.enabled && hasTargets,
    staleTime: 5_000,
    refetchInterval: hasTargets ? BULK_STATS_POLL_MS : false,
    placeholderData: keepPreviousData,
  });
}

/** Update-availability status per container, refreshed every 5 minutes (registry
 * digest checks are expensive/rate-limited server-side — see docker_updates.py TTL). */
export function useDockerUpdates(source: DockerSource, hostIds: string[]) {
  return useQuery({
    queryKey: ["docker-updates", hostIds],
    queryFn: ({ signal }) => source.updates(hostIds.length > 0 ? hostIds : undefined, signal),
    enabled: source.enabled,
    staleTime: 60_000,
    refetchInterval: UPDATES_POLL_MS,
    placeholderData: keepPreviousData,
  });
}

/** Debounced cross-type search (images/volumes/networks; containers stay a
 * local filter over useDockerContainers' list — see DockerPage). */
export function useDockerSearch(
  source: DockerSource,
  q: string,
  types: DockerSearchType[],
  hostIds: string[],
) {
  const debouncedQ = useDebouncedValue(q, SEARCH_DEBOUNCE_MS);
  return useQuery({
    queryKey: ["docker-search", debouncedQ, types, hostIds],
    queryFn: ({ signal }) =>
      source.search({ q: debouncedQ, types, hostIds: hostIds.length > 0 ? hostIds : undefined, signal }),
    enabled: source.enabled && debouncedQ.trim().length > 0,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

/** Inspect payload for the detail panel's Info tab. */
export function useDockerInspect(source: DockerSource, hostId: string | undefined, cid: string | undefined) {
  return useQuery({
    queryKey: ["docker-inspect", hostId, cid],
    queryFn: ({ signal }) => source.inspect(hostId!, cid!, signal),
    enabled: source.enabled && !!hostId && !!cid,
    staleTime: 10_000,
  });
}

/** Compose stacks for one host (StackPanel + group=stack view's per-host compose-file/actions). */
export function useDockerStacks(source: DockerSource, hostId: string | undefined) {
  return useQuery({
    queryKey: ["docker-stacks", hostId],
    queryFn: ({ signal }) => source.stacks(hostId!, signal),
    enabled: source.enabled && !!hostId,
    staleTime: 15_000,
  });
}

/**
 * Read-only compose-file content for the StackPanel. `composeCapable` gates
 * the fetch on the host actually supporting compose (StackPanel itself is
 * only ever mounted while open, DetailPanel-style, so no separate "is the
 * panel open" flag is needed) — a compose file rarely changes, so a
 * generous staleTime avoids re-fetching it (and re-running `cat` over SSH
 * on the gateway) on every panel remount.
 */
export function useDockerStackConfig(
  source: DockerSource,
  hostId: string | undefined,
  project: string | undefined,
  composeCapable: boolean,
) {
  return useQuery({
    queryKey: ["docker-stack-config", hostId, project],
    queryFn: ({ signal }) => source.stackConfig(hostId!, project!, signal),
    enabled: source.enabled && composeCapable && !!hostId && !!project,
    staleTime: 10 * 60_000,
    retry: false,
  });
}
