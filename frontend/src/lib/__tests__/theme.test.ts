import { beforeEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY, getThemeMode, initTheme, setThemeMode, subscribeThemeMode } from "../theme";

function installMemoryStorage() {
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
  Object.defineProperty(globalThis, "localStorage", { value: mock, configurable: true, writable: true });
}

// jsdom has no matchMedia; this fake lets a test flip the OS preference.
function installSystemTheme(initial: "light" | "dark") {
  let systemLight = initial === "light";
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === "(prefers-color-scheme: light)" ? systemLight : !systemLight;
    },
    media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  })) as unknown as typeof window.matchMedia;
  return (next: "light" | "dark") => {
    systemLight = next === "light";
    listeners.forEach((l) => l());
  };
}

const isDark = () => document.documentElement.classList.contains("dark");

beforeEach(() => {
  installMemoryStorage();
  document.documentElement.classList.remove("dark");
});

describe("theme", () => {
  it("follows the OS when nothing is stored", () => {
    installSystemTheme("light");
    initTheme();
    expect(getThemeMode()).toBe("system");
    expect(isDark()).toBe(false);
  });

  it("switches live when the OS preference changes in system mode", () => {
    const setSystem = installSystemTheme("light");
    initTheme();
    setSystem("dark");
    expect(isDark()).toBe(true);
    setSystem("light");
    expect(isDark()).toBe(false);
  });

  it("keeps an explicit choice when the OS preference changes", () => {
    const setSystem = installSystemTheme("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    initTheme();
    expect(getThemeMode()).toBe("light");
    setSystem("light");
    setSystem("dark");
    expect(isDark()).toBe(false);
  });

  it("persists explicit modes and clears storage for system", () => {
    installSystemTheme("light");
    initTheme();
    setThemeMode("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(isDark()).toBe(true);
    setThemeMode("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(isDark()).toBe(false);
  });

  it("notifies subscribers on mode changes", () => {
    installSystemTheme("light");
    initTheme();
    let calls = 0;
    const unsubscribe = subscribeThemeMode(() => calls++);
    setThemeMode("dark");
    unsubscribe();
    setThemeMode("light");
    expect(calls).toBe(1);
  });
});
