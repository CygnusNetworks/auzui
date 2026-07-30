import type { LogStream } from "@auzui/logs";

/**
 * Reihenfolge der Streams im Stream-Picker der Logs-Seite. Bei mehreren
 * Graylog-Servern liefert der Gateway die Streams als Union server-blockweise
 * ("All messages [graylog]", "All system events [graylog-a]", …) — gleichnamige
 * Streams verschiedener Server stehen dann wild gemischt. Der Sortier-Switch
 * bietet zwei Ordnungen:
 *
 * - "name" (Default): alphabetisch nach Stream-Titel, gleichnamige Streams
 *   verschiedener Server stehen direkt untereinander (Tiebreak: Server-Label);
 * - "server": server-blockweise (nach Server-Label, darin nach Titel) — die
 *   frühere/heutige Gruppierung.
 */
export type StreamSort = "name" | "server";

export const STREAM_SORTS: readonly StreamSort[] = ["name", "server"];

export function isStreamSort(v: unknown): v is StreamSort {
  return v === "name" || v === "server";
}

function cmp(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

/** Reine, stabile Sortierfunktion (mutiert die Eingabe nicht). */
export function sortLogStreams(streams: readonly LogStream[], mode: StreamSort): LogStream[] {
  const byName = (a: LogStream, b: LogStream) =>
    cmp(a.title, b.title) || cmp(a.serverLabel ?? "", b.serverLabel ?? "") || cmp(a.id, b.id);
  const byServer = (a: LogStream, b: LogStream) =>
    cmp(a.serverLabel ?? "", b.serverLabel ?? "") || cmp(a.title, b.title) || cmp(a.id, b.id);
  return [...streams].sort(mode === "server" ? byServer : byName);
}
