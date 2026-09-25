import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/sso", () => ({
  attemptSso: vi.fn(),
  isSsoAttempted: vi.fn(() => false),
  isSsoSuppressed: vi.fn(() => false),
  markSsoSuppressed: vi.fn(),
}));

import { attemptSso } from "../auth/sso";
import { rememberLoginMethod } from "../auth/login-method";
import { resetReauthCooldown, useAuthStore, zabbixClient } from "../auth/store";
import { queryClient } from "../query-client";

const attemptSsoMock = vi.mocked(attemptSso);

/** Lets the `.then()` chain inside handleSessionExpired settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// jsdom in dieser Vitest-Konfiguration stellt kein localStorage bereit — gleicher
// In-Memory-Stub wie in store.test.ts.
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

/** Seeds the shared queryClient cache the way a real "hosts" query would. */
async function seedCache() {
  await queryClient.fetchQuery({
    queryKey: ["hosts"],
    queryFn: () => Promise.resolve(["host-a"]),
  });
}

describe("query cache identity isolation", () => {
  beforeEach(() => {
    sessionStorage.clear();
    installMemoryLocalStorage();
    resetReauthCooldown();
    attemptSsoMock.mockReset();
    queryClient.clear();
    useAuthStore.setState({
      token: "admin-token",
      username: "admin",
      loginError: null,
      loggingIn: false,
      reauthenticating: false,
    });
    zabbixClient.setToken("admin-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears the cache on logout", async () => {
    await seedCache();
    expect(queryClient.getQueryData(["hosts"])).toEqual(["host-a"]);

    useAuthStore.getState().logout();

    expect(queryClient.getQueryData(["hosts"])).toBeUndefined();
  });

  it("cancels in-flight queries and clears the cache on logout", async () => {
    await seedCache();
    const cancelSpy = vi.spyOn(queryClient, "cancelQueries");

    useAuthStore.getState().logout();

    expect(cancelSpy).toHaveBeenCalled();
    expect(queryClient.getQueryData(["hosts"])).toBeUndefined();
  });

  it("clears the cache when a different user logs in", async () => {
    await seedCache();

    useAuthStore.getState().loginWithSso("restricted-token", "restricted-user");

    expect(queryClient.getQueryData(["hosts"])).toBeUndefined();
  });

  it("keeps the cache during a silent same-user Kerberos renewal", async () => {
    rememberLoginMethod("spnego");
    await seedCache();
    attemptSsoMock.mockResolvedValue({ token: "fresh-admin-token", username: "admin" });

    useAuthStore.getState().handleSessionExpired();
    await flush();

    expect(useAuthStore.getState()).toMatchObject({
      token: "fresh-admin-token",
      username: "admin",
    });
    expect(queryClient.getQueryData(["hosts"])).toEqual(["host-a"]);
  });

  it("clears the cache when the Kerberos handshake fails and falls back to the login form", async () => {
    rememberLoginMethod("spnego");
    await seedCache();
    attemptSsoMock.mockResolvedValue(null);

    useAuthStore.getState().handleSessionExpired();
    await flush();

    expect(useAuthStore.getState().token).toBeNull();
    expect(queryClient.getQueryData(["hosts"])).toBeUndefined();
  });

  it("clears the cache when the session expires with no remembered login method", async () => {
    await seedCache();

    useAuthStore.getState().handleSessionExpired();

    expect(useAuthStore.getState().token).toBeNull();
    expect(queryClient.getQueryData(["hosts"])).toBeUndefined();
  });
});
