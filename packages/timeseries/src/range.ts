import type { TimeRange } from "./source";

export type RangePreset = "15m" | "1h" | "6h" | "24h" | "7d" | "30d" | "365d";

const PRESET_SECONDS: Record<RangePreset, number> = {
  "15m": 15 * 60,
  "1h": 3600,
  "6h": 6 * 3600,
  "24h": 24 * 3600,
  "7d": 7 * 86400,
  "30d": 30 * 86400,
  "365d": 365 * 86400,
};

export function presetSeconds(preset: RangePreset): number {
  return PRESET_SECONDS[preset];
}

export function rangeFromPreset(preset: RangePreset, now: number = nowSeconds()): TimeRange {
  return { from: now - PRESET_SECONDS[preset], to: now };
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Same range shifted back by `offsetSeconds` — used for the 7-day ghost line. */
export function shiftedRange(range: TimeRange, offsetSeconds: number): TimeRange {
  return { from: range.from - offsetSeconds, to: range.to - offsetSeconds };
}
