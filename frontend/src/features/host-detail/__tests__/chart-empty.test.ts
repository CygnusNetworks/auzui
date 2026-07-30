import { describe, expect, it } from "vitest";
import type { Point } from "@auzui/timeseries";
import { isChartEmpty, isSeriesConstant } from "../chart-empty";

const pts = (...vs: number[]): Point[] => vs.map((v, i) => ({ t: i, v }));

describe("isChartEmpty", () => {
  it("is empty only after a successful query with no points", () => {
    expect(isChartEmpty({ isCounter: false, isSuccess: true, hasData: false })).toBe(true);
  });

  it("is not empty when the successful query returned points", () => {
    expect(isChartEmpty({ isCounter: false, isSuccess: true, hasData: true })).toBe(false);
  });

  it("never hides counters", () => {
    expect(isChartEmpty({ isCounter: true, isSuccess: true, hasData: false })).toBe(false);
  });

  it("is not empty while the query is still loading/fetching (not yet successful)", () => {
    // isSuccess=false models isLoading/isFetching-first-time and the
    // keepPreviousData key-switch race that used to hide the card prematurely.
    expect(isChartEmpty({ isCounter: false, isSuccess: false, hasData: false })).toBe(false);
  });

  it("is not empty on a failed query (isSuccess=false)", () => {
    // Covers the Influx-path error where `slow` stayed false and the old
    // logic hid the chart forever.
    expect(isChartEmpty({ isCounter: false, isSuccess: false, hasData: false })).toBe(false);
  });
});

describe("isSeriesConstant", () => {
  it("is constant when the single series never changes (flatline like 'users: 0')", () => {
    expect(isSeriesConstant([pts(0, 0, 0, 0)])).toBe(true);
    expect(isSeriesConstant([pts(1, 1)])).toBe(true);
  });

  it("is not constant when the series varies", () => {
    expect(isSeriesConstant([pts(0, 1, 0)])).toBe(false);
  });

  it("is constant only when ALL non-empty series are flat", () => {
    expect(isSeriesConstant([pts(5, 5), pts(2, 2)])).toBe(true);
    expect(isSeriesConstant([pts(5, 5), pts(2, 3)])).toBe(false);
  });

  it("is not constant with no data at all (empty series → still a graph, not a fact)", () => {
    expect(isSeriesConstant([])).toBe(false);
    expect(isSeriesConstant([[], []])).toBe(false);
  });

  it("ignores empty series alongside a constant one", () => {
    expect(isSeriesConstant([[], pts(7, 7)])).toBe(true);
  });
});
