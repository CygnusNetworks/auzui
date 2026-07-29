import type { ZabbixTimeperiod } from "@auzui/zabbix-client";
import type { Locale } from "./i18n";
import { de } from "../locales/de";
import { en } from "../locales/en";

interface MaintenanceCatalog {
  errors: {
    nameEmpty: string;
    noHostOrGroup: string;
    durationZero: string;
    timeMissing: string;
    weekdayMissing: string;
    monthDayMissing: string;
    weekdayOnlyMissing: string;
    occurrenceMissing: string;
    monthMissing: string;
  };
  weekdayShort: readonly string[];
  weekdayFull: readonly string[];
  months: readonly string[];
  weekdayOccurrence: readonly string[];
  frame: (range: string) => string;
  durationMinutes: (n: number) => string;
  durationHours: (n: number) => string;
  durationDays: (n: number) => string;
  period: {
    onceNoDate: (duration: string) => string;
    once: (date: string, time: string, duration: string) => string;
    daily: (time: string, duration: string) => string;
    weekly: (days: string, time: string, duration: string) => string;
    monthlyDay: (day: string, time: string, duration: string) => string;
    yearly: (day: string, month: string, time: string, duration: string) => string;
    monthlyWeekday: (occurrence: string, weekday: string, time: string, duration: string) => string;
    monthlyComplex: string;
    unknown: string;
    occurrenceLast: string;
    unknownDay: string;
  };
}

const MAINTENANCE_CATALOG: Record<Locale, MaintenanceCatalog> = {
  de: de.maintenance,
  en: en.maintenance,
};

export type MaintenanceStatus = "active" | "planned" | "expired";

/**
 * Status classification. active_since/active_till are unix seconds and bound
 * the outer "frame" of the maintenance (for recurring windows this is just
 * the frame within which occurrences happen, not the occurrence itself).
 *
 * "Aktiv" is no longer just "now inside the frame" — Zabbix itself computes
 * per-host maintenance_status (it knows about recurring occurrences, holes,
 * etc.), so we trust that: active only if at least one host of this
 * maintenance shows up in the host.get maintenance_status=1 query with a
 * matching maintenanceid (see useHostsInMaintenance). Inside the frame but
 * without a matching active host (e.g. a weekly window between occurrences)
 * → "planned", not "active".
 */
export function maintenanceStatus(
  m: { maintenanceid: string; active_since: string; active_till: string },
  nowSeconds: number,
  activeMaintenanceIds: ReadonlySet<string> = new Set(),
): MaintenanceStatus {
  const since = Number(m.active_since);
  const till = Number(m.active_till);
  if (nowSeconds < since) return "planned";
  if (nowSeconds >= till) return "expired";
  return activeMaintenanceIds.has(m.maintenanceid) ? "active" : "planned";
}

export type MaintenanceRecurrence =
  | "once"
  | "daily"
  | "weekly"
  | "monthlyDay"
  | "monthlyWeekday"
  | "yearly";

export interface MaintenancePayloadInput {
  name: string;
  description?: string;
  hostids: string[];
  groupids: string[];
  startSeconds: number;
  durationSeconds: number;
  withDataCollection: boolean;
  /**
   * Recurrence: "once" (default) builds a single active_since..active_till frame.
   * All other variants repeat within a 1-year frame (see YEAR_SECONDS):
   * "daily" (every N days), "weekly" (given weekdays), "monthlyDay" (fixed
   * day-of-month), "monthlyWeekday" (e.g. "2nd Tuesday"), "yearly" (single
   * month + day-of-month, modeled as a monthly Zabbix timeperiod with a
   * one-month bitmask).
   */
  recurrence?: MaintenanceRecurrence;
  /** Seconds since midnight. Required for every recurrence except "once". */
  startTimeSeconds?: number;
  /** Daily only: repeat every N days. Defaults to 1. */
  everyDays?: number;
  /** Weekly: bitmask bit0=Mon…bit6=Sun. Required (and >0). Monthly-weekday: single bit for the chosen weekday. */
  dayofweek?: number;
  /** Weekly only: repeat every N weeks. Defaults to 1. */
  everyWeeks?: number;
  /** Monthly-weekday only: which occurrence in the month, 1=first…4=fourth, 5=last. */
  weekdayOccurrence?: number;
  /** MonthlyDay/Yearly only: day of month (1-31). */
  monthDay?: number;
  /** Yearly only: month (1=Jan…12=Dec). */
  month?: number;
}

