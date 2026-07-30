import { describe, expect, it } from "vitest";
import { mixHex, seriesPaletteSlot, shadeHex } from "../series-colors";

describe("seriesPaletteSlot", () => {
  it("cycles through the 4 palette slots and bumps the tier on wrap", () => {
    expect(seriesPaletteSlot(0)).toEqual({ paletteIndex: 0, tier: 0 });
    expect(seriesPaletteSlot(3)).toEqual({ paletteIndex: 3, tier: 0 });
    expect(seriesPaletteSlot(4)).toEqual({ paletteIndex: 0, tier: 1 });
    expect(seriesPaletteSlot(9)).toEqual({ paletteIndex: 1, tier: 2 });
  });

  it("clamps negatives and floors fractions", () => {
    expect(seriesPaletteSlot(-1)).toEqual({ paletteIndex: 0, tier: 0 });
    expect(seriesPaletteSlot(2.9)).toEqual({ paletteIndex: 2, tier: 0 });
  });
});

describe("mixHex", () => {
  it("mixes toward white and black by the given fraction", () => {
    expect(mixHex("#000000", "white", 0.5)).toBe("#808080");
    expect(mixHex("#ffffff", "black", 0.5)).toBe("#808080");
    expect(mixHex("#3b6be8", "white", 0)).toBe("#3b6be8");
  });

  it("expands 3-digit hex and returns invalid input unchanged", () => {
    expect(mixHex("#fff", "black", 0)).toBe("#ffffff");
    expect(mixHex("not-a-color", "white", 0.5)).toBe("not-a-color");
  });
});

describe("shadeHex", () => {
  it("returns the base at tier 0 and a distinct shade otherwise", () => {
    const base = "#3b6be8";
    expect(shadeHex(base, 0)).toBe(base);
    const t1 = shadeHex(base, 1);
    const t2 = shadeHex(base, 2);
    expect(t1).not.toBe(base);
    expect(t2).not.toBe(base);
    expect(t1).not.toBe(t2);
  });
});
