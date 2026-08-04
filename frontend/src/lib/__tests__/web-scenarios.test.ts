import { describe, expect, it } from "vitest";
import type { ZabbixHttpTest, ZabbixItem } from "@auzui/zabbix-client";
import {
  aggregateDailyAvailability,
  availabilityFromTrendAvg,
  bucketStepHistory,
  computeAvailability,
  countByStatus,
  enrichWebScenarios,
  matchesScenarioSearch,
  sortWebScenarios,
  totalResponseSeconds,
  webTestKey,
  webTestStepKey,
} from "../web-scenarios";

function httptest(overrides: Partial<ZabbixHttpTest> = {}): ZabbixHttpTest {
  return {
    httptestid: "1",
    name: "Checkout flow",
    hostid: "10",
    delay: "1m",
    retries: "1",
    status: "0",
    agent: "auzui",
    hosts: [{ hostid: "10", host: "web-01", name: "web-01" }],
    steps: [
      { httpstepid: "1", httptestid: "1", name: "Homepage", no: "1", url: "https://shop.example.com/", timeout: "10" },
      { httpstepid: "2", httptestid: "1", name: "Checkout", no: "2", url: "https://shop.example.com/checkout", timeout: "10" },
    ],
    ...overrides,
  };
}

function item(overrides: Partial<ZabbixItem> = {}): ZabbixItem {
  return {
    itemid: "500",
    hostid: "10",
    name: "item",
    key_: "web.test.fail[Checkout flow]",
    value_type: "3",
    units: "",
    ...overrides,
  };
}

describe("webTestKey / webTestStepKey", () => {
  it("builds Zabbix's auto-generated web-scenario item keys", () => {
    expect(webTestKey("fail", "Checkout flow")).toBe("web.test.fail[Checkout flow]");
    expect(webTestStepKey("time", "Checkout flow", "2")).toBe("web.test.time[Checkout flow,2]");
  });
});

describe("enrichWebScenarios", () => {
  it("matches an OK scenario's step items and derives status ok", () => {
    const items: ZabbixItem[] = [
      item({ itemid: "1", key_: "web.test.fail[Checkout flow]", lastvalue: "0" }),
      item({ itemid: "2", key_: "web.test.time[Checkout flow,1]", lastvalue: "0.08", value_type: "0" }),
      item({ itemid: "3", key_: "web.test.time[Checkout flow,2]", lastvalue: "0.12", value_type: "0" }),
    ];
    const [scenario] = enrichWebScenarios([httptest()], items);
    expect(scenario!.status).toBe("ok");
    expect(scenario!.failedStepNo).toBe(0);
    expect(scenario!.steps).toHaveLength(2);
    expect(scenario!.steps[0]!.responseTimeItem?.itemid).toBe("2");
    expect(scenario!.hostName).toBe("web-01");
  });

  it("reports failed when web.test.fail is a nonzero step number", () => {
    const items: ZabbixItem[] = [
      item({ itemid: "1", key_: "web.test.fail[Checkout flow]", lastvalue: "2" }),
      item({ itemid: "4", key_: "web.test.error[Checkout flow]", lastvalue: "connect timed out", value_type: "1" }),
    ];
    const [scenario] = enrichWebScenarios([httptest()], items);
    expect(scenario!.status).toBe("failed");
    expect(scenario!.failedStepNo).toBe(2);
    expect(scenario!.lastError).toBe("connect timed out");
  });

  it("reports degraded when a step's response time nears its timeout, even with no failure", () => {
    const items: ZabbixItem[] = [
      item({ itemid: "1", key_: "web.test.fail[Checkout flow]", lastvalue: "0" }),
      item({ itemid: "2", key_: "web.test.time[Checkout flow,1]", lastvalue: "8.5", value_type: "0" }),
    ];
    const [scenario] = enrichWebScenarios([httptest()], items);
    expect(scenario!.status).toBe("degraded");
  });

  it("reports disabled regardless of item state when status is 1", () => {
    const items: ZabbixItem[] = [item({ itemid: "1", key_: "web.test.fail[Checkout flow]", lastvalue: "0" })];
    const [scenario] = enrichWebScenarios([httptest({ status: "1" })], items);
    expect(scenario!.status).toBe("disabled");
  });

  it("ignores items belonging to a different host", () => {
    const items: ZabbixItem[] = [item({ hostid: "999", key_: "web.test.fail[Checkout flow]", lastvalue: "1" })];
    const [scenario] = enrichWebScenarios([httptest()], items);
    expect(scenario!.failItem).toBeUndefined();
    expect(scenario!.status).toBe("ok");
  });
});

