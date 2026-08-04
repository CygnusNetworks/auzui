import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { GatewayDockerSource, NullDockerSource, type DockerSource } from "@auzui/docker";
import { useAuthStore } from "./auth/store";

/**
 * Whether the auzui-gateway has any Docker host configured — queried once
 * and cached for the app's lifetime (staleTime: Infinity), same pattern as
 * useLogsEnabled (use-logs.ts) / useInfluxEnabled (use-timeseries.ts).
 */
export function useDockerEnabled() {
  return useQuery({
    queryKey: ["docker-gateway-status"],
    queryFn: () => GatewayDockerSource.status(),
    staleTime: Infinity,
    retry: 1,
  });
}

/** The active DockerSource — NullDockerSource (no-op) until the gateway confirms Docker is enabled. */
export function useDockerSource(): DockerSource {
  const token = useAuthStore((s) => s.token);
  const { data: enabled } = useDockerEnabled();

  return useMemo(
    () =>
      enabled ? new GatewayDockerSource({ getToken: () => token ?? undefined }) : new NullDockerSource(),
    [enabled, token],
  );
}

/**
 * The configured Docker hosts + engine summary (GET /api/docker/hosts).
 * Cached briefly server-side (docker_cache_ttl) so this polls lightly.
 */
export function useDockerHosts(source: DockerSource) {
  return useQuery({
    queryKey: ["docker-hosts"],
    queryFn: ({ signal }) => source.hosts(signal),
    enabled: source.enabled,
    staleTime: 10_000,
  });
}

/**
 * Whether the current session may perform write actions (start/stop/
 * restart/pull_recreate/compose). Drives whether the UI even shows action
 * buttons — the gateway enforces the same check server-side regardless, so
 * this is a display-only optimization, not a security boundary.
 */
export function useDockerPermissions(source: DockerSource) {
  return useQuery({
    queryKey: ["docker-permissions"],
    queryFn: ({ signal }) => source.permissions(signal),
    enabled: source.enabled,
    staleTime: 60_000,
  });
}
