import { describe, expect, it } from "vitest";
import { buildMaintenancePayload, formatWindow, maintenanceStatus } from "../maintenance";

describe("maintenanceStatus", () => {
  const m = { active_since: "1000", active_till: "2000" };

  it("is planned before active_since", () => {
    expect(maintenanceStatus(m, 999)).toBe("planned");
  });

  it("is active at the exact start boundary", () => {
    expect(maintenanceStatus(m, 1000)).toBe("active");
  });

  it("is active just before the end boundary", () => {
    expect(maintenanceStatus(m, 1999)).toBe("active");
  });

  it("is expired at the exact end boundary", () => {
    expect(maintenanceStatus(m, 2000)).toBe("expired");
  });

  it("is expired well after the end", () => {
    expect(maintenanceStatus(m, 3000)).toBe("expired");
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
