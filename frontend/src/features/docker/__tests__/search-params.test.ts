import { describe, expect, it } from "vitest";
import {
  decodeSelection,
  encodeContainerSelection,
  encodeStackSelection,
  hostsToSearchValue,
  parseHostsParam,
  parseStateParam,
  stateToSearchValue,
  validateDockerSearch,
} from "../search-params";

describe("docker search params: validation & defaults", () => {
  it("keeps only recognized string fields, dropping anything else", () => {
    const search = validateDockerSearch({
      q: "nginx",
      hosts: "prod-a,prod-b",
      state: "running,unhealthy",
      type: "images",
      group: "stack",
      view: "cards",
      sel: "c:prod-a:abc123",
      dtab: "stats",
      live: "0",
      bogus: "ignored",
    });
    expect(search).toEqual({
      q: "nginx",
      hosts: "prod-a,prod-b",
      state: "running,unhealthy",
      type: "images",
      group: "stack",
      view: "cards",
      sel: "c:prod-a:abc123",
      dtab: "stats",
      live: "0",
    });
  });

  it("returns an empty object for an empty search (all defaults implicit)", () => {
    expect(validateDockerSearch({})).toEqual({});
  });

  it("rejects an unknown `type` value instead of passing it through", () => {
    expect(validateDockerSearch({ type: "bogus" }).type).toBeUndefined();
  });

  it("rejects an unknown `dtab` value instead of passing it through", () => {
    expect(validateDockerSearch({ dtab: "bogus" }).dtab).toBeUndefined();
  });

  // Live ist der Default: nur das explizite Abschalten (live=0) wird
  // persistiert, alles andere (auch "1") bleibt implizit = an.
  it("only accepts live=0, never a stray falsy string", () => {
    expect(validateDockerSearch({ live: "0" }).live).toBe("0");
    expect(validateDockerSearch({ live: "false" }).live).toBeUndefined();
    expect(validateDockerSearch({ live: "1" }).live).toBeUndefined();
  });

  it("only accepts group host/stack and view rows/cards", () => {
    expect(validateDockerSearch({ group: "bogus" }).group).toBeUndefined();
    expect(validateDockerSearch({ view: "bogus" }).view).toBeUndefined();
  });
});

describe("docker search params: hosts CSV round-trip", () => {
  it("parses and re-encodes a host id list", () => {
    const parsed = parseHostsParam("prod-a, prod-b ,edge");
    expect(parsed).toEqual(["prod-a", "prod-b", "edge"]);
    expect(hostsToSearchValue(parsed)).toBe("prod-a,prod-b,edge");
  });

  it("returns an empty list for undefined/empty input", () => {
    expect(parseHostsParam(undefined)).toEqual([]);
    expect(parseHostsParam("")).toEqual([]);
  });

  it("encodes an empty list back to undefined (keeps the URL clean)", () => {
    expect(hostsToSearchValue([])).toBeUndefined();
  });
});

describe("docker search params: state chip set round-trip", () => {
  it("parses and re-encodes chip ids", () => {
    const parsed = parseStateParam("running,unhealthy,outdated");
    expect(parsed).toEqual(new Set(["running", "unhealthy", "outdated"]));
    expect(stateToSearchValue(parsed)).toBe("running,unhealthy,outdated");
  });

  it("returns an empty set for undefined input", () => {
    expect(parseStateParam(undefined)).toEqual(new Set());
  });

  it("encodes an empty set back to undefined", () => {
    expect(stateToSearchValue(new Set())).toBeUndefined();
  });
});

describe("docker search params: selection encoding", () => {
  it("round-trips a container selection", () => {
    const encoded = encodeContainerSelection("prod-a", "abc123def");
    expect(encoded).toBe("c:prod-a:abc123def");
    expect(decodeSelection(encoded)).toEqual({ kind: "container", hostId: "prod-a", cid: "abc123def" });
  });

  it("round-trips a stack selection", () => {
    const encoded = encodeStackSelection("edge", "my-app");
    expect(encoded).toBe("s:edge:my-app");
    expect(decodeSelection(encoded)).toEqual({ kind: "stack", hostId: "edge", project: "my-app" });
  });

  it("keeps everything after the second colon as the tail, even if it contains colons", () => {
    expect(decodeSelection("s:edge:my:weird:project")).toEqual({
      kind: "stack",
      hostId: "edge",
      project: "my:weird:project",
    });
  });

  it("returns undefined for malformed or absent input", () => {
    expect(decodeSelection(undefined)).toBeUndefined();
    expect(decodeSelection("")).toBeUndefined();
    expect(decodeSelection("bogus")).toBeUndefined();
    expect(decodeSelection("c:onlyhost")).toBeUndefined();
    expect(decodeSelection("x:host:id")).toBeUndefined();
  });
});
