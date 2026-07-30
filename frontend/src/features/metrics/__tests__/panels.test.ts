import { describe, expect, it } from "vitest";
import { groupSeriesByUnit, stripUnit } from "../panels";

describe("stripUnit", () => {
  it("strips a leading '!' and trims", () => {
    expect(stripUnit("!C")).toBe("C");
    expect(stripUnit(" ! C ")).toBe("C");
    expect(stripUnit("%")).toBe("%");
    expect(stripUnit(undefined)).toBe("");
    expect(stripUnit("")).toBe("");
  });
});

describe("groupSeriesByUnit", () => {
  it("groups by stripped unit, preserving first-seen order", () => {
    const series = [
      { id: "a", units: "B" },
      { id: "b", units: "%" },
      { id: "c", units: "!B" },
      { id: "d", units: "" },
    ];
    const groups = groupSeriesByUnit(series, (s) => s.units);
    expect(groups.map((g) => g.unit)).toEqual(["B", "%", ""]);
    expect(groups[0]!.series.map((s) => s.id)).toEqual(["a", "c"]);
    expect(groups[2]!.series.map((s) => s.id)).toEqual(["d"]);
  });

  it("returns [] for no series", () => {
    expect(groupSeriesByUnit([], (s: { units: string }) => s.units)).toEqual([]);
  });
});
