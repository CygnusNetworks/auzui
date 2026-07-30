/**
 * "Zuletzt verwendet" (Vorschlag A) — Serialisierung der letzten Auswahl-Sets
 * für die Rezept-Karten. Reine Funktionen; Persistenz (localStorage) macht der
 * Hook darüber. Key ist nutzergebunden: `auzui-metrics-recent:<username>`.
 */

export interface RecentSet {
  /** Menschlicher Titel, aus den Serien-Namen abgeleitet. */
  title: string;
  /** Ausgewählte itemids (URL ?items=). */
  items: string[];
  /** Query-Bar-Text (?q=) zum Wiederherstellen. */
  query: string;
  /** Unix-ms des letzten Gebrauchs. */
  ts: number;
}

/** Wie viele Sets maximal gespeichert werden (angezeigt werden i. d. R. die letzten 3). */
export const MAX_RECENT_SETS = 6;

export function recentSetsKey(username: string | null | undefined): string {
  return `auzui-metrics-recent:${username ?? "anon"}`;
}

/** Baut einen Titel aus den Serien-Namen: erste 2 Namen + "+N". */
export function buildRecentSetTitle(seriesLabels: string[]): string {
  const labels = seriesLabels.filter((l) => l.trim().length > 0);
  if (labels.length === 0) return "";
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

function isRecentSet(value: unknown): value is RecentSet {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === "string" &&
    Array.isArray(v.items) &&
    v.items.every((i) => typeof i === "string") &&
    typeof v.query === "string" &&
    typeof v.ts === "number"
  );
}

/** Defensiv: parst JSON aus localStorage in eine Liste gültiger Sets (kaputte Einträge fallen raus). */
export function parseRecentSets(json: string | null | undefined): RecentSet[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentSet);
  } catch {
    return [];
  }
}

export function serializeRecentSets(sets: RecentSet[]): string {
  return JSON.stringify(sets);
}

/** Identität eines Sets = sortierte itemids. */
function setSignature(items: string[]): string {
  return [...items].sort().join(",");
}

/**
 * Fügt ein neues Set vorne ein, entfernt ein vorhandenes mit gleicher
 * itemid-Signatur (Dedupe) und kappt auf MAX_RECENT_SETS. Leere Sets
 * (keine items) werden ignoriert — es wird die Eingabeliste zurückgegeben.
 */
export function addRecentSet(existing: RecentSet[], next: RecentSet): RecentSet[] {
  if (next.items.length === 0) return existing;
  const sig = setSignature(next.items);
  const withoutDup = existing.filter((s) => setSignature(s.items) !== sig);
  return [next, ...withoutDup].slice(0, MAX_RECENT_SETS);
}
