import { describe, expect, it } from "vitest";
import { matchesSeverityFilter } from "../severity";

describe("matchesSeverityFilter", () => {
  it("'all' passes everything, including hosts without a problem", () => {
    expect(matchesSeverityFilter(undefined, "all")).toBe(true);
    expect(matchesSeverityFilter(0, "all")).toBe(true);
    expect(matchesSeverityFilter(5, "all")).toBe(true);
  });

  it("'problems' requires a defined severity, any value", () => {
    expect(matchesSeverityFilter(undefined, "problems")).toBe(false);
    expect(matchesSeverityFilter(0, "problems")).toBe(true);
    expect(matchesSeverityFilter(1, "problems")).toBe(true);
  });

  it("'warn' requires severity >= 2", () => {
    expect(matchesSeverityFilter(undefined, "warn")).toBe(false);
    expect(matchesSeverityFilter(1, "warn")).toBe(false);
    expect(matchesSeverityFilter(2, "warn")).toBe(true);
    expect(matchesSeverityFilter(5, "warn")).toBe(true);
  });

  it("'high' requires severity >= 4", () => {
    expect(matchesSeverityFilter(3, "high")).toBe(false);
    expect(matchesSeverityFilter(4, "high")).toBe(true);
    expect(matchesSeverityFilter(5, "high")).toBe(true);
  });
});
