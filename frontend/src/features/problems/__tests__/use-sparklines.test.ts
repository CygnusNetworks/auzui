import { describe, expect, it } from "vitest";
import type { Series } from "@auzui/timeseries";
import { shouldShowSparkline } from "../use-sparklines";

function series(values: number[]): Series {
  return {
    itemid: "500",
    source: "history",
    points: values.map((v, i) => ({ t: i, v })),
  };
}

describe("shouldShowSparkline", () => {
  it("shows a sparkline for a numeric item with a varying series", () => {
    expect(shouldShowSparkline("0", series([1, 2, 3, 2]))).toBe(true);
    expect(shouldShowSparkline("3", series([5, 7, 6]))).toBe(true);
  });

  it("hides the sparkline for a non-numeric item (text/log, value_type undefined)", () => {
    expect(shouldShowSparkline(undefined, series([1, 2, 3]))).toBe(false);
  });

  it("hides the sparkline for a constant series (min == max, flat line)", () => {
    expect(shouldShowSparkline("3", series([4, 4, 4, 4]))).toBe(false);
  });

  it("hides the sparkline when the series is missing or too short to draw", () => {
    expect(shouldShowSparkline("0", undefined)).toBe(false);
    expect(shouldShowSparkline("0", series([42]))).toBe(false);
  });
});
