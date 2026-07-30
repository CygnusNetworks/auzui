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
  return `${scaled.toFixed(exp === 0 ? 0 : digits)} ${SI_PREFIXES[exp]}${suffix}`;
}

const IEC_PREFIXES = ["", "Ki", "Mi", "Gi", "Ti", "Pi"];

function formatIec(value: number, suffix: string, digits = 1): string {
  const abs = Math.abs(value);
  if (abs === 0) return `0 ${suffix}`;
  let exp = Math.min(Math.floor(Math.log(abs) / Math.log(1024)), IEC_PREFIXES.length - 1);
  if (exp < 0) exp = 0;
  const scaled = value / 1024 ** exp;
  return `${scaled.toFixed(exp === 0 ? 0 : digits)} ${IEC_PREFIXES[exp]}${suffix}`;
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
  if (unit === "s" || unit === "uptime") return formatDuration(value);
  if (unit === "ms") return formatDuration(value / 1000);
  if (unit === "bps" || unit === "Bps") return formatSi(value, unit, digits);
  if (unit === "B") return formatIec(value, unit, digits);
  if (!unit) return value.toLocaleString(intlLocaleTag(locale), { maximumFractionDigits: digits });

  // Fallback: generic unit suffix, SI-scaled only for large magnitudes.
  if (Math.abs(value) >= 1000) return formatSi(value, unit, digits);
  return `${value.toFixed(Number.isInteger(value) ? 0 : digits)} ${unit}`;
}

/** Short axis-tick variant (no rounding tweaks for tiny/large values beyond formatUnitValue). */
export function formatAxisTick(value: number, units: string | undefined, locale: Locale = "de"): string {
  return formatUnitValue(value, units, 0, locale);
}
