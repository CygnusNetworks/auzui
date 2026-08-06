# Threshold-farbiger Wert-Chip in Problems — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the current numeric item value next to every problem — in the DetailPanel and in the Problems list (rows + cards) — colored red/green depending on whether it currently breaches the trigger's threshold, with a direction arrow when the threshold is parseable.

**Architecture:** The value already arrives with every 30s `trigger.get` poll (`selectItems: "extend"`); only the frontend type discards `lastvalue`/`units`/`lastclock`. Add those fields end-to-end (type → join → `EnrichedProblem`), add two pure functions (`parseThreshold`, `valueBreachState`) that turn a trigger expression + a value into a breach/ok/unknown verdict, and one shared `ValueChip` component that both the DetailPanel and the list render.

**Tech Stack:** React + TypeScript, Vitest + Testing Library, Tailwind v4 (`@theme` tokens in `frontend/src/index.css`), pnpm workspace.

## Global Constraints

- Reuse the existing `--color-sev-high` / `--color-sev-ok` Tailwind tokens (`bg-sev-high/15 text-sev-high` etc., see `frontend/src/components/SeverityBadge.tsx`) for breach/ok — do not introduce new color tokens.
- No new network requests: everything is derived from data the 30s `useProblems` poll already fetches.
- `parseThreshold` must return `undefined` (not a guess) for compound expressions (`and`/`or`) or non-numeric right-hand operands (e.g. Zabbix size suffixes like `1G`) — this drives the `"unknown"` (neutral/grey) state everywhere.
- Follow existing code conventions: `useT()`/`useLocale()` from `frontend/src/lib/i18n`, `formatUnitValue` from `frontend/src/lib/format-units.ts`, pure logic lives in `frontend/src/lib/*.ts` and is unit-tested there; component-level behavior is tested with Testing Library where a test file already exists for that component (it does for `LaneSection`, it does not for `DetailPanel` — don't add a new test harness for `DetailPanel` alone, that's inconsistent with the rest of the file, which has no test coverage today either).

---

### Task 1: Thread `lastvalue`/`units`/`lastclock` through the type layer and the problem/trigger join

**Files:**
- Modify: `packages/zabbix-client/src/types.ts:155-166` (`ZabbixTrigger.items` Pick)
- Modify: `frontend/src/lib/problems.ts:12-72` (`EnrichedProblem` interface + `joinProblemsWithTriggers`)
- Test: `frontend/src/lib/__tests__/problems.test.ts`

