import { describe, expect, it } from "vitest";
import { buildLevelQuery, logLevelBadgeClass, messagesHaveLevelField } from "../log-level";

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

describe("logLevelBadgeClass", () => {
  it("maps 0-3 (emerg..err) to sev-high", () => {
    expect(logLevelBadgeClass(0)).toContain("sev-high");
    expect(logLevelBadgeClass(3)).toContain("sev-high");
  });

  it("maps 4 (warn) to sev-warn", () => {
    expect(logLevelBadgeClass(4)).toContain("sev-warn");
  });

  it("maps 5 (notice) to sev-info", () => {
    expect(logLevelBadgeClass(5)).toContain("sev-info");
  });

  it("maps 6-7 (info/debug) and undefined to ink-muted", () => {
    expect(logLevelBadgeClass(6)).toContain("ink-muted");
    expect(logLevelBadgeClass(7)).toContain("ink-muted");
    expect(logLevelBadgeClass(undefined)).toContain("ink-muted");
  });
});
