/**
 * Zabbix `units` → human-readable formatting. Shared between the TimeChart
 * y-axis and Latest-Data value column, so both read a threshold or a
 * lastvalue the same way. Priority mirrors PLAN.md: bps/Bps → SI, B → IEC,
 * % → 0-100, s/ms/uptime → duration, °C direct, anything else → plain number
 * + unit suffix.
 */
import type { Locale } from "./i18n";

function intlLocaleTag(locale: Locale): string {
  return locale === "de" ? "de-DE" : "en-US";
}

const SI_PREFIXES = ["", "k", "M", "G", "T", "P"];

function formatSi(value: number, suffix: string, digits = 1): string {
  const abs = Math.abs(value);
  if (abs === 0) return `0 ${suffix}`;
  let exp = Math.min(Math.floor(Math.log10(abs) / 3), SI_PREFIXES.length - 1);
  if (exp < 0) exp = 0;
  const scaled = value / 1000 ** exp;
  // Unscaled (exp 0) values are usually whole counts ("500 bps") and print
  // without decimals — but a genuinely fractional unscaled value (e.g. an
  // axis tick at 0.3 bps) still needs `digits`, or it rounds away to "0".
  return `${scaled.toFixed(exp === 0 && Number.isInteger(scaled) ? 0 : digits)} ${SI_PREFIXES[exp]}${suffix}`;
}

const IEC_PREFIXES = ["", "Ki", "Mi", "Gi", "Ti", "Pi"];

function formatIec(value: number, suffix: string, digits = 1): string {
  const abs = Math.abs(value);
  if (abs === 0) return `0 ${suffix}`;
  let exp = Math.min(Math.floor(Math.log(abs) / Math.log(1024)), IEC_PREFIXES.length - 1);
  if (exp < 0) exp = 0;
  const scaled = value / 1024 ** exp;
  return `${scaled.toFixed(exp === 0 && Number.isInteger(scaled) ? 0 : digits)} ${IEC_PREFIXES[exp]}${suffix}`;
}

function formatUnixDateTime(seconds: number, locale: Locale): string {
  return new Date(seconds * 1000).toLocaleString(intlLocaleTag(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number): string {
  const abs = Math.abs(seconds);
  if (abs < 1) return `${(seconds * 1000).toFixed(0)} ms`;
  if (abs < 60) return `${seconds.toFixed(1)} s`;
  if (abs < 3600) return `${(seconds / 60).toFixed(1)} min`;
  if (abs < 86400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} d`;
}

/**
 * Formats a raw item value with its Zabbix `units` string. `units` is
 * whatever the item declares — usually a bare tag like "bps", "%", "B", "s",
 * "°C", "uptime", or empty/custom (e.g. "req/s", "rpm").
 */
export function formatUnitValue(
  value: number,
  units: string | undefined,
  digits = 1,
  locale: Locale = "de",
): string {
  if (!Number.isFinite(value)) return "–";
  const raw = (units ?? "").trim();

  // Zabbix "!"-prefixed units mean "do NOT convert/scale — show the value with
  // the literal unit as written" (e.g. "!r/s", "!ms" stay r/s and ms, never
  // scaled to k/M or turned into a duration). Strip the "!" and print plainly.
  if (raw.startsWith("!")) {
    const literal = raw.slice(1).trim();
    const num = value.toLocaleString(intlLocaleTag(locale), { maximumFractionDigits: digits });
    return literal ? `${num} ${literal}` : num;
  }

  const unit = raw;

  if (unit === "%") return `${value.toFixed(digits)} %`;
  if (unit === "°C" || unit === "C") return `${value.toFixed(digits)} °C`;
  if (unit === "unixtime") return formatUnixDateTime(value, locale);
  if (unit === "s" || unit === "uptime") return formatDuration(value);
  if (unit === "ms") return formatDuration(value / 1000);
  if (unit === "bps" || unit === "Bps") return formatSi(value, unit, digits);
  if (unit === "B") return formatIec(value, unit, digits);
  if (!unit) return value.toLocaleString(intlLocaleTag(locale), { maximumFractionDigits: digits });

  // Fallback: generic unit suffix, SI-scaled only for large magnitudes.
  if (Math.abs(value) >= 1000) return formatSi(value, unit, digits);
  return `${value.toFixed(Number.isInteger(value) ? 0 : digits)} ${unit}`;
}

/** Short axis-tick variant; `digits` should come from {@link decimalsForTicks} on the tick's sibling values. */
export function formatAxisTick(value: number, units: string | undefined, locale: Locale = "de", digits = 0): string {
  return formatUnitValue(value, units, digits, locale);
}

/**
 * How many decimal places an axis needs to label a set of ticks without two
 * distinct ticks colliding on the same rounded label, and without a nonzero
 * tick reading as "0" — the bug behind e.g. four ticks between 0 and 1 all
 * showing "0" when `formatAxisTick` used a hardcoded 0 digits. Tries 0..3 and
 * picks the smallest that avoids both problems; a genuine repeated 0 (the
 * value, not a rounding artifact) is fine at any precision.
 */
export function decimalsForTicks(vals: readonly (number | null | undefined)[]): number {
  const finite = vals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  for (let d = 0; d <= 3; d++) {
    const seen = new Map<string, number>();
    let ok = true;
    for (const v of finite) {
      const label = v.toFixed(d);
      if (v !== 0 && Number(label) === 0) {
        ok = false;
        break;
      }
      const prior = seen.get(label);
      if (prior !== undefined && prior !== v) {
        ok = false;
        break;
      }
      seen.set(label, v);
    }
    if (ok) return d;
  }
  return 3;
}
