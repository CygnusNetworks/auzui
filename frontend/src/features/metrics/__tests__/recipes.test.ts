import { describe, expect, it } from "vitest";
import { buildRecipes, LOAD_KEY, MAX_RECIPES, pickLoadRecipeGroup } from "../recipes";
import type { RecentSet } from "../recent-sets";

describe("pickLoadRecipeGroup", () => {
  it("picks the group with the most hosts (≥2), ties broken by name", () => {
    expect(
      pickLoadRecipeGroup([
        { name: "Small", hostCount: 1 },
        { name: "Big", hostCount: 5 },
        { name: "Mid", hostCount: 2 },
      ]),
    ).toBe("Big");
    expect(
      pickLoadRecipeGroup([
        { name: "Bravo", hostCount: 3 },
        { name: "Alpha", hostCount: 3 },
      ]),
    ).toBe("Alpha");
  });

  it("returns null when no group has ≥2 hosts", () => {
    expect(pickLoadRecipeGroup([{ name: "Solo", hostCount: 1 }])).toBeNull();
    expect(pickLoadRecipeGroup([])).toBeNull();
  });
});

describe("buildRecipes", () => {
  const recent: RecentSet[] = [
    { title: "R1", items: ["1"], query: "q1", ts: 1 },
    { title: "R2", items: ["2"], query: "q2", ts: 2 },
    { title: "R3", items: ["3"], query: "q3", ts: 3 },
    { title: "R4", items: ["4"], query: "q4", ts: 4 },
  ];

  it("emits load + crossHost + recent, capped at MAX_RECIPES", () => {
    const recipes = buildRecipes("Web servers", recent);
    expect(recipes).toHaveLength(MAX_RECIPES);
    expect(recipes[0]!.kind).toBe("load");
    expect(recipes[0]!.query).toContain(`group:"Web servers"`);
    expect(recipes[0]!.query).toContain(`key:${LOAD_KEY}`);
    expect(recipes[1]!.kind).toBe("crossHost");
    expect(recipes[1]!.query).toBe(`key:${LOAD_KEY}`);
    expect(recipes.slice(2).every((r) => r.kind === "recent")).toBe(true);
  });

  it("without a load group, fills with up to 3 recent sets", () => {
    const recipes = buildRecipes(null, recent);
    expect(recipes[0]!.kind).toBe("crossHost");
    expect(recipes.filter((r) => r.kind === "recent").map((r) => r.items[0])).toEqual(["1", "2", "3"]);
  });

  it("recent recipes carry their stored query + items", () => {
    const recipes = buildRecipes(null, [recent[0]!]);
    const r = recipes.find((x) => x.kind === "recent")!;
    expect(r.query).toBe("q1");
    expect(r.items).toEqual(["1"]);
  });
});
