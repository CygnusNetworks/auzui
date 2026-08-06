# Aktueller Wert (Threshold-Chip) in Problems

Status: approved
Date: 2026-08-06

## Problem

Im DetailPanel und in der Problems-Liste sieht man den Trigger-Ausdruck
(z. B. `avg(/host/synoSystem.temperature,#4)>60`), aber nicht den aktuellen
Wert des Items, der das Problem ausgelöst hat. Um den Wert zu sehen, muss man
in die alte Zabbix-UI wechseln oder auf den Host-Deep-Dive springen.

Der Wert steckt bereits in der bestehenden `trigger.get`-Antwort
(`selectItems: "extend"`, siehe `frontend/src/features/problems/use-problems.ts`)
— der Frontend-Typ pickt aktuell nur `itemid | key_ | name | value_type` heraus
und verwirft `lastvalue`, `lastclock`, `units`.

## Ziel

Aktuellen Item-Wert farblich zur Trigger-Schwelle kodiert anzeigen — sowohl im
DetailPanel als auch in der Problem-Liste (Zeilen- und Karten-Ansicht) — ohne
zusätzlichen Netzwerk-Request und ohne den bestehenden 30s-Problems-Poll zu
verändern.

## Nicht-Ziele

- Kein Live-Polling schneller als der bestehende Problems-Poll.
- Keine Auswertung zusammengesetzter Trigger-Ausdrücke (`and`/`or`, mehrere
  Vergleiche) — dafür gibt es einen expliziten "unknown"-Zustand statt einer
  geratenen Einschätzung.
- Keine Änderung an der Sparkline-Logik (`use-sparklines.ts`) — das ist ein
  separater, bereits bestehender Mechanismus mit eigenem History-Request.

## Design

### Datenschicht

**`packages/zabbix-client/src/types.ts`** — `ZabbixTrigger.items` von

```ts
items?: Pick<ZabbixItem, "itemid" | "key_" | "name" | "value_type">[];
```

auf zusätzlich `lastvalue`, `lastclock`, `units` erweitern:

```ts
items?: Pick<ZabbixItem, "itemid" | "key_" | "name" | "value_type" | "lastvalue" | "lastclock" | "units">[];
```

Diese Felder kommen bereits vom Server (kein API-Call-Change nötig,
`selectItems: "extend"` liefert sie mit), nur der TS-Typ verwarf sie bisher.

**`frontend/src/lib/problems.ts`** — `EnrichedProblem` um folgende optionale
Felder ergänzen, befüllt aus demselben `numericItem` wie `itemId`/`itemValueType`
in `joinProblemsWithTriggers`:

```ts
itemLastValue?: string;
itemLastClock?: string;
itemUnits?: string;
```

Neue reine Funktion `parseThreshold`:

```ts
export type ThresholdOp = ">" | ">=" | "<" | "<=";

/**
 * Extrahiert Vergleichsoperator + Schwelle aus einem EINFACHEN,
 * einbedingten Trigger-Ausdruck (z. B. "avg(/host/key,#4)>60"). Liefert
 * undefined bei zusammengesetzten Ausdrücken (and/or), mehreren
 * Vergleichen, oder einem nicht rein numerischen rechten Operanden
 * (z. B. Zabbix-Suffixe wie "1G") — für diese Fälle ist "über/unter
 * Schwelle" nicht eindeutig genug für eine farbliche Aussage.
 */
export function parseThreshold(
  expression: string | undefined,
): { op: ThresholdOp; value: number } | undefined;
```

Parsing-Regel: genau ein Vorkommen von `>=`, `<=`, `>` oder `<` im gesamten
Ausdruck, kein `and`/`or` (case-insensitive, als eigenständiges Wort), rechter
Operand matcht `^-?\d+(\.\d+)?$` nach Trim.

Neue reine Funktion `valueBreachState`:

```ts
export type ValueBreachState = "breach" | "ok" | "unknown";

/**
 * Vergleicht den aktuellen Item-Wert eines Problems mit der aus dem
 * Trigger-Ausdruck geparsten Schwelle. "unknown" wenn der Item-Typ nicht
 * numerisch ist, lastvalue fehlt/nicht parsebar ist, oder die Schwelle
 * nicht eindeutig bestimmbar ist (siehe parseThreshold).
 */
export function valueBreachState(problem: EnrichedProblem): ValueBreachState;
```

`breach` = aktueller Wert erfüllt den Vergleich (z. B. `63.4 > 60` bei
`avg(...)>60`) — semantisch "Grund, warum das Problem aktiv ist". `ok` =
Vergleich nicht (mehr) erfüllt (z. B. bei einem flappenden Trigger, dessen
Event noch offen ist, aber der letzte Poll wieder unter der Schwelle lag).