export interface MaintenanceCreatePayload {
  name: string;
  active_since: number;
  active_till: number;
  hosts?: { hostid: string }[];
  groups?: { groupid: string }[];
  timeperiods: {
    timeperiod_type: number;
    period: number;
    every?: number;
    dayofweek?: number;
    start_time?: number;
    month?: number;
    day?: number;
  }[];
  maintenance_type: 0 | 1;
  description?: string;
}

const YEAR_SECONDS = 365 * 86400;

/** All months bitmask (bit0=Jan…bit11=Dec) — used for monthlyDay/monthlyWeekday, which recur every month. */
const ALL_MONTHS = 0b111111111111;

/** Validates + shapes maintenance.create params. Throws a localized message (default "de") on invalid input. */
export function buildMaintenancePayload(
  input: MaintenancePayloadInput,
  locale: Locale = "de",
): MaintenanceCreatePayload {
  const msg = MAINTENANCE_CATALOG[locale].errors;
  const name = input.name.trim();
  if (!name) throw new Error(msg.nameEmpty);
  if (input.hostids.length === 0 && input.groupids.length === 0) {
    throw new Error(msg.noHostOrGroup);
  }
  if (input.durationSeconds <= 0) throw new Error(msg.durationZero);

  const recurrence = input.recurrence ?? "once";

  let payload: MaintenanceCreatePayload;
  if (recurrence === "once") {
    payload = {
      name,
      active_since: input.startSeconds,
      active_till: input.startSeconds + input.durationSeconds,
      timeperiods: [{ timeperiod_type: 0, period: input.durationSeconds }],
      maintenance_type: input.withDataCollection ? 0 : 1,
    };
  } else {
    if (input.startTimeSeconds === undefined) throw new Error(msg.timeMissing);
    const start_time = input.startTimeSeconds;

    let timeperiod: MaintenanceCreatePayload["timeperiods"][number];
    switch (recurrence) {
      case "daily": {
        timeperiod = {
          timeperiod_type: 2,
          period: input.durationSeconds,
          every: input.everyDays ?? 1,
          start_time,
        };
        break;
      }
      case "weekly": {
        if (!input.dayofweek) throw new Error(msg.weekdayMissing);
        timeperiod = {
          timeperiod_type: 3,
          period: input.durationSeconds,
          every: input.everyWeeks ?? 1,
          dayofweek: input.dayofweek,
          start_time,
        };
        break;
      }
      case "monthlyDay": {
        if (!input.monthDay) throw new Error(msg.monthDayMissing);
        timeperiod = {
          timeperiod_type: 4,
          period: input.durationSeconds,
          month: ALL_MONTHS,
          day: input.monthDay,
          start_time,
        };
        break;
      }
      case "monthlyWeekday": {
        if (!input.dayofweek) throw new Error(msg.weekdayOnlyMissing);
        if (!input.weekdayOccurrence) throw new Error(msg.occurrenceMissing);
        timeperiod = {
          timeperiod_type: 4,
          period: input.durationSeconds,
          month: ALL_MONTHS,
          dayofweek: input.dayofweek,
          every: input.weekdayOccurrence,
          start_time,
        };
        break;
      }
      case "yearly": {
        if (!input.month) throw new Error(msg.monthMissing);
        if (!input.monthDay) throw new Error(msg.monthDayMissing);
        timeperiod = {
          timeperiod_type: 4,
          period: input.durationSeconds,
          month: 1 << (input.month - 1),
          day: input.monthDay,
          start_time,
        };
        break;
      }
    }

    payload = {
      name,
      active_since: input.startSeconds,
      active_till: input.startSeconds + YEAR_SECONDS,
      timeperiods: [timeperiod],
      maintenance_type: input.withDataCollection ? 0 : 1,
    };
  }
  if (input.hostids.length > 0) payload.hosts = input.hostids.map((hostid) => ({ hostid }));
  if (input.groupids.length > 0) payload.groups = input.groupids.map((groupid) => ({ groupid }));
  if (input.description?.trim()) payload.description = input.description.trim();
  return payload;
}

