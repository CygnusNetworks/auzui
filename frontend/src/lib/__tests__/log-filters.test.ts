import { describe, expect, it } from "vitest";
import { activeFilterMode, hasFilter, toggleFilter, type LogFilterState } from "../log-filters";

const empty: LogFilterState = { include: [], exclude: [] };

describe("toggleFilter: mutual exclusivity of include/exclude", () => {
  it("adds an include when nothing is set", () => {
    const next = toggleFilter(empty, "facility", "local0", "include");
    expect(next).toEqual({ include: [{ field: "facility", value: "local0" }], exclude: [] });
  });

  it("adds an exclude when nothing is set", () => {
    const next = toggleFilter(empty, "facility", "local0", "exclude");
    expect(next).toEqual({ include: [], exclude: [{ field: "facility", value: "local0" }] });
  });

  it("switches an existing include to exclude (never both at once)", () => {
    const state: LogFilterState = { include: [{ field: "facility", value: "local0" }], exclude: [] };
    const next = toggleFilter(state, "facility", "local0", "exclude");
    expect(next).toEqual({ include: [], exclude: [{ field: "facility", value: "local0" }] });
  });

  it("switches an existing exclude to include", () => {
    const state: LogFilterState = { include: [], exclude: [{ field: "facility", value: "local0" }] };
    const next = toggleFilter(state, "facility", "local0", "include");
    expect(next).toEqual({ include: [{ field: "facility", value: "local0" }], exclude: [] });
  });

  it("removes the filter when the already-active mode is clicked again (toggle off)", () => {
    const state: LogFilterState = { include: [{ field: "facility", value: "local0" }], exclude: [] };
    const next = toggleFilter(state, "facility", "local0", "include");
    expect(next).toEqual({ include: [], exclude: [] });
  });

  it("removes an active exclude when exclude is clicked again", () => {
    const state: LogFilterState = { include: [], exclude: [{ field: "source", value: "web01" }] };
    const next = toggleFilter(state, "source", "web01", "exclude");
    expect(next).toEqual({ include: [], exclude: [] });
  });

  it("leaves unrelated filters untouched", () => {
    const state: LogFilterState = {
      include: [{ field: "source", value: "web01" }],
      exclude: [{ field: "application_name", value: "cron" }],
    };
    const next = toggleFilter(state, "facility", "local0", "include");
    expect(next.include).toContainEqual({ field: "source", value: "web01" });
    expect(next.include).toContainEqual({ field: "facility", value: "local0" });
    expect(next.exclude).toEqual([{ field: "application_name", value: "cron" }]);
  });

  it("does not mutate the input state", () => {
    const state: LogFilterState = { include: [{ field: "facility", value: "local0" }], exclude: [] };
    const snapshot = structuredClone(state);
    toggleFilter(state, "facility", "local0", "exclude");
    expect(state).toEqual(snapshot);
  });
});

describe("activeFilterMode / hasFilter", () => {
  const state: LogFilterState = {
    include: [{ field: "source", value: "web01" }],
    exclude: [{ field: "facility", value: "local0" }],
  };

  it("reports include for an included value", () => {
    expect(activeFilterMode(state, "source", "web01")).toBe("include");
  });

  it("reports exclude for an excluded value", () => {
    expect(activeFilterMode(state, "facility", "local0")).toBe("exclude");
  });

  it("reports undefined for an unfiltered value", () => {
    expect(activeFilterMode(state, "application_name", "sshd")).toBeUndefined();
  });

  it("hasFilter matches field and value", () => {
    expect(hasFilter(state.include, "source", "web01")).toBe(true);
    expect(hasFilter(state.include, "source", "web02")).toBe(false);
  });
});
