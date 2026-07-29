import { describe, expect, it } from "vitest";
import {
  laneTriState,
  retainVisible,
  setLaneSelection,
  toggleSelection,
} from "../selection";

describe("toggleSelection", () => {
  it("adds an id that is not selected", () => {
    expect([...toggleSelection(new Set(["a"]), "b")]).toEqual(["a", "b"]);
  });

  it("removes an id that is already selected", () => {
    expect([...toggleSelection(new Set(["a", "b"]), "b")]).toEqual(["a"]);
  });

  it("does not mutate the input set", () => {
    const input = new Set(["a"]);
    toggleSelection(input, "b");
    expect([...input]).toEqual(["a"]);
  });
});

describe("setLaneSelection", () => {
  it("adds every lane id when checked", () => {
    expect([...setLaneSelection(new Set(["x"]), ["a", "b"], true)]).toEqual(["x", "a", "b"]);
  });

  it("removes every lane id when unchecked", () => {
    expect([...setLaneSelection(new Set(["a", "b", "x"]), ["a", "b"], false)]).toEqual(["x"]);
  });
});

describe("laneTriState", () => {
  it("is 'none' for an empty lane", () => {
    expect(laneTriState(new Set(["a"]), [])).toBe("none");
  });

  it("is 'none' when no lane id is selected", () => {
    expect(laneTriState(new Set(["x"]), ["a", "b"])).toBe("none");
  });

  it("is 'all' when every lane id is selected", () => {
    expect(laneTriState(new Set(["a", "b"]), ["a", "b"])).toBe("all");
  });

  it("is 'some' when only part of the lane is selected", () => {
    expect(laneTriState(new Set(["a"]), ["a", "b"])).toBe("some");
  });
});

describe("retainVisible", () => {
  it("drops ids that are no longer visible", () => {
    expect([...retainVisible(new Set(["a", "b", "c"]), ["a", "c"])]).toEqual(["a", "c"]);
  });
});
