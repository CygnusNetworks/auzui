import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../sso", () => ({
  attemptSso: vi.fn(),
  isSsoAttempted: vi.fn(() => false),
  isSsoSuppressed: vi.fn(() => false),
  markSsoSuppressed: vi.fn(),
}));

import { attemptSso } from "../sso";
import { rememberLoginMethod } from "../login-method";
import { resetReauthCooldown, useAuthStore, zabbixClient } from "../store";

const attemptSsoMock = vi.mocked(attemptSso);

/** Lets the `.then()` chain inside handleSessionExpired settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// jsdom in dieser Vitest-Konfiguration stellt kein localStorage bereit — gleicher
// In-Memory-Stub wie in log-filter-storage.test.ts.
function installMemoryLocalStorage() {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => store.delete(k),
    setItem: (k: string, v: string) => store.set(k, String(v)),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: mock,
    configurable: true,
    writable: true,
  });
}

describe("handleSessionExpired", () => {
  beforeEach(() => {
    sessionStorage.clear();
    installMemoryLocalStorage();
    resetReauthCooldown();
    attemptSsoMock.mockReset();
    useAuthStore.setState({
      token: "dead-token",
      username: "alice",
      loginError: null,
      reauthenticating: false,
    });
    zabbixClient.setToken("dead-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("silently re-authenticates a Kerberos session and keeps the user signed in", async () => {
    rememberLoginMethod("spnego");
    attemptSsoMock.mockResolvedValue({ token: "fresh-token", username: "alice" });

    useAuthStore.getState().handleSessionExpired();

    // The stale token stays put while the handshake runs, so the router does
    // not bounce the user to /login mid-flight.
    expect(useAuthStore.getState().reauthenticating).toBe(true);
    expect(useAuthStore.getState().token).toBe("dead-token");

    await flush();

    expect(attemptSsoMock).toHaveBeenCalledWith({ force: true });
    expect(useAuthStore.getState()).toMatchObject({
      token: "fresh-token",
      username: "alice",
      loginError: null,
      reauthenticating: false,
    });
    expect(sessionStorage.getItem("auzui-session-token")).toBe("fresh-token");
  });

  it("falls back to the login form when the Kerberos handshake fails", async () => {
    rememberLoginMethod("spnego");
    attemptSsoMock.mockResolvedValue(null);

    useAuthStore.getState().handleSessionExpired();
    await flush();

    expect(useAuthStore.getState()).toMatchObject({
      token: null,
      username: null,
      reauthenticating: false,
    });
    expect(useAuthStore.getState().loginError).toBeTruthy();
    expect(sessionStorage.getItem("auzui-session-token")).toBeNull();
  });

  it("does not attempt SSO after a password login", async () => {
    rememberLoginMethod("password");

    useAuthStore.getState().handleSessionExpired();
    await flush();

    expect(attemptSsoMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it("does not attempt SSO when no login method was remembered", async () => {
    useAuthStore.getState().handleSessionExpired();
    await flush();

    expect(attemptSsoMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it("ignores repeat calls while a handshake is in flight", async () => {
    rememberLoginMethod("spnego");
    attemptSsoMock.mockResolvedValue({ token: "fresh-token", username: "alice" });

    useAuthStore.getState().handleSessionExpired();
    useAuthStore.getState().handleSessionExpired();
    useAuthStore.getState().handleSessionExpired();
    await flush();

    expect(attemptSsoMock).toHaveBeenCalledTimes(1);
  });

  it("only re-auths once per cooldown window, then expires normally", async () => {
    rememberLoginMethod("spnego");
    attemptSsoMock.mockResolvedValue({ token: "fresh-token", username: "alice" });

    useAuthStore.getState().handleSessionExpired();
    await flush();
    expect(useAuthStore.getState().token).toBe("fresh-token");

    // The fresh token is rejected too — no second handshake inside the window.
    useAuthStore.getState().handleSessionExpired();
    await flush();

    expect(attemptSsoMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().loginError).toBeTruthy();
  });
});

describe("login method bookkeeping", () => {
  beforeEach(() => {
    sessionStorage.clear();
    installMemoryLocalStorage();
    resetReauthCooldown();
    attemptSsoMock.mockReset();
  });

  it("logout clears the remembered method so nothing re-auths silently", async () => {
    useAuthStore.getState().loginWithSso("sso-token", "alice");
    expect(localStorage.getItem("auzui-login-method")).toBe("spnego");

    useAuthStore.getState().logout();
    expect(localStorage.getItem("auzui-login-method")).toBeNull();

    useAuthStore.getState().handleSessionExpired();
    await flush();
    expect(attemptSsoMock).not.toHaveBeenCalled();
  });
});
