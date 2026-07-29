/**
 * Per-User-Persistenz der Log-Filter über Sessions (PLAN Aufgabe 3). Gespeichert
 * werden die URL-Filter-Parameter der Logs-Seite (Stream, Hosts, Include,
 * Exclude) als JSON unter `auzui-log-filters:<username>`, damit ein Nutzer
 * seine Filter beim nächsten Öffnen von /logs wiederfindet. URL-Parameter
 * haben immer Vorrang und überschreiben den Speicher.
 */

const KEY_PREFIX = "auzui-log-filters:";

/** Teilmenge von LogsSearch, die dauerhaft gespeichert wird. */
export interface StoredLogFilters {
  stream?: string;
  host?: string;
  include?: string;
  exclude?: string;
}

function storageKey(username: string): string {
  return `${KEY_PREFIX}${username}`;
}

/** Ob überhaupt ein persistierenswerter Wert gesetzt ist (leere Objekte nicht speichern). */
export function hasStoredValues(filters: StoredLogFilters): boolean {
  return Boolean(filters.stream || filters.host || filters.include || filters.exclude);
}

export function readLogFilters(username: string): StoredLogFilters | null {
  try {
    const raw = localStorage.getItem(storageKey(username));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    const result: StoredLogFilters = {
      stream: typeof obj.stream === "string" ? obj.stream : undefined,
      host: typeof obj.host === "string" ? obj.host : undefined,
      include: typeof obj.include === "string" ? obj.include : undefined,
      exclude: typeof obj.exclude === "string" ? obj.exclude : undefined,
    };
    return result;
  } catch {
    return null;
  }
}

export function writeLogFilters(username: string, filters: StoredLogFilters): void {
  try {
    localStorage.setItem(storageKey(username), JSON.stringify(filters));
  } catch {
    // Speicher voll/nicht verfügbar — In-Memory-Filter funktionieren weiter.
  }
}

export function clearLogFilters(username: string): void {
  try {
    localStorage.removeItem(storageKey(username));
  } catch {
    // ignorieren
  }
}