describe("totalResponseSeconds", () => {
  it("sums every step's last response time", () => {
    const items: ZabbixItem[] = [
      item({ itemid: "2", key_: "web.test.time[Checkout flow,1]", lastvalue: "0.10", value_type: "0" }),
      item({ itemid: "3", key_: "web.test.time[Checkout flow,2]", lastvalue: "0.25", value_type: "0" }),
    ];
    const [scenario] = enrichWebScenarios([httptest()], items);
    expect(totalResponseSeconds(scenario!)).toBeCloseTo(0.35);
  });
});

describe("computeAvailability", () => {
  it("returns undefined for an empty history window", () => {
    expect(computeAvailability([])).toBeUndefined();
  });

  it("is the percentage of samples where web.test.fail was 0", () => {
    const history = [{ value: "0" }, { value: "0" }, { value: "1" }, { value: "0" }];
    expect(computeAvailability(history)).toBe(75);
  });
});

describe("availabilityFromTrendAvg", () => {
  it("inverts a 0/1 item's daily average into an availability percentage", () => {
    expect(availabilityFromTrendAvg("0")).toBe(100);
    expect(availabilityFromTrendAvg("1")).toBe(0);
    expect(availabilityFromTrendAvg("0.1")).toBeCloseTo(90);
  });
});

describe("matchesScenarioSearch", () => {
  it("matches on scenario name, host, or step URL", () => {
    const [scenario] = enrichWebScenarios([httptest()], []);
    expect(matchesScenarioSearch(scenario!, "checkout")).toBe(true);
    expect(matchesScenarioSearch(scenario!, "web-01")).toBe(true);
    expect(matchesScenarioSearch(scenario!, "shop.example.com")).toBe(true);
    expect(matchesScenarioSearch(scenario!, "nope")).toBe(false);
  });
});

describe("aggregateDailyAvailability", () => {
  const DAY = 86_400;

  it("collapses many hourly trend rows from the same day into one bar", () => {
    const points = Array.from({ length: 24 }, (_, h) => ({
      clock: String(h * 3600),
      value_avg: "0",
      num: "60",
    }));
    const result = aggregateDailyAvailability(points);
    expect(result).toHaveLength(1);
    expect(result[0]!.day).toBe(0);
    expect(result[0]!.availability).toBe(100);
  });

  it("weights each hour's failed-fraction by its sample count", () => {
    const points = [
      { clock: "0", value_avg: "0", num: "50" }, // 50 fully-OK samples
      { clock: "3600", value_avg: "1", num: "10" }, // 10 fully-failed samples
    ];
    const [day] = aggregateDailyAvailability(points);
    // 10 of 60 samples failed -> 83.33% available, not a flat 50/50 average of the two rows.
    expect(day!.availability).toBeCloseTo(83.33, 1);
  });

  it("produces one bar per distinct day, sorted oldest first", () => {
    const points = [
      { clock: String(2 * DAY), value_avg: "0", num: "1" },
      { clock: String(0), value_avg: "0", num: "1" },
      { clock: String(DAY), value_avg: "0", num: "1" },
    ];
    const days = aggregateDailyAvailability(points).map((d) => d.day);
    expect(days).toEqual([0, DAY, 2 * DAY]);
  });
});

describe("bucketStepHistory", () => {
  it("averages each step's points into the bucket their clock falls in", () => {
    const from = 0;
    const to = 100;
    const stepA = { points: [{ clock: 5, value: 1 }, { clock: 15, value: 3 }] }; // bucket 0
    const stepB = { points: [{ clock: 55, value: 10 }] }; // bucket 1
    const buckets = bucketStepHistory([stepA, stepB], from, to, 2);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.values).toEqual([2, 0]); // avg(1,3)=2 for step A, no step B data
    expect(buckets[1]!.values).toEqual([0, 10]);
  });

  it("returns zeros for a step with no points in range", () => {
    const buckets = bucketStepHistory([{ points: [] }], 0, 10, 1);
    expect(buckets[0]!.values).toEqual([0]);
  });
});

describe("sortWebScenarios / countByStatus", () => {
  it("ranks failed before degraded before ok before disabled", () => {
    const items: ZabbixItem[] = [item({ itemid: "1", key_: "web.test.fail[Checkout flow]", lastvalue: "1" })];
    const failing = enrichWebScenarios([httptest({ httptestid: "1", name: "Checkout flow" })], items)[0]!;
    const ok = enrichWebScenarios(
      [httptest({ httptestid: "2", name: "Homepage", steps: [] })],
      [],
    )[0]!;
    const sorted = sortWebScenarios([ok, failing], "status");
    expect(sorted.map((s) => s.httptest.name)).toEqual(["Checkout flow", "Homepage"]);

    const counts = countByStatus(sorted);
    expect(counts.failed).toBe(1);
    expect(counts.ok).toBe(1);
  });
});
