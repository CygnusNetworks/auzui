import { describe, expect, it } from "vitest";
import {
  addRecentSet,
  buildRecentSetTitle,
  MAX_RECENT_SETS,
  parseRecentSets,
  recentSetsKey,
  serializeRecentSets,
  type RecentSet,
} from "../recent-sets";

function mkSet(items: string[], ts: number, title = "t"): RecentSet {
  return { title, items, query: "q", ts };
}

describe("recentSetsKey", () => {
  it("binds the key to the username, falling back to anon", () => {
    expect(recentSetsKey("alice")).toBe("auzui-metrics-recent:alice");
    expect(recentSetsKey(null)).toBe("auzui-metrics-recent:anon");
  });
});

describe("buildRecentSetTitle", () => {
  it("joins up to two labels, then summarizes with +N", () => {
    expect(buildRecentSetTitle(["a"])).toBe("a");
    expect(buildRecentSetTitle(["a", "b"])).toBe("a, b");
    expect(buildRecentSetTitle(["a", "b", "c", "d"])).toBe("a, b +2");
    expect(buildRecentSetTitle([" ", ""])).toBe("");
  });
});

describe("parse/serialize round-trip", () => {
  it("round-trips valid sets and drops corrupt entries", () => {
    const sets = [mkSet(["1", "2"], 100)];
    expect(parseRecentSets(serializeRecentSets(sets))).toEqual(sets);
    expect(parseRecentSets(null)).toEqual([]);
    expect(parseRecentSets("not json")).toEqual([]);
    expect(parseRecentSets(JSON.stringify([{ nope: true }, mkSet(["1"], 1)]))).toEqual([mkSet(["1"], 1)]);
  });
});

describe("addRecentSet", () => {
  it("prepends, dedupes by itemid signature, and caps the list", () => {
    let list: RecentSet[] = [];
    list = addRecentSet(list, mkSet(["1", "2"], 1));
    list = addRecentSet(list, mkSet(["3"], 2));
    // same items in different order → dedupe, moved to front with new ts
    list = addRecentSet(list, mkSet(["2", "1"], 3));
    expect(list.map((s) => s.ts)).toEqual([3, 2]);

    for (let i = 0; i < MAX_RECENT_SETS + 2; i++) list = addRecentSet(list, mkSet([`x${i}`], 100 + i));
    expect(list).toHaveLength(MAX_RECENT_SETS);
  });

  it("ignores empty selections", () => {
    expect(addRecentSet([], mkSet([], 1))).toEqual([]);
  });
});
