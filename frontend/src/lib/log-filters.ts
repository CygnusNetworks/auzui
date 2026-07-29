import type { LogFilter, LogFilterField } from "@auzui/logs";

export type LogFilterMode = "include" | "exclude";

/**
 * Include- und Exclude-Filter als ein Paar. Ein `field:value`-Paar darf immer
 * nur auf EINER Seite stehen (gegenseitige Exklusivität, PLAN Aufgabe 2) —
 * die reinen Funktionen hier garantieren das, statt es an jeder Aufrufstelle
 * neu von Hand zu prüfen.
 */
export interface LogFilterState {
  include: LogFilter[];
  exclude: LogFilter[];
}

function isSame(f: LogFilter, field: LogFilterField, value: string): boolean {
  return f.field === field && f.value === value;
}

/** Ob genau dieses `field:value` in der Liste steht. */
export function hasFilter(filters: LogFilter[], field: LogFilterField, value: string): boolean {
  return filters.some((f) => isSame(f, field, value));
}

/**
 * Der aktive Modus für ein `field:value` — `"include"`, `"exclude"` oder
 * `undefined` (kein Filter). Für die farbliche Markierung des Werts in der
 * Logzeile und den aktiven Zustand der Aktions-Buttons.
 */
export function activeFilterMode(
  state: LogFilterState,
  field: LogFilterField,
  value: string,
): LogFilterMode | undefined {
  if (hasFilter(state.include, field, value)) return "include";
  if (hasFilter(state.exclude, field, value)) return "exclude";
  return undefined;
}

/**
 * Setzt/entfernt einen Filter und hält Include/Exclude gegenseitig exklusiv:
 *
 * - Ist der gewählte Modus für `field:value` bereits aktiv → Filter entfernen
 *   (erneuter Klick auf den aktiven Modus = Toggle aus).
 * - Sonst wird `field:value` aus BEIDEN Listen entfernt und im gewählten
 *   Modus neu gesetzt — ein bestehender Include wird also zum Exclude
 *   (und umgekehrt), nie beides gleichzeitig.
 *
 * Reine Funktion: erzeugt neue Arrays, mutiert `state` nicht.
 */
export function toggleFilter(
  state: LogFilterState,
  field: LogFilterField,
  value: string,
  mode: LogFilterMode,
): LogFilterState {
  const alreadyActive = hasFilter(state[mode], field, value);
  const include = state.include.filter((f) => !isSame(f, field, value));
  const exclude = state.exclude.filter((f) => !isSame(f, field, value));
  if (alreadyActive) {
    return { include, exclude };
  }
  if (mode === "include") {
    include.push({ field, value });
  } else {
    exclude.push({ field, value });
  }
  return { include, exclude };
}
