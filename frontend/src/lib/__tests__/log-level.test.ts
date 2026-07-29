import { describe, expect, it } from "vitest";
import { buildLevelQuery, messagesHaveLevelField } from "../log-level";

describe("buildLevelQuery", () => {
  it("returns the trimmed base query when no level chip is active", () => {
    expect(buildLevelQuery('source:"host"  ', undefined)).toBe('source:"host"');
  });

  it("appends level:<=N standalone when the base query is empty", () => {
    expect(buildLevelQuery("", 3)).toBe("level:<=3");
  });

  it("AND-combines level:<=N with an existing query", () => {
    expect(buildLevelQuery('source:"host"', 4)).toBe('source:"host" AND level:<=4');
  });
});

describe("messagesHaveLevelField", () => {
  it("is true only when at least one message carries a level", () => {
    expect(messagesHaveLevelField([{ level: 3 }, {}])).toBe(true);
    expect(messagesHaveLevelField([{}, {}])).toBe(false);
    expect(messagesHaveLevelField([])).toBe(false);
  });
});
