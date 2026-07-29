import { describe, expect, it } from "vitest";
import {
  buildMaintenancePayload,
  decodeDayOfWeekMask,
  describeTimeperiod,
  formatDuration,
  formatFrame,
  formatWindow,
  maintenanceStatus,
} from "../maintenance";

describe("maintenanceStatus", () => {
  const m = { maintenanceid: "10", active_since: "1000", active_till: "2000" };

  it("is planned before active_since", () => {
    expect(maintenanceStatus(m, 999, new Set(["10"]))).toBe("planned");
  });

  it("is active at the start boundary when a host is marked active for this maintenanceid", () => {
    expect(maintenanceStatus(m, 1000, new Set(["10"]))).toBe("active");
  });

  it("is planned inside the window when no host reports this maintenanceid as active (recurring window between occurrences)", () => {
    expect(maintenanceStatus(m, 1500, new Set())).toBe("planned");
  });

  it("is planned inside the window when a different maintenanceid is active", () => {
    expect(maintenanceStatus(m, 1500, new Set(["99"]))).toBe("planned");
  });

  it("is expired at the exact end boundary even if still reported active", () => {
    expect(maintenanceStatus(m, 2000, new Set(["10"]))).toBe("expired");
  });

  it("is expired well after the end", () => {
    expect(maintenanceStatus(m, 3000, new Set(["10"]))).toBe("expired");
  });

  it("defaults to an empty active set", () => {
    expect(maintenanceStatus(m, 1500)).toBe("planned");
  });
});

describe("buildMaintenancePayload", () => {
  const base = {
    name: "Wartung",
    hostids: ["1"],
    groupids: [],
    startSeconds: 1000,
    durationSeconds: 3600,
    withDataCollection: true,
  };

  it("builds a payload with hosts, one timeperiod and active_till = start + duration", () => {
    const payload = buildMaintenancePayload(base);
    expect(payload).toMatchObject({
      name: "Wartung",
      active_since: 1000,
      active_till: 4600,
      hosts: [{ hostid: "1" }],
      timeperiods: [{ timeperiod_type: 0, period: 3600 }],
      maintenance_type: 0,
    });
    expect(payload.groups).toBeUndefined();
  });

  it("omits hosts when empty and includes groups when present", () => {
    const payload = buildMaintenancePayload({ ...base, hostids: [], groupids: ["5"] });
    expect(payload.hosts).toBeUndefined();
    expect(payload.groups).toEqual([{ groupid: "5" }]);
  });

  it("maps withDataCollection to maintenance_type 0/1", () => {
    expect(buildMaintenancePayload(base).maintenance_type).toBe(0);
    expect(buildMaintenancePayload({ ...base, withDataCollection: false }).maintenance_type).toBe(1);
  });

  it("includes trimmed description only when non-empty", () => {
    expect(buildMaintenancePayload(base).description).toBeUndefined();
    expect(buildMaintenancePayload({ ...base, description: "  Kernel-Update  " }).description).toBe(
      "Kernel-Update",
    );
  });

  it("throws on an empty name", () => {
    expect(() => buildMaintenancePayload({ ...base, name: "  " })).toThrow();
  });

  it("throws when neither hosts nor groups are selected", () => {
    expect(() => buildMaintenancePayload({ ...base, hostids: [], groupids: [] })).toThrow();
  });

  it("throws on a non-positive duration", () => {
    expect(() => buildMaintenancePayload({ ...base, durationSeconds: 0 })).toThrow();
  });

  it("builds a weekly recurring timeperiod (type 3) with a 1-year frame", () => {
    const payload = buildMaintenancePayload({
      ...base,
      recurrence: "weekly",
      dayofweek: 2,
      startTimeSeconds: 32400,
      durationSeconds: 4320,
    });
    expect(payload.active_since).toBe(1000);
    expect(payload.active_till).toBe(1000 + 365 * 86400);
    expect(payload.timeperiods).toEqual([
      { timeperiod_type: 3, period: 4320, every: 1, dayofweek: 2, start_time: 32400 },
    ]);
  });

  it("throws for weekly recurrence without any weekday selected", () => {
    expect(() =>
      buildMaintenancePayload({ ...base, recurrence: "weekly", dayofweek: 0, startTimeSeconds: 0 }),
    ).toThrow();
  });

  it("throws for weekly recurrence without a start time", () => {
    expect(() =>
      buildMaintenancePayload({ ...base, recurrence: "weekly", dayofweek: 1 }),
    ).toThrow();
  });
});

