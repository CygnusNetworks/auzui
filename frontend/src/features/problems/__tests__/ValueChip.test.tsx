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
