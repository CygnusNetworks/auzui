import { describe, expect, it } from "vitest";
import {
  buildMaintenancePayload,
  decodeDayOfWeekMask,
  describeTimeperiod,
  formatDuration,
  formatFrame,
  formatWindow,
  maintenanceStatus,
  maintenanceToFormState,
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

  it("sets start_date on one-time periods (Zabbix would default to creation time)", () => {
    const payload = buildMaintenancePayload(base);
    expect(payload.timeperiods[0]!.start_date).toBe(1000);
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

  it("builds a daily recurring timeperiod (type 2) with a 1-year frame", () => {
    const payload = buildMaintenancePayload({
      ...base,
      recurrence: "daily",
      startTimeSeconds: 32400,
      durationSeconds: 4320,
    });
    expect(payload.active_since).toBe(1000);
    expect(payload.active_till).toBe(1000 + 365 * 86400);
    expect(payload.timeperiods).toEqual([
      { timeperiod_type: 2, period: 4320, every: 1, start_time: 32400 },
    ]);
  });

  it("builds a daily recurring timeperiod with a custom every-N-days interval", () => {
    const payload = buildMaintenancePayload({
      ...base,
      recurrence: "daily",
      startTimeSeconds: 0,
      everyDays: 3,
    });
    expect(payload.timeperiods[0]).toMatchObject({ timeperiod_type: 2, every: 3 });
  });

  it("throws for daily recurrence without a start time", () => {
    expect(() => buildMaintenancePayload({ ...base, recurrence: "daily" })).toThrow();
  });

  it("builds a monthly-day-of-month timeperiod (type 4) with a 1-year frame", () => {
    const payload = buildMaintenancePayload({
      ...base,
      recurrence: "monthlyDay",
      monthDay: 15,
      startTimeSeconds: 3600,
      durationSeconds: 1800,
    });
    expect(payload.active_till).toBe(1000 + 365 * 86400);
    expect(payload.timeperiods).toEqual([
      { timeperiod_type: 4, period: 1800, month: 0b111111111111, day: 15, start_time: 3600 },
    ]);
  });

  it("throws for monthlyDay recurrence without a day of month", () => {
    expect(() =>
      buildMaintenancePayload({ ...base, recurrence: "monthlyDay", startTimeSeconds: 0 }),
    ).toThrow();
  });

  it("builds a monthly-weekday timeperiod (e.g. 2nd Tuesday)", () => {
    const payload = buildMaintenancePayload({
      ...base,
      recurrence: "monthlyWeekday",
      dayofweek: 2,
      weekdayOccurrence: 2,
      startTimeSeconds: 32400,
      durationSeconds: 4320,
    });
    expect(payload.timeperiods).toEqual([
      {
        timeperiod_type: 4,
        period: 4320,
        month: 0b111111111111,
        dayofweek: 2,
        every: 2,
        start_time: 32400,
      },
    ]);
  });

  it("throws for monthlyWeekday recurrence without a weekday", () => {
    expect(() =>
      buildMaintenancePayload({
        ...base,
        recurrence: "monthlyWeekday",
        weekdayOccurrence: 2,
        startTimeSeconds: 0,
      }),
    ).toThrow();
  });

  it("throws for monthlyWeekday recurrence without an occurrence", () => {
    expect(() =>
      buildMaintenancePayload({
        ...base,
        recurrence: "monthlyWeekday",
        dayofweek: 2,
        startTimeSeconds: 0,
      }),
    ).toThrow();
  });

  it("builds a yearly timeperiod as a monthly rule with a single-month bitmask", () => {
    const payload = buildMaintenancePayload({
      ...base,
      recurrence: "yearly",
      month: 3,
      monthDay: 15,
      startTimeSeconds: 3600,
      durationSeconds: 1800,
    });
    expect(payload.timeperiods).toEqual([
      { timeperiod_type: 4, period: 1800, month: 0b100, day: 15, start_time: 3600 },
    ]);
  });

  it("throws for yearly recurrence without a month or day", () => {
    expect(() =>
      buildMaintenancePayload({ ...base, recurrence: "yearly", monthDay: 15, startTimeSeconds: 0 }),
    ).toThrow();
    expect(() =>
      buildMaintenancePayload({ ...base, recurrence: "yearly", month: 3, startTimeSeconds: 0 }),
    ).toThrow();
  });
});

describe("formatWindow", () => {
  // Fixed 10:00 *local* time, not Date.now(): a same-day window started
  // after 22:00 ends on the next day, so the wall clock decided whether this
  // test passed. Local-time constructor keeps it same-day in every timezone.
  const NOON_ISH = Math.floor(new Date(2026, 0, 15, 10, 0, 0).getTime() / 1000);

  it("formats a same-day window with a single date and a time range", () => {
    const result = formatWindow(NOON_ISH, NOON_ISH + 2 * 3600);
    expect(result).toMatch(/^\d{2}\.\d{2}\., \d{2}:\d{2} – \d{2}:\d{2}$/);
  });

  it("formats a window spanning multiple days with both dates", () => {
    const now = NOON_ISH;
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

  it("describes a monthly window by nth weekday (2nd Tuesday)", () => {
    const result = describeTimeperiod({
      timeperiod_type: "4",
      dayofweek: "2",
      every: "2",
      start_time: "32400",
      period: "4320",
    });
    expect(result).toBe("monatlich am 2. Dienstag 09:00 (72 min)");
  });

  it("describes a monthly window by nth weekday for the first occurrence", () => {
    const result = describeTimeperiod({
      timeperiod_type: "4",
      dayofweek: "1",
      every: "1",
      start_time: "0",
      period: "3600",
    });
    expect(result).toBe("monatlich am 1. Montag 00:00 (1 h)");
  });

  it("describes a monthly window by nth weekday using 'letzten' for the last occurrence", () => {
    const result = describeTimeperiod({
      timeperiod_type: "4",
      dayofweek: "16",
      every: "5",
      start_time: "0",
      period: "3600",
    });
    expect(result).toBe("monatlich am letzten Freitag 00:00 (1 h)");
  });

  it("describes a yearly window as a monthly rule with a single-month bitmask", () => {
    const result = describeTimeperiod({
      timeperiod_type: "4",
      dayofweek: "0",
      day: "15",
      month: "4", // bit2 = März
      start_time: "32400",
      period: "3600",
    });
    expect(result).toBe("jährlich am 15. März 09:00 (1 h)");
  });

  it("falls back to raw text for monthly rules with an invalid multi-day bitmask", () => {
    const result = describeTimeperiod({
      timeperiod_type: "4",
      dayofweek: "3", // two bits set — not a valid single weekday
      every: "2",
      start_time: "0",
      period: "3600",
    });
    expect(result).toBe("monatlich (komplex)");
  });
});

describe("maintenanceToFormState", () => {
  const base = {
    name: "Wartung",
    description: "Kernel-Update",
    active_since: "1000",
    active_till: "4600",
    maintenance_type: "0" as const,
    hosts: [{ hostid: "1", host: "web-01", name: "Web 01" }],
    hostgroups: [{ groupid: "5", name: "Webserver" }],
  };

  it("decodes a one-time window (start from start_date, not active_since)", () => {
    const state = maintenanceToFormState({
      ...base,
      timeperiods: [{ timeperiod_type: "0", period: "3600", start_date: "2000" }],
    });
    expect(state).toMatchObject({
      recurrence: "once",
      name: "Wartung",
      description: "Kernel-Update",
      startSeconds: 2000,
      durationSeconds: 3600,
      withDataCollection: true,
      hosts: [{ id: "1", label: "Web 01" }],
      groups: [{ id: "5", label: "Webserver" }],
    });
  });

  it("falls back to active_since when start_date is missing", () => {
    const state = maintenanceToFormState({
      ...base,
      timeperiods: [{ timeperiod_type: "0", period: "3600" }],
    });
    expect(state?.startSeconds).toBe(1000);
  });

  it("decodes a daily recurrence", () => {
    const state = maintenanceToFormState({
      ...base,
      timeperiods: [{ timeperiod_type: "2", period: "1800", every: "2", start_time: "32400" }],
    });
    expect(state).toMatchObject({
      recurrence: "daily",
      everyDays: 2,
      startTimeSeconds: 32400,
      durationSeconds: 1800,
    });
  });

  it("decodes a weekly recurrence into weekday indices", () => {
    const state = maintenanceToFormState({
      ...base,
      timeperiods: [
        { timeperiod_type: "3", period: "7200", every: "1", dayofweek: "65", start_time: "79200" },
      ],
    });
    expect(state).toMatchObject({ recurrence: "weekly", weekdays: [0, 6] });
  });

  it("decodes monthly day-of-month (all-months mask)", () => {
    const state = maintenanceToFormState({
      ...base,
      timeperiods: [
        { timeperiod_type: "4", period: "1800", month: "4095", day: "15", start_time: "3600" },
      ],
    });
    expect(state).toMatchObject({ recurrence: "monthlyDay", monthDay: 15 });
  });

  it("decodes yearly (single-month mask)", () => {
    const state = maintenanceToFormState({
      ...base,
      timeperiods: [
        { timeperiod_type: "4", period: "3600", month: "4", day: "15", start_time: "32400" },
      ],
    });
    expect(state).toMatchObject({ recurrence: "yearly", yearlyMonth: 3, monthDay: 15 });
  });

  it("decodes monthly weekday-occurrence mode", () => {
    const state = maintenanceToFormState({
      ...base,
      timeperiods: [
        {
          timeperiod_type: "4",
          period: "3600",
          month: "4095",
          dayofweek: "2",
          every: "2",
          start_time: "32400",
        },
      ],
    });
    expect(state).toMatchObject({
      recurrence: "monthlyWeekday",
      weekdayIndex: 1,
      weekdayOccurrence: 2,
    });
  });

  it("maps maintenance_type 1 to withDataCollection false", () => {
    const state = maintenanceToFormState({
      ...base,
      maintenance_type: "1",
      timeperiods: [{ timeperiod_type: "0", period: "3600", start_date: "2000" }],
    });
    expect(state?.withDataCollection).toBe(false);
  });

  it("returns null for unrepresentable shapes", () => {
    // No timeperiods at all.
    expect(maintenanceToFormState({ ...base, timeperiods: [] })).toBeNull();
    // Multiple timeperiods.
    expect(
      maintenanceToFormState({
        ...base,
        timeperiods: [
          { timeperiod_type: "0", period: "60" },
          { timeperiod_type: "2", period: "60" },
        ],
      }),
    ).toBeNull();
    // Weekly without any weekday bit.
    expect(
      maintenanceToFormState({
        ...base,
        timeperiods: [{ timeperiod_type: "3", period: "60", dayofweek: "0" }],
      }),
    ).toBeNull();
    // Monthly day-of-month with a partial month mask (not all, not single).
    expect(
      maintenanceToFormState({
        ...base,
        timeperiods: [{ timeperiod_type: "4", period: "60", month: "5", day: "1" }],
      }),
    ).toBeNull();
  });

  it("round-trips through buildMaintenancePayload for a weekly window", () => {
    const payload = buildMaintenancePayload({
      name: "Patchday",
      hostids: ["1"],
      groupids: [],
      startSeconds: 1000,
      durationSeconds: 7200,
      withDataCollection: true,
      recurrence: "weekly",
      dayofweek: 65,
      startTimeSeconds: 79200,
    });
    const tp = payload.timeperiods[0]!;
    const state = maintenanceToFormState({
      name: payload.name,
      active_since: String(payload.active_since),
      active_till: String(payload.active_till),
      maintenance_type: "0",
      hosts: [{ hostid: "1", host: "web-01" }],
      timeperiods: [
        {
          timeperiod_type: String(tp.timeperiod_type),
          period: String(tp.period),
          every: String(tp.every),
          dayofweek: String(tp.dayofweek),
          start_time: String(tp.start_time),
        },
      ],
    });
    expect(state).toMatchObject({
      recurrence: "weekly",
      weekdays: [0, 6],
      startTimeSeconds: 79200,
      durationSeconds: 7200,
      startSeconds: 1000,
    });
  });
});