describe("formatWindow", () => {
  it("formats a same-day window with a single date and a time range", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatWindow(now, now + 2 * 3600);
    expect(result).toMatch(/^\d{2}\.\d{2}\., \d{2}:\d{2} – \d{2}:\d{2}$/);
  });

  it("formats a window spanning multiple days with both dates", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = formatWindow(now, now + 3 * 86400);
    expect(result).toMatch(
      /^\d{2}\.\d{2}\., \d{2}:\d{2} – \d{2}\.\d{2}\., \d{2}:\d{2}$/,
    );
  });
});

describe("formatFrame", () => {
  it("formats the outer frame with 2-digit years", () => {
    const since = Date.UTC(2026, 1, 2, 10, 0) / 1000;
    const till = Date.UTC(2027, 1, 2, 10, 0) / 1000;
    expect(formatFrame(since, till)).toMatch(/^Rahmen: \d{2}\.\d{2}\.\d{2} – \d{2}\.\d{2}\.\d{2}$/);
  });
});

describe("formatDuration", () => {
  it("formats sub-hour durations in minutes", () => {
    expect(formatDuration(4320)).toBe("72 min");
    expect(formatDuration(60)).toBe("1 min");
  });

  it("formats whole hours in hours", () => {
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(8 * 3600)).toBe("8 h");
  });

  it("formats whole days in days", () => {
    expect(formatDuration(2 * 86400)).toBe("2 d");
  });

  it("falls back to minutes for a duration that isn't a whole hour", () => {
    expect(formatDuration(5400)).toBe("90 min");
  });
});

describe("decodeDayOfWeekMask", () => {
  it("decodes bit0=Mon", () => {
    expect(decodeDayOfWeekMask(1)).toEqual(["Mo"]);
  });

  it("decodes bit1=Tue (the real-world example from PLAN.md)", () => {
    expect(decodeDayOfWeekMask(2)).toEqual(["Di"]);
  });

  it("decodes bit6=Sun", () => {
    expect(decodeDayOfWeekMask(64)).toEqual(["So"]);
  });

  it("decodes multiple days in weekday order regardless of bit order", () => {
    // Fr (bit4=16) + Mo (bit0=1) + Di (bit1=2)
    expect(decodeDayOfWeekMask(16 + 1 + 2)).toEqual(["Mo", "Di", "Fr"]);
  });

  it("decodes an empty mask to no days", () => {
    expect(decodeDayOfWeekMask(0)).toEqual([]);
  });

  it("decodes all days set", () => {
    expect(decodeDayOfWeekMask(127)).toEqual(["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]);
  });
});

describe("describeTimeperiod", () => {
  it("describes a one-time window", () => {
    const start = Math.floor(Date.UTC(2026, 1, 11, 6, 0) / 1000);
    const result = describeTimeperiod({ timeperiod_type: "0", start_date: String(start), period: "28800" });
    expect(result).toMatch(/^einmalig \d{2}\.\d{2}\., \d{2}:\d{2} \(8 h\)$/);
  });

  it("describes a daily window", () => {
    const result = describeTimeperiod({ timeperiod_type: "2", start_time: "32400", period: "4320" });
    expect(result).toBe("täglich 09:00 (72 min)");
  });

  it("describes the PLAN.md real-world weekly example (Tuesday 09:00, 72 min)", () => {
    const result = describeTimeperiod({
      timeperiod_type: "3",
      every: "1",
      dayofweek: "2",
      start_time: "32400",
      period: "4320",
    });
    expect(result).toBe("wöchentlich Di 09:00 (72 min)");
  });

  it("describes a weekly window spanning several days", () => {
    const result = describeTimeperiod({
      timeperiod_type: "3",
      dayofweek: String(1 + 2 + 16), // Mo, Di, Fr
      start_time: "0",
      period: "3600",
    });
    expect(result).toBe("wöchentlich Mo, Di, Fr 00:00 (1 h)");
  });

  it("describes a monthly window by day-of-month", () => {
    const result = describeTimeperiod({
      timeperiod_type: "4",
      dayofweek: "0",
      day: "15",
      start_time: "3600",
      period: "1800",
    });
    expect(result).toBe("monatlich am 15. 01:00 (30 min)");
  });

  it("falls back to raw text for day-of-week monthly rules", () => {
    const result = describeTimeperiod({
      timeperiod_type: "4",
      dayofweek: "1",
      every: "2",
      start_time: "0",
      period: "3600",
    });
    expect(result).toBe("monatlich (komplex)");
  });
});
