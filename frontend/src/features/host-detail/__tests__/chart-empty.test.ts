import { describe, expect, it } from "vitest";
import { isChartEmpty } from "../chart-empty";

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
