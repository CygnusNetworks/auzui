import { describe, expect, it } from "vitest";
import type { ZabbixProblem, ZabbixTrigger } from "@auzui/zabbix-client";
import type { ProblemFilter } from "../problems";
import {
  countBySeverity,
  filterProblems,
  formatAge,
  groupIntoLanes,
  joinProblemsWithTriggers,
  parseThreshold,
  visibilityBreakdown,
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

  it("drops internal __-prefixed tags (alert-integration markers)", () => {
    const tagged = problem({
      tags: [
        { tag: "component", value: "system" },
        { tag: "__message_ts_#zabbix", value: "123.456" },
      ],
    });
    const joined = joinProblemsWithTriggers([tagged], [trigger()]);
    expect(joined[0]?.tags).toEqual([{ tag: "component", value: "system" }]);
  });

  it("attaches the current item value, its units and last-poll timestamp", () => {
    const valueTrigger = trigger({
      items: [
        {
          itemid: "500",
          key_: "item.key",
          name: "Item",
          value_type: "3",
          lastvalue: "63.4",
          lastclock: "1699999999",
          units: "°C",
        },
      ],
    });
    const joined = joinProblemsWithTriggers([problem()], [valueTrigger]);
    expect(joined[0]).toMatchObject({
      itemLastValue: "63.4",
      itemLastClock: "1699999999",
      itemUnits: "°C",
    });
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

  it("hides suppressed problems by default", () => {
    const withSuppressed = joinProblemsWithTriggers(
      [
        problem({ eventid: "1", suppressed: "0" }),
        problem({ eventid: "2", suppressed: "1" }),
      ],
      [trigger()],
    );
    expect(filterProblems(withSuppressed, {}).map((p) => p.eventid)).toEqual(["1"]);
  });

  it("includes suppressed problems when showSuppressed is set", () => {
    const withSuppressed = joinProblemsWithTriggers(
      [
        problem({ eventid: "1", suppressed: "0" }),
        problem({ eventid: "2", suppressed: "1" }),
      ],
      [trigger()],
    );
    expect(filterProblems(withSuppressed, { showSuppressed: true }).map((p) => p.eventid)).toEqual([
      "1",
      "2",
    ]);
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

describe("visibilityBreakdown", () => {
  const problems = joinProblemsWithTriggers(
    [
      problem({ eventid: "1", severity: "5", acknowledged: "0" }),
      problem({ eventid: "2", severity: "2", acknowledged: "1" }),
      problem({ eventid: "3", severity: "2", acknowledged: "1" }),
      problem({ eventid: "4", severity: "2", acknowledged: "0" }),
    ],
    [trigger()],
  );

  it("attributes acknowledged problems hidden by the unack filter", () => {
    const result = visibilityBreakdown(problems, { unackOnly: true });
    expect(result.shown).toBe(2);
    expect(result.hiddenByAck).toBe(2);
    expect(result.hiddenTotal).toBe(2);
    expect(result.ackHiddenBySeverity[2]).toBe(2);
    expect(result.ackHiddenBySeverity[5]).toBe(0);
  });

  it("reports nothing hidden when no filter applies", () => {
    const result = visibilityBreakdown(problems, {});
    expect(result.shown).toBe(4);
    expect(result.hiddenTotal).toBe(0);
  });

  it("counts an explicit severity filter before problem state", () => {
    // Events 2/3 are both Warning and acknowledged — the severity filter the
    // user just set is the reason they are gone, not their ack state.
    const result = visibilityBreakdown(problems, { severities: [5], unackOnly: true });
    expect(result.hiddenBySeverity).toBe(3);
    expect(result.hiddenByAck).toBe(0);
    expect(result.shown).toBe(1);
  });

  it("counts suppressed problems still in hand", () => {
    const withSuppressed = joinProblemsWithTriggers(
      [problem({ eventid: "1" }), problem({ eventid: "2", suppressed: "1" })],
      [trigger()],
    );
    const result = visibilityBreakdown(withSuppressed, {});
    expect(result.hiddenBySuppressed).toBe(1);
    expect(result.shown).toBe(1);
  });

  it("keeps shown plus hidden buckets equal to the total", () => {
    const withHost = joinProblemsWithTriggers(
      [
        problem({ eventid: "1", objectid: "100", acknowledged: "1" }),
        problem({ eventid: "2", objectid: "200" }),
        problem({ eventid: "3", objectid: "100", severity: "1" }),
      ],
      [trigger({ triggerid: "100" }), trigger({ triggerid: "200", hosts: [{ hostid: "99", host: "other" }] })],
    );
    const filter: ProblemFilter = { severities: [4, 5], host: "host-a", unackOnly: true };
    const result = visibilityBreakdown(withHost, filter);
    expect(
      result.shown +
        result.hiddenBySeverity +
        result.hiddenByHost +
        result.hiddenByAck +
        result.hiddenBySuppressed,
    ).toBe(result.total);
    // Same membership as the filter it explains.
    expect(result.shown).toBe(filterProblems(withHost, filter).length);
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

describe("parseThreshold", () => {
  it("extracts a simple greater-than comparison", () => {
    expect(parseThreshold("avg(/host/synoSystem.temperature,#4)>60")).toEqual({
      op: ">",
      value: 60,
    });
  });

  it("extracts greater-than-or-equal, less-than and less-than-or-equal", () => {
    expect(parseThreshold("last(/host/item)>=90")?.op).toBe(">=");
    expect(parseThreshold("last(/host/item)<5")?.op).toBe("<");
    expect(parseThreshold("last(/host/item)<=5")?.op).toBe("<=");
  });

  it("parses a negative and a decimal threshold", () => {
    expect(parseThreshold("last(/host/item)<-10")).toEqual({ op: "<", value: -10 });
    expect(parseThreshold("last(/host/item)>3.5")).toEqual({ op: ">", value: 3.5 });
  });

  it("returns undefined for a compound and/or expression", () => {
    expect(
      parseThreshold("min(/host/vm.memory.util,5m)>90 and last(/host/vm.memory.size[available])<1G"),
    ).toBeUndefined();
  });

  it("returns undefined for a non-numeric right-hand side (Zabbix size suffix)", () => {
    expect(parseThreshold("last(/host/vm.memory.size[available])<1G")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(parseThreshold(undefined)).toBeUndefined();
  });
});
