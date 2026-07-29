import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { LaneSection } from "../LaneSection";
import type { EnrichedProblem } from "../../../lib/problems";
import { I18nProvider } from "../../../lib/i18n";

/**
 * LaneSection uses useT()/useLocale(), which require an I18nProvider
 * ancestor. Pin the locale to "de" explicitly — these assertions check the
 * German strings, and the provider's auto-detection would otherwise depend
 * on the test environment's navigator.language.
 */
function render(ui: ReactElement) {
  return rtlRender(<I18nProvider initialLocale="de">{ui}</I18nProvider>);
}

function mkProblem(overrides: Partial<EnrichedProblem> = {}): EnrichedProblem {
  return {
    eventid: "1",
    objectid: "100",
    name: "Temperature critical on chassis",
    severity: 4,
    clock: Math.floor(Date.now() / 1000) - 120,
    acknowledged: false,
    tags: [{ tag: "component", value: "temperature" }],
    hostId: "10",
    hostName: "core-sw01",
    ...overrides,
  };
}

/** Bulk-selection props every LaneSection render needs — no-op defaults. */
function bulkProps(overrides: Partial<Parameters<typeof LaneSection>[0]> = {}) {
  return {
    selectMode: false,
    selectedIds: new Set<string>(),
    onToggleSelect: vi.fn(),
    onToggleSelectAll: vi.fn(),
    ...overrides,
  };
}

describe("LaneSection (rows mode)", () => {
  it("renders one row per problem with host, text and ack status", () => {
    const problems = [
      mkProblem({ eventid: "1", hostName: "core-sw01", acknowledged: false }),
      mkProblem({ eventid: "2", hostName: "lnx-db01", name: "Disk full", acknowledged: true }),
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

    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("2 · 1 ack")).toBeInTheDocument();
    expect(screen.getByText("core-sw01")).toBeInTheDocument();
    expect(screen.getByText("lnx-db01")).toBeInTheDocument();
    expect(screen.getByText("Temperature critical on chassis")).toBeInTheDocument();
    expect(screen.getByText("Disk full")).toBeInTheDocument();
    expect(screen.getByText("✓ ack")).toBeInTheDocument();
    expect(screen.getByText("— ack")).toBeInTheDocument();
  });

  it("calls onSelect with the clicked problem", () => {
    const onSelect = vi.fn();
    const problems = [mkProblem({ eventid: "42", hostName: "acc-sw-b04" })];

    render(
      <LaneSection
        severity={4}
        problems={problems}
        mode="rows"
        open={true}
        onToggleOpen={vi.fn()}
        selectedEventId={undefined}
        onSelect={onSelect}
        sparklines={new Map()}
        {...bulkProps()}
      />,
    );

    fireEvent.click(screen.getByText("acc-sw-b04"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ eventid: "42" }));
  });

  it("collapses the lane and hides the table when open=false", () => {
    render(
      <LaneSection
        severity={4}
        problems={[mkProblem()]}
        mode="rows"
        open={false}
        onToggleOpen={vi.fn()}
        selectedEventId={undefined}
        onSelect={vi.fn()}
        sparklines={new Map()}
        {...bulkProps()}
      />,
    );
    expect(screen.queryByText("Temperature critical on chassis")).not.toBeInTheDocument();
  });

  it("calls onToggleOpen when the collapse arrow is clicked", () => {
    const onToggleOpen = vi.fn();
    render(
      <LaneSection
        severity={4}
        problems={[mkProblem()]}
        mode="rows"
        open={true}
        onToggleOpen={onToggleOpen}
        selectedEventId={undefined}
        onSelect={vi.fn()}
        sparklines={new Map()}
        {...bulkProps()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "▾" }));
    expect(onToggleOpen).toHaveBeenCalled();
  });

  it("renders no selection control when select mode is off", () => {
    render(
      <LaneSection
        severity={4}
        problems={[mkProblem()]}
        mode="rows"
        open={true}
        onToggleOpen={vi.fn()}
        selectedEventId={undefined}
        onSelect={vi.fn()}
        sparklines={new Map()}
        {...bulkProps({ selectMode: false })}
      />,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("toggles selection on a row click in select mode, without opening the detail", () => {
    const onToggleSelect = vi.fn();
    const onSelect = vi.fn();
    const problems = [mkProblem({ eventid: "7", hostName: "acc-sw-b04" })];

    render(
      <LaneSection
        severity={4}
        problems={problems}
        mode="rows"
        open={true}
        onToggleOpen={vi.fn()}
        selectedEventId={undefined}
        onSelect={onSelect}
        sparklines={new Map()}
        {...bulkProps({ selectMode: true, onToggleSelect })}
      />,
    );

    // Clicking anywhere on the row toggles the selection instead of selecting.
    fireEvent.click(screen.getByText("acc-sw-b04"));
    expect(onToggleSelect).toHaveBeenCalledWith("7");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("exposes a custom row checkbox in select mode that toggles the selection", () => {
    const onToggleSelect = vi.fn();
    const problems = [mkProblem({ eventid: "7" })];

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
        {...bulkProps({ selectMode: true, onToggleSelect })}
      />,
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Temperature critical on chassis auswählen" }),
    );
    expect(onToggleSelect).toHaveBeenCalledWith("7");
  });

  it("selects all problems in the lane via the header checkbox", () => {
    const onToggleSelectAll = vi.fn();
    const problems = [mkProblem({ eventid: "1" }), mkProblem({ eventid: "2" })];

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
        {...bulkProps({ selectMode: true, onToggleSelectAll })}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Alle in High auswählen" }));
    expect(onToggleSelectAll).toHaveBeenCalledWith(["1", "2"], true);
  });

  it("checks the header checkbox when every problem in the lane is selected", () => {
    const problems = [mkProblem({ eventid: "1" }), mkProblem({ eventid: "2" })];

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
        {...bulkProps({ selectMode: true, selectedIds: new Set(["1", "2"]) })}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Alle in High auswählen" })).toBeChecked();
  });
});
