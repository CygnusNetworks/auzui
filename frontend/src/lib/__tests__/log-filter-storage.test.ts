import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLogFilters,
  hasStoredValues,
  readLogFilters,
  writeLogFilters,
} from "../log-filter-storage";

// jsdom in dieser Vitest-Konfiguration stellt kein localStorage bereit — ein
// schlanker In-Memory-Stub genügt (das Modul selbst kapselt jeden Zugriff in
// try/catch, funktioniert also auch, wenn localStorage ganz fehlt).
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

beforeEach(() => {
  installMemoryStorage();
});

describe("log-filter-storage: per-user persistence", () => {
  it("round-trips filters for a user", () => {
    writeLogFilters("alice", { stream: "s1", host: "web01", include: "facility:local0" });
    expect(readLogFilters("alice")).toEqual({
      stream: "s1",
      host: "web01",
      include: "facility:local0",
      exclude: undefined,
    });
  });

  it("keeps different users separate", () => {
    writeLogFilters("alice", { host: "web01" });
    writeLogFilters("bob", { host: "db02" });
    expect(readLogFilters("alice")?.host).toBe("web01");
    expect(readLogFilters("bob")?.host).toBe("db02");
  });

  it("returns null when nothing is stored", () => {
    expect(readLogFilters("nobody")).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    localStorage.setItem("auzui-log-filters:broken", "{not json");
    expect(readLogFilters("broken")).toBeNull();
  });

  it("clear removes the stored filters", () => {
    writeLogFilters("alice", { host: "web01" });
    clearLogFilters("alice");
    expect(readLogFilters("alice")).toBeNull();
  });

  it("hasStoredValues detects whether anything is set", () => {
    expect(hasStoredValues({})).toBe(false);
    expect(hasStoredValues({ include: "facility:local0" })).toBe(true);
    expect(hasStoredValues({ stream: "s1" })).toBe(true);
  });
});