function intlLocale(locale: Locale): string {
  return locale === "de" ? "de-DE" : "en-US";
}

function dateFmt(locale: Locale): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(intlLocale(locale), { day: "2-digit", month: "2-digit" });
}
function timeFmt(locale: Locale): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: "2-digit", minute: "2-digit" });
}

/** "29.07., 16:00 – 20:00" bzw. mit Datum auf beiden Seiten wenn tagübergreifend. Default locale "de". */
export function formatWindow(sinceSeconds: number, tillSeconds: number, locale: Locale = "de"): string {
  const since = new Date(sinceSeconds * 1000);
  const till = new Date(tillSeconds * 1000);
  const df = dateFmt(locale);
  const tf = timeFmt(locale);
  const sameDay = df.format(since) === df.format(till);
  if (sameDay) {
    return `${df.format(since)}, ${tf.format(since)} – ${tf.format(till)}`;
  }
  return `${df.format(since)}, ${tf.format(since)} – ${df.format(till)}, ${tf.format(till)}`;
}

function dateWithYearFmt(locale: Locale): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

/** "Rahmen: 02.02.26 – 02.02.27" — the outer active_since..active_till frame of a recurring maintenance. Default locale "de". */
export function formatFrame(sinceSeconds: number, tillSeconds: number, locale: Locale = "de"): string {
  const since = new Date(sinceSeconds * 1000);
  const till = new Date(tillSeconds * 1000);
  const fmt = dateWithYearFmt(locale);
  return MAINTENANCE_CATALOG[locale].frame(`${fmt.format(since)} – ${fmt.format(till)}`);
}

/** "72 min" / "8 h" / "3 d" — whole units only, seconds-in ("period" from Zabbix). Default locale "de". */
export function formatDuration(seconds: number, locale: Locale = "de"): string {
  const t = MAINTENANCE_CATALOG[locale];
  if (seconds >= 86400 && seconds % 86400 === 0) return t.durationDays(seconds / 86400);
  if (seconds >= 3600 && seconds % 3600 === 0) return t.durationHours(seconds / 3600);
  return t.durationMinutes(Math.round(seconds / 60));
}

/** Short weekday labels (0=Mon…6=Sun), for the given locale (default "de"). */
export function weekdayLabels(locale: Locale = "de"): readonly string[] {
  return MAINTENANCE_CATALOG[locale].weekdayShort;
}

/** Full weekday names, same order as weekdayLabels(). */
export function weekdayFullLabels(locale: Locale = "de"): readonly string[] {
  return MAINTENANCE_CATALOG[locale].weekdayFull;
}

/** Full month names, bit0=Jan…bit11=Dec. */
export function monthLabels(locale: Locale = "de"): readonly string[] {
  return MAINTENANCE_CATALOG[locale].months;
}

/** UI labels for the monthly "x-th weekday" occurrence select (index 1=first…5=last). */
export function weekdayOccurrenceLabels(locale: Locale = "de"): readonly string[] {
  return MAINTENANCE_CATALOG[locale].weekdayOccurrence;
}

/** @deprecated use weekdayLabels(); kept for existing call-sites/tests, always German. */
export const WEEKDAY_LABELS = MAINTENANCE_CATALOG.de.weekdayShort;
/** @deprecated use weekdayFullLabels(); kept for existing call-sites/tests, always German. */
export const WEEKDAY_FULL_LABELS = MAINTENANCE_CATALOG.de.weekdayFull;
/** @deprecated use monthLabels(); kept for existing call-sites/tests, always German. */
export const MONTH_LABELS = MAINTENANCE_CATALOG.de.months;
/** @deprecated use weekdayOccurrenceLabels(); kept for existing call-sites/tests, always German. */
export const WEEKDAY_OCCURRENCE_LABELS = MAINTENANCE_CATALOG.de.weekdayOccurrence;

