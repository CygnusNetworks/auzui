import { describe, expect, it } from "vitest";
import type { LogFilterSetPayload } from "@auzui/logs";
import {
  currentFromSearch,
  currentToPayload,
  payloadsEqual,
  payloadToSearch,
} from "../filter-set-mapping";

describe("filter-set mapping", () => {
  const current = {
    hosts: ["web01", "web02"],
    include: [{ field: "facility" as const, value: "local0" }],
    exclude: [{ field: "application_name" as const, value: "sshd" }],
    stream: "s1",
    servers: ["gl-a"],
    level: 3,
  };

  it("serializes current filters into a payload (host sources become source-includes)", () => {
    const payload = currentToPayload(current);
    expect(payload.include).toEqual([
      { field: "source", value: "web01" },
      { field: "source", value: "web02" },
      { field: "facility", value: "local0" },
    ]);
    expect(payload.exclude).toEqual([{ field: "application_name", value: "sshd" }]);
    expect(payload.streams).toEqual(["s1"]);
    expect(payload.servers).toEqual(["gl-a"]);
    expect(payload.level).toBe(3);
  });

  it("round-trips payload → search params → current filters", () => {
    const payload = currentToPayload(current);
    const { search, level } = payloadToSearch(payload);
    expect(search.host).toBe("web01,web02");
    expect(level).toBe(3);
    const restored = currentFromSearch(search, level);
    expect(payloadsEqual(currentToPayload(restored), payload)).toBe(true);
  });

  it("payloadsEqual is order-insensitive and treats empty/null the same", () => {
    const a: LogFilterSetPayload = {
      include: [
        { field: "facility", value: "b" },
        { field: "facility", value: "a" },
      ],
      exclude: [],
      streams: null,
      servers: [],
      level: null,
    };
    const b: LogFilterSetPayload = {
      include: [
        { field: "facility", value: "a" },
        { field: "facility", value: "b" },
      ],
      exclude: [],
      streams: [],
      servers: null,
      level: undefined,
    };
    expect(payloadsEqual(a, b)).toBe(true);
  });

  it("payloadsEqual detects a difference", () => {
    const a = currentToPayload(current);
    const b = currentToPayload({ ...current, level: 5 });
    expect(payloadsEqual(a, b)).toBe(false);
  });
});
