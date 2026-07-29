import { describe, expect, it } from "vitest";
import { resolveFacilityName } from "../log-facility";

describe("resolveFacilityName", () => {
  it("resolves standard facility numbers to their name", () => {
    expect(resolveFacilityName(0, undefined)).toBe("kern");
    expect(resolveFacilityName(4, undefined)).toBe("auth");
    expect(resolveFacilityName(16, undefined)).toBe("local0");
    expect(resolveFacilityName(23, undefined)).toBe("local7");
  });

  it("falls back to the raw facility string when the number is unknown or missing", () => {
    expect(resolveFacilityName(undefined, "local0")).toBe("local0");
    expect(resolveFacilityName(99, "custom-facility")).toBe("custom-facility");
  });

  it("returns undefined when neither is available", () => {
    expect(resolveFacilityName(undefined, undefined)).toBeUndefined();
  });

  it("prefers the resolved number over a raw string that disagrees", () => {
    expect(resolveFacilityName(9, "something-else")).toBe("cron");
  });
});
