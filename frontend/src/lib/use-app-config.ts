import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "./auth/store";

export interface AppConfig {
  zabbix_ui_url: string;
  version: string;
  commit: string;
}

/** Deploy-time config from the gateway (Zabbix-UI-Link, Build-Version). */
export function useAppConfig() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["app-config"],
    queryFn: async (): Promise<AppConfig> => {
      const res = await fetch("/api/config", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) throw new Error(`config: HTTP ${res.status}`);
      return (await res.json()) as AppConfig;
    },
    enabled: Boolean(token),
    staleTime: Infinity,
    retry: 1,
  });
}

/** Build-time version baked into the bundle (fallback when the gateway has none). */
export const BUNDLE_VERSION: string =
  (import.meta.env.VITE_APP_VERSION as string | undefined) || "dev";
