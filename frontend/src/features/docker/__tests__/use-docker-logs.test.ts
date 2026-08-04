import { describe, expect, it } from "vitest";
import { cursorToSinceSeconds } from "../use-docker-logs";

describe("cursorToSinceSeconds: pure conversion of the opaque log cursor", () => {
  it("converts an RFC3339Nano cursor to Unix seconds", () => {
    // 2024-01-01T00:00:01.500000000Z → 1704067201.5s.
    expect(cursorToSinceSeconds("2024-01-01T00:00:01.500000000Z")).toBeCloseTo(1704067201.5, 3);
  });

  it("handles a cursor without fractional seconds", () => {
    expect(cursorToSinceSeconds("2024-01-01T00:00:00Z")).toBe(1704067200);
  });

  it("returns undefined for a cursor that isn't a parseable timestamp", () => {
    expect(cursorToSinceSeconds("not-a-timestamp")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(cursorToSinceSeconds("")).toBeUndefined();
  });
});
