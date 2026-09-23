import { useSyncExternalStore } from "react";

export const THEME_STORAGE_KEY = "auzui-theme";

export type ThemeMode = "light" | "dark" | "system";

// Dark first: "system" only resolves to light when the OS explicitly asks for it.
const LIGHT_QUERY = "(prefers-color-scheme: light)";

let mode: ThemeMode = "system";
let systemQuery: MediaQueryList | null = null;
const listeners = new Set<() => void>();

function readStoredMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "dark" || stored === "light" ? stored : "system";
}

function applyResolvedTheme(): void {
  const dark = mode === "system" ? !window.matchMedia(LIGHT_QUERY).matches : mode === "dark";
  document.documentElement.classList.toggle("dark", dark);
}

function onSystemChange(): void {
  if (mode === "system") applyResolvedTheme();
}

export function initTheme(): void {
  mode = readStoredMode();
  applyResolvedTheme();
  systemQuery?.removeEventListener("change", onSystemChange);
  systemQuery = window.matchMedia(LIGHT_QUERY);
  systemQuery.addEventListener("change", onSystemChange);
}

export function getThemeMode(): ThemeMode {
  return mode;
}

export function setThemeMode(next: ThemeMode): void {
  mode = next;
  if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
  else localStorage.setItem(THEME_STORAGE_KEY, next);
  applyResolvedTheme();
  listeners.forEach((l) => l());
}

export function subscribeThemeMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeThemeMode, getThemeMode);
}
