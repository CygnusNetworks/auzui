import type { ZabbixTimeperiod } from "@auzui/zabbix-client";

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

export interface MaintenancePayloadInput {
  name: string;
  description?: string;
  hostids: string[];
  groupids: string[];
  startSeconds: number;
  durationSeconds: number;
  withDataCollection: boolean;
  /** Recurrence: "once" (default) builds a single active_since..active_till frame; "weekly" repeats on the given weekdays within a 1-year frame. */
  recurrence?: "once" | "weekly";
  /** Weekly only: bitmask bit0=Mon…bit6=Sun. Required (and >0) when recurrence is "weekly". */
  dayofweek?: number;
  /** Weekly only: seconds since midnight. Required when recurrence is "weekly". */
  startTimeSeconds?: number;
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
  }[];
  maintenance_type: 0 | 1;
  description?: string;
}

const YEAR_SECONDS = 365 * 86400;

/** Validates + shapes maintenance.create params. Throws (German message) on invalid input. */
export function buildMaintenancePayload(input: MaintenancePayloadInput): MaintenanceCreatePayload {
  const name = input.name.trim();
  if (!name) throw new Error("Name darf nicht leer sein.");
  if (input.hostids.length === 0 && input.groupids.length === 0) {
    throw new Error("Mindestens ein Host oder eine Hostgruppe auswählen.");
  }
  if (input.durationSeconds <= 0) throw new Error("Dauer muss größer als 0 sein.");

  const recurrence = input.recurrence ?? "once";

  let payload: MaintenanceCreatePayload;
  if (recurrence === "weekly") {
    if (!input.dayofweek) throw new Error("Mindestens einen Wochentag auswählen.");
    if (input.startTimeSeconds === undefined) throw new Error("Uhrzeit fehlt.");
    payload = {
      name,
      active_since: input.startSeconds,
      active_till: input.startSeconds + YEAR_SECONDS,
      timeperiods: [
        {
          timeperiod_type: 3,
          period: input.durationSeconds,
          every: 1,
          dayofweek: input.dayofweek,
          start_time: input.startTimeSeconds,
        },
      ],
      maintenance_type: input.withDataCollection ? 0 : 1,
    };
  } else {
    payload = {
      name,
      active_since: input.startSeconds,
      active_till: input.startSeconds + input.durationSeconds,
      timeperiods: [{ timeperiod_type: 0, period: input.durationSeconds }],
      maintenance_type: input.withDataCollection ? 0 : 1,
    };
  }
  if (input.hostids.length > 0) payload.hosts = input.hostids.map((hostid) => ({ hostid }));
  if (input.groupids.length > 0) payload.groups = input.groupids.map((groupid) => ({ groupid }));
  if (input.description?.trim()) payload.description = input.description.trim();
  return payload;
}

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

/** "29.07., 16:00 – 20:00" bzw. mit Datum auf beiden Seiten wenn tagübergreifend. */
export function formatWindow(sinceSeconds: number, tillSeconds: number): string {
  const since = new Date(sinceSeconds * 1000);
  const till = new Date(tillSeconds * 1000);
  const sameDay = dateFmt.format(since) === dateFmt.format(till);
  if (sameDay) {
    return `${dateFmt.format(since)}, ${timeFmt.format(since)} – ${timeFmt.format(till)}`;
  }
  return `${dateFmt.format(since)}, ${timeFmt.format(since)} – ${dateFmt.format(till)}, ${timeFmt.format(till)}`;
}

const dateWithYearFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

/** "Rahmen: 02.02.26 – 02.02.27" — the outer active_since..active_till frame of a recurring maintenance. */
export function formatFrame(sinceSeconds: number, tillSeconds: number): string {
  const since = new Date(sinceSeconds * 1000);
  const till = new Date(tillSeconds * 1000);
  return `Rahmen: ${dateWithYearFmt.format(since)} – ${dateWithYearFmt.format(till)}`;
}

/** "72 min" / "8 h" / "3 d" — whole units only, seconds-in ("period" from Zabbix). */
export function formatDuration(seconds: number): string {
  if (seconds >= 86400 && seconds % 86400 === 0) return `${seconds / 86400} d`;
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} h`;
  return `${Math.round(seconds / 60)} min`;
}

export const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Bitmask bit0=Mon…bit6=Sun → ["Mo", "Di", ...] in weekday order. */
export function decodeDayOfWeekMask(mask: number): string[] {
  return WEEKDAY_LABELS.filter((_, i) => (mask & (1 << i)) !== 0);
}

/** WEEKDAY_LABELS index (0=Mo) → bit value, for building a dayofweek bitmask from checkbox state. */
export function dayOfWeekBit(index: number): number {
  return 1 << index;
}

function formatStartTime(secondsSinceMidnight: number): string {
  const h = Math.floor(secondsSinceMidnight / 3600);
  const m = Math.floor((secondsSinceMidnight % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * "einmalig 11.02., 06:00 (8 h)" / "täglich 09:00 (72 min)" /
 * "wöchentlich Di 09:00 (72 min)" (mehrere Tage: "Mo, Di, Fr") /
 * "monatlich am {day}. {HH:MM} ({Dauer})" — day-of-week monthly rules ("2nd
 * Tuesday of the month") are rare and rendered as raw fallback text instead
 * of being fully modeled.
 */
export function describeTimeperiod(tp: ZabbixTimeperiod): string {
  const duration = formatDuration(Number(tp.period));
  switch (tp.timeperiod_type) {
    case "0": {
      if (!tp.start_date) return `einmalig (${duration})`;
      const start = new Date(Number(tp.start_date) * 1000);
      return `einmalig ${dateFmt.format(start)}, ${timeFmt.format(start)} (${duration})`;
    }
    case "2": {
      const start = formatStartTime(Number(tp.start_time ?? 0));
      return `täglich ${start} (${duration})`;
    }
    case "3": {
      const days = decodeDayOfWeekMask(Number(tp.dayofweek ?? 0));
      const start = formatStartTime(Number(tp.start_time ?? 0));
      const dayLabel = days.length > 0 ? days.join(", ") : "?";
      return `wöchentlich ${dayLabel} ${start} (${duration})`;
    }
    case "4": {
      if (Number(tp.dayofweek ?? 0) !== 0) return "monatlich (komplex)";
      const start = formatStartTime(Number(tp.start_time ?? 0));
      return `monatlich am ${tp.day ?? "?"}. ${start} (${duration})`;
    }
    default:
      return "unbekanntes Zeitfenster";
  }
}
