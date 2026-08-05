import { create } from "zustand";
import { ZabbixApi, ZabbixClient } from "@auzui/zabbix-client";
import { tSync } from "../i18n";
import { clearLoginMethod, getLoginMethod, rememberLoginMethod } from "./login-method";
import { attemptSso } from "./sso";

const SESSION_STORAGE_KEY = "auzui-session-token";
const USERNAME_STORAGE_KEY = "auzui-session-username";

/**
 * Minimum distance between two silent Kerberos re-auth attempts. Guards
 * against hammering the KDC/gateway if a freshly minted token is rejected
 * again straight away (Zabbix broken rather than merely expired) — the second
 * failure then falls through to the normal "session expired" path.
 */
export const REAUTH_COOLDOWN_MS = 30_000;

/**
 * Single ZabbixClient/ZabbixApi instance for the whole app. The Vite dev
 * proxy (and the production reverse-proxy, see docs/deployment.md) forward
 * /api_jsonrpc.php to the real Zabbix frontend.
 */
export const zabbixClient = new ZabbixClient({ url: "/api_jsonrpc.php" });
export const zabbixApi = new ZabbixApi(zabbixClient);

interface AuthState {
  token: string | null;
  username: string | null;
  loginError: string | null;
  loggingIn: boolean;
  /** A silent Kerberos re-auth is in flight (see `handleSessionExpired`). */
  reauthenticating: boolean;
  login: (username: string, password: string) => Promise<void>;
  /** Adopts a session token obtained out-of-band (Kerberos/SPNEGO SSO via the gateway). */
  loginWithSso: (token: string, username: string) => void;
  logout: () => void;
  /** Called when a query/mutation detects the session is gone (401 etc). */
  handleSessionExpired: () => void;
}

const storedToken =
  typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SESSION_STORAGE_KEY) : null;
const storedUsername =
  typeof sessionStorage !== "undefined" ? sessionStorage.getItem(USERNAME_STORAGE_KEY) : null;
if (storedToken) zabbixClient.setToken(storedToken);

function persistSession(token: string, username: string) {
  sessionStorage.setItem(SESSION_STORAGE_KEY, token);
  sessionStorage.setItem(USERNAME_STORAGE_KEY, username);
}

function clearPersistedSession() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  sessionStorage.removeItem(USERNAME_STORAGE_KEY);
  zabbixClient.setToken(undefined);
}

let lastReauthAt = 0;

/** Test seam: forget the cooldown so each case starts from a clean slate. */
export function resetReauthCooldown() {
  lastReauthAt = 0;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: storedToken,
  username: storedUsername,
  loginError: null,
  loggingIn: false,
  reauthenticating: false,
  async login(username: string, password: string) {
    set({ loggingIn: true, loginError: null });
    try {
      const token = await zabbixApi.login(username, password);
      persistSession(token, username);
      rememberLoginMethod("password");
      set({ token, username, loggingIn: false });
    } catch (err) {
      set({
        loggingIn: false,
        loginError: err instanceof Error ? err.message : tSync("auth.loginFailed"),
      });
      throw err;
    }
  },
  loginWithSso(token: string, username: string) {
    zabbixClient.setToken(token);
    persistSession(token, username);
    rememberLoginMethod("spnego");
    set({ token, username, loginError: null, loggingIn: false });
  },
  logout() {
    // Best-effort: fire and forget, we clear local state regardless.
    void zabbixApi.logout().catch(() => undefined);
    clearPersistedSession();
    // An explicit sign-out must not be undone by a silent Kerberos re-auth.
    clearLoginMethod();
    set({ token: null, username: null, reauthenticating: false });
  },
  handleSessionExpired() {
    if (get().reauthenticating) return; // a handshake is already running
    // A Kerberos session renews itself transparently: the ticket is still
    // valid, so the gateway can mint a fresh Zabbix session without any user
    // interaction. The stale token stays in place while the handshake runs —
    // clearing it first would bounce the user to the login screen for a
    // fraction of a second and lose the current route.
    const now = Date.now();
    if (getLoginMethod() === "spnego" && now - lastReauthAt >= REAUTH_COOLDOWN_MS) {
      lastReauthAt = now;
      set({ reauthenticating: true });
      void attemptSso({ force: true }).then((result) => {
        if (result) {
          get().loginWithSso(result.token, result.username);
          set({ reauthenticating: false });
          return;
        }
        // No ticket / SPNEGO disabled / gateway down — fall back to the form.
        clearPersistedSession();
        set({
          token: null,
          username: null,
          reauthenticating: false,
          loginError: tSync("auth.sessionExpired"),
        });
      });
      return;
    }
    clearPersistedSession();
    set({ token: null, username: null, loginError: tSync("auth.sessionExpired") });
  },
}));
