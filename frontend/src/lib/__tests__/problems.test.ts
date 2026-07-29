import { describe, expect, it } from "vitest";
import type { ZabbixProblem, ZabbixTrigger } from "@auzui/zabbix-client";
import {
  countBySeverity,
  filterProblems,
  formatAge,
  groupIntoLanes,
  joinProblemsWithTriggers,
} from "../problems";
import { ALL_SEVERITIES } from "../severity";

function problem(overrides: Partial<ZabbixProblem> = {}): ZabbixProblem {
  return {
    eventid: "1",
    objectid: "100",
    name: "Something is wrong",
    severity: "4",
    clock: "1000",
    acknowledged: "0",
    tags: [],
    ...overrides,
  };
}

function trigger(overrides: Partial<ZabbixTrigger> = {}): ZabbixTrigger {
  return {
    triggerid: "100",
    description: "trig",
    expression: "last(/host/item)>1",
    priority: "4",
    hosts: [{ hostid: "10", host: "host-a" }],
    items: [{ itemid: "500", key_: "item.key", name: "Item", value_type: "3" }],
    ...overrides,
  };
}

describe("joinProblemsWithTriggers", () => {
  it("attaches host identity, expression and numeric item to a problem", () => {
    const joined = joinProblemsWithTriggers([problem()], [trigger()]);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({
      eventid: "1",
      hostId: "10",
      hostName: "host-a",
      triggerExpression: "last(/host/item)>1",
      itemId: "500",
      itemValueType: "3",
      severity: 4,
      acknowledged: false,
    });
  });

  it("leaves host/item fields undefined when the trigger is missing", () => {
    const joined = joinProblemsWithTriggers([problem({ objectid: "999" })], [trigger()]);
    expect(joined[0]?.hostId).toBeUndefined();
    expect(joined[0]?.itemId).toBeUndefined();
  });

  it("does not treat a non-numeric item as a sparkline candidate", () => {
    const textTrigger = trigger({
      items: [{ itemid: "501", key_: "log.key", name: "Log", value_type: "2" }],
    });
    const joined = joinProblemsWithTriggers([problem()], [textTrigger]);
    expect(joined[0]?.itemId).toBeUndefined();
  });

  it("maps acknowledged=1 to true", () => {
    const joined = joinProblemsWithTriggers([problem({ acknowledged: "1" })], [trigger()]);
    expect(joined[0]?.acknowledged).toBe(true);
  });
});

describe("filterProblems", () => {
  const problems = joinProblemsWithTriggers(
    [
      problem({ eventid: "1", severity: "5", acknowledged: "0" }),
      problem({ eventid: "2", severity: "4", acknowledged: "1" }),
      problem({ eventid: "3", severity: "2", acknowledged: "0" }),
    ],
    [trigger()],
  );

  it("returns everything when no filter is given", () => {
    expect(filterProblems(problems, {})).toHaveLength(3);
  });

  it("filters by a severity set", () => {
    const result = filterProblems(problems, { severities: new Set([5, 4]) });
    expect(result.map((p) => p.eventid)).toEqual(["1", "2"]);
  });

  it("filters by a plain severity array", () => {
    const result = filterProblems(problems, { severities: [2] });
    expect(result.map((p) => p.eventid)).toEqual(["3"]);
  });

  it("applies the unacknowledged-only toggle", () => {
    const result = filterProblems(problems, { unackOnly: true });
    expect(result.map((p) => p.eventid)).toEqual(["1", "3"]);
  });

  it("combines severity and unack filters", () => {
    const result = filterProblems(problems, { severities: [4], unackOnly: true });
    expect(result).toHaveLength(0);
  });

  it("treats an empty severity set as no filter", () => {
    const result = filterProblems(problems, { severities: new Set() });
    expect(result).toHaveLength(3);
  });

  it("filters by host", () => {
    const withHost = joinProblemsWithTriggers(
      [problem({ eventid: "1", objectid: "100" }), problem({ eventid: "2", objectid: "200" })],
      [trigger({ triggerid: "100" }), trigger({ triggerid: "200", hosts: [{ hostid: "99", host: "other" }] })],
    );
    const result = filterProblems(withHost, { host: "host-a" });
    expect(result.map((p) => p.eventid)).toEqual(["1"]);
  });
});

describe("countBySeverity", () => {
  it("counts every severity, including zero counts", () => {
    const problems = joinProblemsWithTriggers(
      [problem({ eventid: "1", severity: "5" }), problem({ eventid: "2", severity: "5" })],
      [trigger()],
    );
    const counts = countBySeverity(problems);
    expect(counts[5]).toBe(2);
    expect(counts[4]).toBe(0);
    expect(counts[0]).toBe(0);
  });
});

describe("groupIntoLanes", () => {
  it("drops empty lanes and keeps hottest-first order", () => {
    const problems = joinProblemsWithTriggers(
      [problem({ eventid: "1", severity: "2" }), problem({ eventid: "2", severity: "5" })],
      [trigger()],
    );
    const lanes = groupIntoLanes(problems, ALL_SEVERITIES);
    expect(lanes.map((l) => l.severity)).toEqual([5, 2]);
  });

  it("returns no lanes for an empty problem list", () => {
    expect(groupIntoLanes([], ALL_SEVERITIES)).toEqual([]);
  });
});

describe("formatAge", () => {
  it("formats minutes", () => {
    expect(formatAge(1000, 1000 + 5 * 60)).toBe("5 m");
  });

  it("formats hours and minutes", () => {
    expect(formatAge(0, 2 * 3600 + 15 * 60)).toBe("2 h 15 m");
  });

  it("formats whole hours without minutes", () => {
    expect(formatAge(0, 3 * 3600)).toBe("3 h");
  });

  it("formats days", () => {
    expect(formatAge(0, 2 * 86400 + 3600)).toBe("2 d");
  });
});
