import { describe, expect, it } from "vitest";
import { formatLogTimestamp } from "../log-timestamp";

describe("formatLogTimestamp", () => {
  it("formats as HH:MM:SS.mmm with a dot separator, zero-padded", () => {
    // 2026-07-29T09:05:03.007Z-ish (local time depends on TZ, so just check the shape)
    const formatted = formatLogTimestamp(1700000000.007);
    expect(formatted).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it("pads single-digit milliseconds to 3 digits", () => {
    const formatted = formatLogTimestamp(1700000000.005);
    expect(formatted.split(".")[1]).toBe("005");
  });

  it("zero milliseconds render as .000, not empty", () => {
    const formatted = formatLogTimestamp(1700000000);
    expect(formatted.endsWith(".000")).toBe(true);
  });
});
