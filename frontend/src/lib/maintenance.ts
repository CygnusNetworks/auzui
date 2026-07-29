export type MaintenanceStatus = "active" | "planned" | "expired";

/** Pure status classification — active_since/active_till are unix seconds. */
export function maintenanceStatus(
  m: { active_since: string; active_till: string },
  nowSeconds: number,
): MaintenanceStatus {
  const since = Number(m.active_since);
  const till = Number(m.active_till);
  if (nowSeconds < since) return "planned";
  if (nowSeconds >= till) return "expired";
  return "active";
}

export interface MaintenancePayloadInput {
  name: string;
  description?: string;
  hostids: string[];
  groupids: string[];
  startSeconds: number;
  durationSeconds: number;
  withDataCollection: boolean;
}

export interface MaintenanceCreatePayload {
  name: string;
  active_since: number;
  active_till: number;
  hosts?: { hostid: string }[];
  groups?: { groupid: string }[];
  timeperiods: { timeperiod_type: number; period: number }[];
  maintenance_type: 0 | 1;
  description?: string;
}

/** Validates + shapes maintenance.create params. Throws (German message) on invalid input. */
export function buildMaintenancePayload(input: MaintenancePayloadInput): MaintenanceCreatePayload {
  const name = input.name.trim();
  if (!name) throw new Error("Name darf nicht leer sein.");
  if (input.hostids.length === 0 && input.groupids.length === 0) {
    throw new Error("Mindestens ein Host oder eine Hostgruppe auswählen.");
  }
  if (input.durationSeconds <= 0) throw new Error("Dauer muss größer als 0 sein.");

  const payload: MaintenanceCreatePayload = {
    name,
    active_since: input.startSeconds,
    active_till: input.startSeconds + input.durationSeconds,
    timeperiods: [{ timeperiod_type: 0, period: input.durationSeconds }],
    maintenance_type: input.withDataCollection ? 0 : 1,
  };
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
