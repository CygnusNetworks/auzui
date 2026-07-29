import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { GraylogSource, NullLogSource, type LogSource } from "@auzui/logs";
import { useAuthStore } from "./auth/store";

/**
 * Whether the auzui-gateway has Graylog configured — queried once and cached
 * for the app's lifetime (staleTime: Infinity), same pattern as
 * useInfluxEnabled in use-timeseries.ts.
 */
export function useLogsEnabled() {
  return useQuery({
    queryKey: ["logs-gateway-status"],
    queryFn: () => GraylogSource.status(),
    staleTime: Infinity,
    retry: 1,
  });
}

/** The active LogSource — NullLogSource (no-op) until the gateway confirms Graylog is enabled. */
export function useLogSource(): LogSource {
  const token = useAuthStore((s) => s.token);
  const { data: enabled } = useLogsEnabled();

  return useMemo(
    () => (enabled ? new GraylogSource({ getToken: () => token ?? undefined }) : new NullLogSource()),
    [enabled, token],
  );
}