/** Bitmask bit0=Mon…bit6=Sun → ["Mo", "Di", ...] (or locale equivalent) in weekday order. */
export function decodeDayOfWeekMask(mask: number, locale: Locale = "de"): string[] {
  const labels = weekdayLabels(locale);
  return labels.filter((_, i) => (mask & (1 << i)) !== 0);
}

/** WEEKDAY_LABELS index (0=Mo) → bit value, for building a dayofweek bitmask from checkbox state. */
export function dayOfWeekBit(index: number): number {
  return 1 << index;
}

/** MONTH_LABELS index (0=Jan) → bit value, for building a month bitmask. */
export function monthBit(index: number): number {
  return 1 << index;
}

/** Returns the 0-based bit index if mask has exactly one bit set, otherwise null. */
function singleBitIndex(mask: number): number | null {
  if (mask <= 0 || (mask & (mask - 1)) !== 0) return null;
  return Math.round(Math.log2(mask));
}

function formatStartTime(secondsSinceMidnight: number): string {
  const h = Math.floor(secondsSinceMidnight / 3600);
  const m = Math.floor((secondsSinceMidnight % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * "einmalig 11.02., 06:00 (8 h)" / "täglich 09:00 (72 min)" /
 * "wöchentlich Di 09:00 (72 min)" (mehrere Tage: "Mo, Di, Fr") /
 * "monatlich am 15. 01:00 (30 min)" / "monatlich am 2. Dienstag 09:00 (1 h)"
 * (letzter Wochentag: "monatlich am letzten Dienstag …") /
 * "jährlich am 15. März 09:00 (1 h)" (monthly rule with a single month bit).
 * Default locale "de".
 */
export function describeTimeperiod(tp: ZabbixTimeperiod, locale: Locale = "de"): string {
  const t = MAINTENANCE_CATALOG[locale].period;
  const months = monthLabels(locale);
  const weekdayFull = weekdayFullLabels(locale);
  const duration = formatDuration(Number(tp.period), locale);
  switch (tp.timeperiod_type) {
    case "0": {
      if (!tp.start_date) return t.onceNoDate(duration);
      const start = new Date(Number(tp.start_date) * 1000);
      return t.once(dateFmt(locale).format(start), timeFmt(locale).format(start), duration);
    }
    case "2": {
      const start = formatStartTime(Number(tp.start_time ?? 0));
      return t.daily(start, duration);
    }
    case "3": {
      const days = decodeDayOfWeekMask(Number(tp.dayofweek ?? 0), locale);
      const start = formatStartTime(Number(tp.start_time ?? 0));
      const dayLabel = days.length > 0 ? days.join(", ") : t.unknownDay;
      return t.weekly(dayLabel, start, duration);
    }
    case "4": {
      const start = formatStartTime(Number(tp.start_time ?? 0));
      const dow = Number(tp.dayofweek ?? 0);
      const monthMask = Number(tp.month ?? 0);
      const singleMonth = singleBitIndex(monthMask);

      if (dow === 0) {
        // Day-of-month mode.
        const day = tp.day ?? t.unknownDay;
        if (singleMonth !== null) {
          return t.yearly(String(day), months[singleMonth]!, start, duration);
        }
        return t.monthlyDay(String(day), start, duration);
      }

      // Weekday-of-month mode ("2nd Tuesday", "last Friday", …).
      const weekdayIndex = singleBitIndex(dow);
      const occurrence = Number(tp.every ?? 0);
      if (weekdayIndex !== null && occurrence >= 1 && occurrence <= 5) {
        const weekdayLabel = weekdayFull[weekdayIndex]!;
        const occurrenceLabel = occurrence === 5 ? t.occurrenceLast : `${occurrence}.`;
        return t.monthlyWeekday(occurrenceLabel, weekdayLabel, start, duration);
      }
      return t.monthlyComplex;
    }
    default:
      return t.unknown;
  }
}
