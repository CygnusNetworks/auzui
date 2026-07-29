import { describe, expect, it } from "vitest";
import { formatUnitValue } from "../format-units";

describe("formatUnitValue", () => {
  it("formats % with one decimal", () => {
    expect(formatUnitValue(42.567, "%")).toBe("42.6 %");
  });

  it("formats bps with SI k/M/G prefixes", () => {
    expect(formatUnitValue(500, "bps")).toBe("500 bps");
    expect(formatUnitValue(1500, "bps")).toBe("1.5 kbps");
    expect(formatUnitValue(12_300_000, "bps")).toBe("12.3 Mbps");
    expect(formatUnitValue(4_200_000_000, "Bps")).toBe("4.2 GBps");
  });

  it("formats B with IEC Ki/Mi/Gi prefixes", () => {
    expect(formatUnitValue(0, "B")).toBe("0 B");
    expect(formatUnitValue(2048, "B")).toBe("2.0 KiB");
    expect(formatUnitValue(3 * 1024 * 1024, "B")).toBe("3.0 MiB");
    expect(formatUnitValue(5 * 1024 ** 3, "B")).toBe("5.0 GiB");
  });

  it("formats °C directly", () => {
    expect(formatUnitValue(55.4321, "°C")).toBe("55.4 °C");
  });

  it("formats s/uptime as a scaled duration", () => {
    expect(formatUnitValue(0.5, "s")).toBe("500 ms");
    expect(formatUnitValue(45, "s")).toBe("45.0 s");
    expect(formatUnitValue(5400, "uptime")).toBe("1.5 h");
    expect(formatUnitValue(2 * 86400, "uptime")).toBe("2.0 d");
  });

  it("formats ms values by converting to seconds first", () => {
    expect(formatUnitValue(250, "ms")).toBe("250 ms");
    expect(formatUnitValue(2500, "ms")).toBe("2.5 s");
  });

  it("handles empty unit as a plain localized number", () => {
    expect(formatUnitValue(1234, undefined)).toBe("1.234");
  });

  it("handles unknown units with a suffix, SI-scaling large values", () => {
    expect(formatUnitValue(12, "rpm")).toBe("12 rpm");
    expect(formatUnitValue(15000, "req/s")).toBe("15.0 kreq/s");
  });

  it("returns a placeholder for non-finite values", () => {
    expect(formatUnitValue(NaN, "%")).toBe("–");
    expect(formatUnitValue(Infinity, "B")).toBe("–");
  });
});
