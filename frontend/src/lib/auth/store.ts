import { create } from "zustand";
import { ZabbixApi, ZabbixClient } from "@auzui/zabbix-client";

const SESSION_STORAGE_KEY = "auzui-session-token";

/**
 * Single ZabbixClient/ZabbixApi instance for the whole app. The Vite dev
 * proxy (and the production reverse-proxy, see docs/deployment.md) forward
 * /api_jsonrpc.php to the real Zabbix frontend.
 */
export const zabbixClient = new ZabbixClient({ url: "/api_jsonrpc.php" });
export const zabbixApi = new ZabbixApi(zabbixClient);

interface AuthState {
  token: string | null;
  loginError: string | null;
  loggingIn: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** Called when a query/mutation detects the session is gone (401 etc). */
  handleSessionExpired: () => void;
}

const storedToken =
  typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SESSION_STORAGE_KEY) : null;
if (storedToken) zabbixClient.setToken(storedToken);

export const useAuthStore = create<AuthState>((set) => ({
  token: storedToken,
  loginError: null,
  loggingIn: false,
  async login(username: string, password: string) {
    set({ loggingIn: true, loginError: null });
    try {
      const token = await zabbixApi.login(username, password);
      sessionStorage.setItem(SESSION_STORAGE_KEY, token);
      set({ token, loggingIn: false });
    } catch (err) {
      set({
        loggingIn: false,
        loginError: err instanceof Error ? err.message : "Login fehlgeschlagen",
      });
      throw err;
    }
  },
  logout() {
    // Best-effort: fire and forget, we clear local state regardless.
    void zabbixApi.logout().catch(() => undefined);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    zabbixClient.setToken(undefined);
    set({ token: null });
  },
  handleSessionExpired() {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    zabbixClient.setToken(undefined);
    set({ token: null, loginError: "Sitzung abgelaufen — bitte erneut anmelden." });
  },
}));