### Komponente `ValueChip`

Neue Datei `frontend/src/features/problems/ValueChip.tsx`, genutzt von
`DetailPanel`, `ProblemRow` und `ProblemCard`.

```ts
function ValueChip({ problem }: { problem: EnrichedProblem }): JSX.Element | null
```

- Rendert `null`, wenn kein numerischer, parsebarer aktueller Wert vorliegt
  (kein `itemLastValue`, `itemValueType` nicht `"0"`/`"3"`, oder
  `Number.isFinite` schlägt fehl) — Text-/Log-Items zeigen also keinen leeren
  oder irreführenden Chip, konsistent mit `shouldShowSparkline`s Gate.
- Formatiert den Wert über das vorhandene `formatUnitValue(value, units, 1, locale)`
  (gleiche Quelle wie Latest-Data-Seite).
- Farbe/Pfeil aus `valueBreachState(problem)`, unter Wiederverwendung der
  bestehenden Severity-Farbtokens aus `frontend/src/index.css`
  (`--color-sev-high` / `--color-sev-ok`, mit Dark-Mode-Varianten bereits
  vorhanden — keine neuen Farbtokens nötig):
  - `breach`: `text-sev-high`/`bg-sev-high/15`-Klassen (wie bei der
    Severity-Badge), Pfeil ▲ bei `>`/`>=`, ▼ bei `<`/`<=`.
  - `ok`: `text-sev-ok`/`bg-sev-ok/15`-Klassen, Gegenpfeil.
  - `unknown`: neutrales Grau (bestehende `ink-muted`/`surface-3`-Töne), kein Pfeil.
- Visuell eine Pille im Stil der bestehenden Severity-/Suppressed-Badges
  (Mono-Font, `rounded`, `border`, `px-1.5`).

### Platzierung

- **DetailPanel** (`frontend/src/features/problems/DetailPanel.tsx`): `ValueChip`
  direkt unter dem bestehenden Trigger-Ausdruck-Block, plus ein
  "aktualisiert vor …"-Zeitstempel aus `itemLastClock` (gleiches
  `formatAge`-Muster wie das bestehende "seit …").
- **ProblemRow** (`frontend/src/features/problems/LaneSection.tsx`): neue Spalte
  in `ROW_GRID_COLS` für den Chip. Wenn `ValueChip` `null` rendert, bleibt die
  Spalte leer — kein Layoutsprung zwischen Zeilen mit/ohne Wert.
- **ProblemCard**: `ValueChip` in der unteren Zeile neben den Tags, vor
  `StatusChips`.

### i18n

Keine neuen Textstrings nötig für den Chip selbst (Zahl + Einheit + Pfeil sind
sprachneutral). Der "aktualisiert vor …"-Zeitstempel im DetailPanel braucht
einen neuen Key `problems.detailPanel.valueAsOf` (de/en), nach dem Muster von
`problems.detailPanel.since`.

## Edge Cases

| Situation | Verhalten |
|---|---|
| Text-/Log-Item (kein numerischer Wert) | Chip entfällt komplett |
| `lastvalue` fehlt (Item pausiert/nie gepollt) | Chip entfällt |
| Zusammengesetzter Ausdruck (`and`/`or`, mehrere Vergleiche) | Chip zeigt Wert neutral/grau, kein Pfeil |
| Schwelle mit Zabbix-Suffix (z. B. `1G`) | wie oben: neutral/grau |
| Wert numerisch, aber `NaN` nach Parsing | Chip entfällt |

## Testing

- Unit-Tests für `parseThreshold` (einfacher Vergleich, `and`/`or`,
  Suffix-Werte, mehrere Vergleiche) in `frontend/src/lib/__tests__/problems.test.ts`.
- Unit-Tests für `valueBreachState` (breach/ok/unknown-Fälle, inkl. fehlendem
  `lastvalue` und nicht-numerischem Item).
- Component-Test für `ValueChip` (rendert `null`, breach/ok/unknown-Darstellung)
  nach dem Muster von `host-cell.test.tsx`.
- Erweiterung von `LaneSection.test.tsx` um die neue Spalte/den Chip in Zeilen-
  und Kartenansicht.

## Betroffene Dateien

- `packages/zabbix-client/src/types.ts`
- `frontend/src/lib/problems.ts` (+ Tests)
- `frontend/src/features/problems/ValueChip.tsx` (neu, + Test)
- `frontend/src/features/problems/DetailPanel.tsx`
- `frontend/src/features/problems/LaneSection.tsx` (+ Tests)
- `frontend/src/locales/de.ts`, `frontend/src/locales/en.ts`
