/**
 * Level-Chips für den Graylog Stream-Browser (PLAN.md Abschnitt H) — reine
 * Query-Bau-Helfer, kein Netzwerkzugriff. Syslog-Level 0-7: 0-3 err, 4 warn,
 * 5 notice, 6 info, 7 debug.
 */
import type { LogMessage } from "@auzui/logs";

export interface LogLevelChip {
  /** Schwellwert für "level:<=N" — das schlechteste Level, das der Chip noch einschließt. */
  maxLevel: number;
  label: string;
}

export const LOG_LEVEL_CHIPS: LogLevelChip[] = [
  { maxLevel: 3, label: "err" },
  { maxLevel: 4, label: "warn" },
  { maxLevel: 5, label: "notice" },
  { maxLevel: 6, label: "info" },
  { maxLevel: 7, label: "debug" },
];

/** Hängt "level:<=N" an die bestehende Lucene-Query an (AND-verknüpft, falls schon Text vorhanden). */
export function buildLevelQuery(baseQuery: string, maxLevel: number | undefined): string {
  const trimmed = baseQuery.trim();
  if (maxLevel === undefined) return trimmed;
  const clause = `level:<=${maxLevel}`;
  return trimmed ? `${trimmed} AND ${clause}` : clause;
}

/** Level-Chips nur zeigen, wenn das Feld in den aktuellen Ergebnissen überhaupt vorkommt. */
export function messagesHaveLevelField(messages: Pick<LogMessage, "level">[]): boolean {
  return messages.some((m) => m.level !== undefined);
}
