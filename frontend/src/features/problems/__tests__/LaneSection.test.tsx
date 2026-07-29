import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LaneSection } from "../LaneSection";
import type { EnrichedProblem } from "../../../lib/problems";

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
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "▾" }));
    expect(onToggleOpen).toHaveBeenCalled();
  });
});