**Interfaces:**
- Produces: `EnrichedProblem.itemLastValue?: string`, `EnrichedProblem.itemLastClock?: string`, `EnrichedProblem.itemUnits?: string` — consumed by Task 2/3/4.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/__tests__/problems.test.ts`, inside the existing `describe("joinProblemsWithTriggers", ...)` block (it already has a `trigger()` fixture helper with `items: [{ itemid: "500", key_: "item.key", name: "Item", value_type: "3" }]` — extend that fixture call per-test rather than the shared default, matching the file's existing style):

```ts
  it("attaches the current item value, its units and last-poll timestamp", () => {
    const valueTrigger = trigger({
      items: [
        {
          itemid: "500",
          key_: "item.key",
          name: "Item",
          value_type: "3",
          lastvalue: "63.4",
          lastclock: "1699999999",
          units: "°C",
        },
      ],
    });
    const joined = joinProblemsWithTriggers([problem()], [valueTrigger]);
    expect(joined[0]).toMatchObject({
      itemLastValue: "63.4",
      itemLastClock: "1699999999",
      itemUnits: "°C",
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/__tests__/problems.test.ts -t "attaches the current item value"`
Expected: FAIL — `itemLastValue`/`itemLastClock`/`itemUnits` are `undefined` (the join doesn't copy them yet), and the trigger fixture itself won't type-check yet either (see Step 3).

- [ ] **Step 3: Extend the type and the join function**

In `packages/zabbix-client/src/types.ts`, change line 165:

```ts
  items?: Pick<ZabbixItem, "itemid" | "key_" | "name" | "value_type">[];
```

to:

```ts
  items?: (Pick<ZabbixItem, "itemid" | "key_" | "name" | "value_type" | "lastvalue" | "lastclock"> &
    Partial<Pick<ZabbixItem, "units">>)[];
```

Note: `units` is a *required* field on `ZabbixItem` itself (used for `item.get` rows, which always carry it), but several existing trigger fixtures across the test suite (e.g. `mkTrigger` in `frontend/src/lib/__tests__/auto-dashboard.test.ts:311-320`) build `items` entries without a `units` key — a plain `Pick<..., "units">` would make it required on trigger items too and break those fixtures' typecheck. `Partial<Pick<ZabbixItem, "units">>` keeps it optional specifically on `ZabbixTrigger.items`, matching how `lastvalue`/`lastclock` are already optional on `ZabbixItem`.

In `frontend/src/lib/problems.ts`, add three fields to `EnrichedProblem` right after `itemValueType`:

```ts
  itemId?: string;
  itemValueType?: "0" | "3";
  /** Current value of the trigger's item, as returned by trigger.get's expanded item (Zabbix's raw string form — parse before comparing). */
  itemLastValue?: string;
  /** Unix seconds of the item's last poll. */
  itemLastClock?: string;
  /** Zabbix `units` string for the item (e.g. "°C", "%", "" for a bare number). */
  itemUnits?: string;
```

Then, in `joinProblemsWithTriggers`, extend the returned object (right after `itemValueType: numericItem?.value_type as "0" | "3" | undefined,`):

```ts
      itemLastValue: numericItem?.lastvalue,
      itemLastClock: numericItem?.lastclock,
      itemUnits: numericItem?.units,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/__tests__/problems.test.ts`
Expected: PASS (all tests in the file, not just the new one — this is a shared type/join change).

- [ ] **Step 5: Commit**

```bash
git add packages/zabbix-client/src/types.ts frontend/src/lib/problems.ts frontend/src/lib/__tests__/problems.test.ts
git commit -m "feat(problems): thread item lastvalue/units/lastclock through the trigger join"
```

---

### Task 2: `parseThreshold` — extract a single comparison from a trigger expression

**Files:**
- Modify: `frontend/src/lib/problems.ts`
- Test: `frontend/src/lib/__tests__/problems.test.ts`

**Interfaces:**
- Consumes: nothing new (pure string parsing).
- Produces: `export type ThresholdOp = ">" | ">=" | "<" | "<=";` and `export function parseThreshold(expression: string | undefined): { op: ThresholdOp; value: number } | undefined` — consumed by Task 3 and Task 4.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `frontend/src/lib/__tests__/problems.test.ts` (add `parseThreshold` to the existing import from `"../problems"`):

```ts
describe("parseThreshold", () => {
  it("extracts a simple greater-than comparison", () => {
    expect(parseThreshold("avg(/host/synoSystem.temperature,#4)>60")).toEqual({
      op: ">",
      value: 60,
    });
  });

  it("extracts greater-than-or-equal, less-than and less-than-or-equal", () => {
    expect(parseThreshold("last(/host/item)>=90")?.op).toBe(">=");
    expect(parseThreshold("last(/host/item)<5")?.op).toBe("<");
    expect(parseThreshold("last(/host/item)<=5")?.op).toBe("<=");
  });

  it("parses a negative and a decimal threshold", () => {
    expect(parseThreshold("last(/host/item)<-10")).toEqual({ op: "<", value: -10 });
    expect(parseThreshold("last(/host/item)>3.5")).toEqual({ op: ">", value: 3.5 });
  });

  it("returns undefined for a compound and/or expression", () => {
    expect(
      parseThreshold("min(/host/vm.memory.util,5m)>90 and last(/host/vm.memory.size[available])<1G"),
    ).toBeUndefined();
  });

  it("returns undefined for a non-numeric right-hand side (Zabbix size suffix)", () => {
    expect(parseThreshold("last(/host/vm.memory.size[available])<1G")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(parseThreshold(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/__tests__/problems.test.ts -t "parseThreshold"`
Expected: FAIL — `parseThreshold` is not exported yet (import error).

- [ ] **Step 3: Implement `parseThreshold`**

Add to `frontend/src/lib/problems.ts` (near the other exported pure helpers, e.g. after `formatSuppressUntil`):

```ts
export type ThresholdOp = ">" | ">=" | "<" | "<=";

const COMPARISON_OPERATOR_PATTERN = />=|<=|>|</g;

/**
 * Extracts a comparison operator + numeric threshold from a SIMPLE,
 * single-condition trigger expression (e.g. "avg(/host/key,#4)>60").
 * Returns undefined for compound expressions (and/or, more than one
 * comparison) or a non-purely-numeric right-hand side (e.g. Zabbix size
 * suffixes like "1G") — in both cases "over/under threshold" isn't
 * well-defined enough for a color to be trustworthy.
 */
export function parseThreshold(
  expression: string | undefined,
): { op: ThresholdOp; value: number } | undefined {
  if (!expression) return undefined;
  if (/\b(and|or)\b/i.test(expression)) return undefined;

  const matches = expression.match(COMPARISON_OPERATOR_PATTERN);
  if (!matches || matches.length !== 1) return undefined;

  const op = matches[0] as ThresholdOp;
  const right = expression.slice(expression.indexOf(op) + op.length).trim();
  if (!/^-?\d+(\.\d+)?$/.test(right)) return undefined;

  return { op, value: Number(right) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/__tests__/problems.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/problems.ts frontend/src/lib/__tests__/problems.test.ts
git commit -m "feat(problems): parse a threshold out of simple trigger expressions"
```

---

### Task 3: `hasNumericValue` + `valueBreachState` — decide the chip's state

**Files:**
- Modify: `frontend/src/lib/problems.ts`
- Test: `frontend/src/lib/__tests__/problems.test.ts`

**Interfaces:**
- Consumes: `EnrichedProblem.itemLastValue/itemValueType/triggerExpression` (Task 1), `parseThreshold` (Task 2).
- Produces: `export function hasNumericValue(problem: EnrichedProblem): boolean`, `export type ValueBreachState = "breach" | "ok" | "unknown";`, `export function valueBreachState(problem: EnrichedProblem): ValueBreachState` — consumed by Task 4 (`ValueChip`) and Task 5 (`DetailPanel`'s conditional "as of" line).

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/lib/__tests__/problems.test.ts` (add `hasNumericValue`, `valueBreachState` to the import; add a local `enriched()` fixture builder next to the existing `problem()`/`trigger()` helpers — it builds an `EnrichedProblem` directly since these functions operate on the joined shape, not on raw Zabbix rows):

```ts
function enriched(overrides: Partial<EnrichedProblem> = {}): EnrichedProblem {
  return {
    eventid: "1",
    objectid: "100",
    name: "Something is wrong",
    severity: 4,
    clock: 1000,
    acknowledged: false,
    tags: [],
    itemValueType: "0",
    itemLastValue: "63.4",
    triggerExpression: "avg(/host/synoSystem.temperature,#4)>60",
    ...overrides,
  };
}

describe("hasNumericValue", () => {
  it("is true for a numeric item with a parseable lastvalue", () => {
    expect(hasNumericValue(enriched())).toBe(true);
  });

  it("is false when the item type isn't numeric (text/log)", () => {
    expect(hasNumericValue(enriched({ itemValueType: undefined }))).toBe(false);
  });

  it("is false when lastvalue is missing or not a finite number", () => {
    expect(hasNumericValue(enriched({ itemLastValue: undefined }))).toBe(false);
    expect(hasNumericValue(enriched({ itemLastValue: "connect timed out" }))).toBe(false);
  });
});

describe("valueBreachState", () => {
  it("is 'breach' when the current value satisfies the comparison", () => {
    expect(valueBreachState(enriched({ itemLastValue: "63.4" }))).toBe("breach");
  });

  it("is 'ok' when the current value no longer satisfies the comparison", () => {
    expect(valueBreachState(enriched({ itemLastValue: "57.1" }))).toBe("ok");
  });

  it("is 'unknown' when the expression isn't a simple comparison", () => {
    expect(
      valueBreachState(
        enriched({
          triggerExpression:
            "min(/host/vm.memory.util,5m)>90 and last(/host/vm.memory.size[available])<1G",
        }),
      ),
    ).toBe("unknown");
  });

  it("is 'unknown' when there is no numeric value", () => {
    expect(valueBreachState(enriched({ itemLastValue: undefined }))).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/__tests__/problems.test.ts -t "valueBreachState"`
Expected: FAIL — `hasNumericValue`/`valueBreachState` not exported yet.

- [ ] **Step 3: Implement both functions**

Add to `frontend/src/lib/problems.ts`, after `parseThreshold`:

```ts
/** True when a problem carries a numeric, parseable current item value. */
export function hasNumericValue(problem: EnrichedProblem): boolean {
  if (problem.itemValueType !== "0" && problem.itemValueType !== "3") return false;
  if (problem.itemLastValue === undefined) return false;
  return Number.isFinite(Number(problem.itemLastValue));
}

export type ValueBreachState = "breach" | "ok" | "unknown";

/**
 * Compares a problem's current item value against the threshold parsed from
 * its trigger expression. "unknown" covers everything parseThreshold can't
 * resolve (compound expressions) and everything hasNumericValue rejects
 * (text/log items, missing/non-numeric lastvalue) — never a guess.
 */
export function valueBreachState(problem: EnrichedProblem): ValueBreachState {
  if (!hasNumericValue(problem)) return "unknown";
  const threshold = parseThreshold(problem.triggerExpression);
  if (!threshold) return "unknown";

  const value = Number(problem.itemLastValue);
  switch (threshold.op) {
    case ">":
      return value > threshold.value ? "breach" : "ok";
    case ">=":
      return value >= threshold.value ? "breach" : "ok";
    case "<":
      return value < threshold.value ? "breach" : "ok";
    case "<=":
      return value <= threshold.value ? "breach" : "ok";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/__tests__/problems.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/problems.ts frontend/src/lib/__tests__/problems.test.ts
git commit -m "feat(problems): derive breach/ok/unknown state for the current item value"
```

---

### Task 4: `ValueChip` component

**Files:**
- Create: `frontend/src/features/problems/ValueChip.tsx`
- Test: `frontend/src/features/problems/__tests__/ValueChip.test.tsx`

**Interfaces:**
- Consumes: `EnrichedProblem` (Task 1), `hasNumericValue`/`parseThreshold`/`valueBreachState` (Task 2/3) from `../../lib/problems`, `formatUnitValue` from `../../lib/format-units`, `useLocale` from `../../lib/i18n`.
- Produces: `export function ValueChip({ problem }: { problem: EnrichedProblem }): JSX.Element | null` — consumed by Task 5 (`DetailPanel`) and Task 6 (`LaneSection`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/problems/__tests__/ValueChip.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ValueChip } from "../ValueChip";
import type { EnrichedProblem } from "../../../lib/problems";
import { I18nProvider } from "../../../lib/i18n";

function mkProblem(overrides: Partial<EnrichedProblem> = {}): EnrichedProblem {
  return {
    eventid: "1",
    objectid: "100",
    name: "System Temperature CRITICAL",
    severity: 4,
    clock: 1000,
    acknowledged: false,
    tags: [],
    itemValueType: "0",
    itemLastValue: "63.4",
    itemUnits: "°C",
    triggerExpression: "avg(/host/synoSystem.temperature,#4)>60",
    ...overrides,
  };
}

function renderChip(problem: EnrichedProblem) {
  return render(
    <I18nProvider initialLocale="de">
      <ValueChip problem={problem} />
    </I18nProvider>,
  );
}

describe("ValueChip", () => {
  it("renders nothing when the problem has no numeric value", () => {
    const { container } = renderChip(mkProblem({ itemLastValue: undefined }));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the formatted value with an up-arrow and breach styling when over threshold", () => {
    renderChip(mkProblem());
    const chip = screen.getByText(/63\.4 °C/);
    expect(chip).toHaveClass("text-sev-high");
    expect(chip.textContent).toContain("▲");
  });

  it("renders a down-arrow and ok styling when back under threshold", () => {
    renderChip(mkProblem({ itemLastValue: "57.1" }));
    const chip = screen.getByText(/57\.1 °C/);
    expect(chip).toHaveClass("text-sev-ok");
    expect(chip.textContent).toContain("▼");
  });

  it("renders neutrally without an arrow for a compound expression", () => {
    renderChip(
      mkProblem({
        triggerExpression:
          "min(/host/vm.memory.util,5m)>90 and last(/host/vm.memory.size[available])<1G",
        itemLastValue: "94.1",
        itemUnits: "%",
      }),
    );
    const chip = screen.getByText(/94\.1 %/);
    expect(chip).toHaveClass("text-ink-2");
    expect(chip.textContent).not.toMatch(/[▲▼]/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/problems/__tests__/ValueChip.test.tsx`
Expected: FAIL — `../ValueChip` doesn't exist yet.

- [ ] **Step 3: Implement `ValueChip`**

Create `frontend/src/features/problems/ValueChip.tsx`:

```tsx
import { useLocale } from "../../lib/i18n";
import { formatUnitValue } from "../../lib/format-units";
import {
  hasNumericValue,
  parseThreshold,
  valueBreachState,
  type EnrichedProblem,
  type ValueBreachState,
} from "../../lib/problems";

const STATE_CLASS: Record<ValueBreachState, string> = {
  breach: "border-sev-high/45 bg-sev-high/10 text-sev-high",
  ok: "border-sev-ok/45 bg-sev-ok/10 text-sev-ok",
  unknown: "border-line bg-surface-2 text-ink-2",
};

/** ▲ if the value is above the threshold, ▼ if below, none if exactly equal. */
function arrowFor(value: number, thresholdValue: number): "▲" | "▼" | undefined {
  if (value > thresholdValue) return "▲";
  if (value < thresholdValue) return "▼";
  return undefined;
}

/**
 * Pill showing a problem's current item value, colored red/green by whether
 * it currently breaches the trigger's threshold (parseThreshold/valueBreachState
 * — undefined/"unknown" for compound expressions renders neutrally, no arrow).
 * Renders nothing for text/log items or a missing/non-numeric lastvalue —
 * consistent with use-sparklines' shouldShowSparkline gate, so no chip
 * appears where there is nothing meaningful to show.
 */
export function ValueChip({ problem }: { problem: EnrichedProblem }) {
  const { locale } = useLocale();
  if (!hasNumericValue(problem)) return null;

  const value = Number(problem.itemLastValue);
  const state = valueBreachState(problem);
  const threshold = parseThreshold(problem.triggerExpression);
  const arrow = threshold ? arrowFor(value, threshold.value) : undefined;

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-px font-mono text-[11px] font-semibold [font-variant-numeric:tabular-nums] ${STATE_CLASS[state]}`}
    >
      {arrow && <span aria-hidden="true">{arrow}</span>}
      {formatUnitValue(value, problem.itemUnits, 1, locale)}
    </span>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/problems/__tests__/ValueChip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/problems/ValueChip.tsx frontend/src/features/problems/__tests__/ValueChip.test.tsx
git commit -m "feat(problems): add ValueChip — threshold-colored current value pill"
```

---

### Task 5: Show the chip in the DetailPanel

**Files:**
- Modify: `frontend/src/features/problems/DetailPanel.tsx`
- Modify: `frontend/src/locales/de.ts` (`problems.detailPanel`)
- Modify: `frontend/src/locales/en.ts` (`problems.detailPanel`)

**Interfaces:**
- Consumes: `ValueChip` (Task 4), `hasNumericValue`/`formatAge` from `../../lib/problems` (the latter already imported), `t("problems.detailPanel.valueAsOf", age: string)` (new i18n key).

No dedicated test file: `DetailPanel.tsx` has no existing test coverage (it's deep in `useAcknowledge`/`useEventTimeline`/`useAppConfig` react-query hooks with no `QueryClientProvider` test harness anywhere in this codebase today) — adding one just for this one line would be new infrastructure, not a small addition. Verify this task manually in Step 3 instead, via the demo mode dev server (Task 7 wires up demo data first — do this task after Task 7, or expect the chip to be invisible in the demo until then, since demo trigger fixtures don't carry `lastvalue`/`units` until Task 7 runs).

- [ ] **Step 1: Add the i18n key**

In `frontend/src/locales/de.ts`, inside `problems.detailPanel` (right after `since: (age: string) => \`seit ${age}\`,`):

```ts
      since: (age: string) => `seit ${age}`,
      valueAsOf: (age: string) => `vor ${age} aktualisiert`,
```

In `frontend/src/locales/en.ts`, in the matching spot:

```ts
      since: (age: string) => `since ${age}`,
      valueAsOf: (age: string) => `updated ${age} ago`,
```

- [ ] **Step 2: Wire `ValueChip` into the trigger block**

In `frontend/src/features/problems/DetailPanel.tsx`, add the import:

```ts
import { ValueChip } from "./ValueChip";
```

and change the `hasNumericValue`/`formatAge` import line (currently `import { formatAge, type EnrichedProblem } from "../../lib/problems";`) to:

```ts
import { formatAge, hasNumericValue, type EnrichedProblem } from "../../lib/problems";
```

Then extend the trigger block (currently):

```tsx
      <div className="border-b border-line-soft p-3.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("problems.detailPanel.trigger")}
        </div>
        <div className="break-all font-mono text-[11.5px] text-ink-2">
          {problem.triggerExpression ?? "—"}
        </div>
      </div>
```

to:

```tsx
      <div className="border-b border-line-soft p-3.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("problems.detailPanel.trigger")}
        </div>
        <div className="break-all font-mono text-[11.5px] text-ink-2">
          {problem.triggerExpression ?? "—"}
        </div>
        {hasNumericValue(problem) && (
          <div className="mt-2 flex items-center gap-2">
            <ValueChip problem={problem} />
            {problem.itemLastClock && (
              <span className="text-[10.5px] text-ink-muted">
                {t(
                  "problems.detailPanel.valueAsOf",
                  formatAge(Number(problem.itemLastClock), undefined, locale),
                )}
              </span>
            )}
          </div>
        )}
      </div>
```

- [ ] **Step 3: Manually verify**

Run: `cd frontend && VITE_DEMO=1 npm run dev`, open the Problems page, select a problem whose demo trigger has a numeric item (after Task 7, all of them do). Confirm: the chip shows a colored value under the trigger expression, plus a "vor Xs aktualisiert" line; switching the locale switcher to English shows "updated Xs ago".

- [ ] **Step 4: Run the full frontend test suite to make sure nothing else broke**

Run: `cd frontend && npx vitest run`
Expected: PASS (no test targets `DetailPanel.tsx` directly, so this just guards against a typo/import break elsewhere).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/problems/DetailPanel.tsx frontend/src/locales/de.ts frontend/src/locales/en.ts
git commit -m "feat(problems): show the threshold-colored value chip in the detail panel"
```

---

### Task 6: Show the chip in the Problems list (rows + cards)

**Files:**
- Modify: `frontend/src/features/problems/LaneSection.tsx`
- Test: `frontend/src/features/problems/__tests__/LaneSection.test.tsx`

**Interfaces:**
- Consumes: `ValueChip` (Task 4).

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/features/problems/__tests__/LaneSection.test.tsx`, two new `it`s inside `describe("LaneSection (rows mode)", ...)` (and a `mode="cards"` describe block doesn't currently exist — add the card-mode test as its own top-level `describe`, mirroring the rows describe's structure):

```tsx
  it("shows a colored value chip in the row when the problem has a numeric value", () => {
    const problems = [
      mkProblem({
        eventid: "5",
        itemValueType: "0",
        itemLastValue: "63.4",
        itemUnits: "°C",
        triggerExpression: "avg(/host/synoSystem.temperature,#4)>60",
      }),
    ];

    render(
      <LaneSection
        severity={4}
        problems={problems}
        mode="rows"
        open={true}
        onToggleOpen={vi.fn()}
        selectedEventId={undefined}
        onSelect={vi.fn()}
        sparklines={new Map()}
        {...bulkProps()}
      />,
    );

    const chip = screen.getByText(/63\.4 °C/);
    expect(chip).toHaveClass("text-sev-high");
  });

  it("shows no value chip in the row when the problem has no numeric value", () => {
    const problems = [mkProblem({ eventid: "6" })];

    render(
      <LaneSection
        severity={4}
        problems={problems}
        mode="rows"
        open={true}
        onToggleOpen={vi.fn()}
        selectedEventId={undefined}
        onSelect={vi.fn()}
        sparklines={new Map()}
        {...bulkProps()}
      />,
    );

    expect(screen.queryByText(/°C|%/)).not.toBeInTheDocument();
  });
```

Add a new `describe` block at the end of the file (before the final closing, i.e. after the existing `describe("LaneSection (rows mode)", ...)` block ends):

```tsx
describe("LaneSection (cards mode)", () => {
  it("shows a colored value chip on the card when the problem has a numeric value", () => {
    const problems = [
      mkProblem({
        eventid: "9",
        itemValueType: "0",
        itemLastValue: "57.1",
        itemUnits: "°C",
        triggerExpression: "avg(/host/synoSystem.temperature,#4)>60",
      }),
    ];

    render(
      <LaneSection
        severity={4}
        problems={problems}
        mode="cards"
        open={true}
        onToggleOpen={vi.fn()}
        selectedEventId={undefined}
        onSelect={vi.fn()}
        sparklines={new Map()}
        {...bulkProps()}
      />,
    );

    const chip = screen.getByText(/57\.1 °C/);
    expect(chip).toHaveClass("text-sev-ok");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/problems/__tests__/LaneSection.test.tsx`
Expected: FAIL — no value text rendered yet (rows/cards don't use `ValueChip`).

- [ ] **Step 3: Wire `ValueChip` into `ProblemRow` and `ProblemCard`**

In `frontend/src/features/problems/LaneSection.tsx`, add the import:

```ts
import { ValueChip } from "./ValueChip";
```

Change `ROW_GRID_COLS` (currently `"70px 170px minmax(220px,1fr) 170px 90px"`) to add a fixed-width value column between the title and the tags column:

```ts
const ROW_GRID_COLS = "70px 170px minmax(220px,1fr) 100px 170px 90px";
```

In `ProblemRow`, insert a new column between the title `<span>` and the tags `<span>`:

```tsx
        <span className={`flex items-center gap-1.5 pr-2.5 ${dimClass}`}>
          <span className="truncate">{problem.name}</span>
        </span>
        <span className={`pr-2.5 ${dimClass}`}>
          <ValueChip problem={problem} />
        </span>
        <span className={`pr-2.5 ${dimClass}`}>
```

(The following tags `<span>` and `<StatusChips problem={problem} />` stay exactly as they are — only the new `ValueChip` column is inserted between title and tags.)

In `ProblemCard`, change the footer row (currently):

```tsx
      <span className="mt-0.5 flex items-center justify-between gap-1.5">
        <span className={`flex min-w-0 items-center gap-1.5 ${dimClass}`}>
          <span className="truncate rounded bg-surface-3 px-1.5 font-mono text-[10px] text-ink-2">
            {problem.tags[0]?.tag ?? ""}
          </span>
        </span>
        <StatusChips problem={problem} />
      </span>
```

to:

```tsx
      <span className="mt-0.5 flex items-center justify-between gap-1.5">
        <span className={`flex min-w-0 items-center gap-1.5 ${dimClass}`}>
          <span className="truncate rounded bg-surface-3 px-1.5 font-mono text-[10px] text-ink-2">
            {problem.tags[0]?.tag ?? ""}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <ValueChip problem={problem} />
          <StatusChips problem={problem} />
        </span>
      </span>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/problems/__tests__/LaneSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/problems/LaneSection.tsx frontend/src/features/problems/__tests__/LaneSection.test.tsx
git commit -m "feat(problems): show the value chip in the problem list rows and cards"
```

---

### Task 7: Carry `lastvalue`/`units`/`lastclock` into the demo-mode trigger fixtures

**Files:**
- Modify: `frontend/src/demo/mockData.ts`

**Interfaces:**
- Consumes: `demoItems` entries' existing `lastvalue`/`lastclock`/`units` fields (already present, used elsewhere for Latest Data/sparklines).
- Produces: nothing new for later tasks — this only makes the demo site (used for the docs screenshots and the public `/demo`) actually exercise the new chip. No behavior change for the real Zabbix-backed app.

- [ ] **Step 1: Extend the demo trigger fixture**

In `frontend/src/demo/mockData.ts`, find the `demoTriggers.push({...})` call inside the `for (const spec of PROBLEM_SPECS)` loop (around line 415). Its `items` line currently reads:

```ts
    items: item ? [{ itemid: item.itemid, key_: item.key_, name: item.name, value_type: item.value_type }] : [],
```

Change it to also carry the item's existing value fields:

```ts
    items: item
      ? [
          {
            itemid: item.itemid,
            key_: item.key_,
            name: item.name,
            value_type: item.value_type,
            lastvalue: item.lastvalue,
            lastclock: item.lastclock,
            units: item.units,
          },
        ]
      : [],
```

- [ ] **Step 2: Verify manually**

Run: `cd frontend && VITE_DEMO=1 npm run dev`, open the Problems page. Confirm several problem rows/cards now show a colored value chip, and that opening the DetailPanel for one of them shows the chip + "vor Xs aktualisiert" line under the trigger expression (this also completes the manual check from Task 5, Step 3).

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — this is fixture data only, no test asserts on the old `items` shape for these specific demo triggers.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/demo/mockData.ts
git commit -m "feat(demo): carry item lastvalue/units into demo trigger fixtures"
```

---

### Task 8: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the whole workspace test suite**

Run: `cd /Users/valerius/git/auzui && pnpm -r test`
Expected: PASS.

- [ ] **Step 2: Run lint and the frontend production build (catches type errors `vitest` doesn't)**

Run: `cd /Users/valerius/git/auzui && pnpm -r lint && pnpm --filter frontend build`
Expected: PASS — `build` runs `tsc --noEmit && vite build`, which will catch any leftover type mismatch (e.g. in `packages/zabbix-client` consumers outside the files touched above).

- [ ] **Step 3: Manual smoke test against a real Zabbix instance (not just demo mode)**

Run: `cd frontend && npm run dev` (without `VITE_DEMO=1`, pointed at a real backend per the repo's normal dev setup). Open Problems, pick an active problem with a simple-threshold trigger (e.g. a temperature or utilization trigger) and confirm the chip renders with the correct color/arrow, and that a problem with a compound trigger expression shows the neutral/no-arrow state instead of a wrong guess.

No commit — this task only verifies Tasks 1–7.
