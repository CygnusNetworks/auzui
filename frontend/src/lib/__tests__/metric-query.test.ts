import { describe, expect, it } from "vitest";
import {
  addToken,
  currentFieldDraft,
  parseMetricQuery,
  removeTokenAt,
  replaceFieldToken,
  serializeMetricQuery,
  suggestFieldNames,
} from "../metric-query";

describe("parseMetricQuery", () => {
  it("parses a single token plus trailing free text", () => {
    expect(parseMetricQuery("host:docker-virt6 eth0")).toEqual({
      tokens: [{ field: "host", value: "docker-virt6" }],
      text: "eth0",
    });
  });

  it("parses quoted values containing spaces", () => {
    expect(parseMetricQuery('host:"docker virt 6" eth0')).toEqual({
      tokens: [{ field: "host", value: "docker virt 6" }],
      text: "eth0",
    });
  });

  it("parses multiple tokens interleaved with free text", () => {
    expect(parseMetricQuery("free1 host:h1 free2 unit:% component:cpu")).toEqual({
      tokens: [
        { field: "host", value: "h1" },
        { field: "unit", value: "%" },
        { field: "component", value: "cpu" },
      ],
      text: "free1 free2",
    });
  });

  it("returns empty tokens and text for a plain free-text query", () => {
    expect(parseMetricQuery("cpu load")).toEqual({ tokens: [], text: "cpu load" });
  });

  it("ignores unknown field prefixes as free text", () => {
    expect(parseMetricQuery("foo:bar")).toEqual({ tokens: [], text: "foo:bar" });
  });

  it("handles an empty string", () => {
    expect(parseMetricQuery("")).toEqual({ tokens: [], text: "" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseMetricQuery("   host:h1   eth0   ")).toEqual({
      tokens: [{ field: "host", value: "h1" }],
      text: "eth0",
    });
  });
});

describe("serializeMetricQuery", () => {
  it("round-trips a parsed query", () => {
    const input = "host:docker-virt6 eth0";
    expect(serializeMetricQuery(parseMetricQuery(input))).toBe(input);
  });

  it("quotes values containing whitespace", () => {
    expect(serializeMetricQuery({ tokens: [{ field: "host", value: "docker virt 6" }], text: "" })).toBe(
      'host:"docker virt 6"',
    );
  });

  it("omits empty free text", () => {
    expect(serializeMetricQuery({ tokens: [{ field: "unit", value: "%" }], text: "" })).toBe("unit:%");
  });
});

describe("removeTokenAt", () => {
  it("removes the token at the given index, keeping the rest", () => {
    expect(removeTokenAt("host:h1 component:cpu eth0", 0)).toBe("component:cpu eth0");
    expect(removeTokenAt("host:h1 component:cpu eth0", 1)).toBe("host:h1 eth0");
  });
});

describe("replaceFieldToken", () => {
  it("replaces an existing single-value field token", () => {
    expect(replaceFieldToken("host:h1 eth0", "host", "h2")).toBe("host:h2 eth0");
  });

  it("adds the token if the field wasn't present", () => {
    expect(replaceFieldToken("eth0", "unit", "%")).toBe("unit:% eth0");
  });
});

describe("addToken", () => {
  it("dedupes identical field+value pairs", () => {
    expect(addToken("key:eth0", "key", "eth0")).toBe("key:eth0");
  });

  it("keeps distinct values for the same field", () => {
    expect(addToken("key:eth0", "key", "eth1")).toBe("key:eth0 key:eth1");
  });
});

describe("suggestFieldNames", () => {
  it("suggests matching field names for the in-progress last word", () => {
    expect(suggestFieldNames("comp")).toEqual(["component"]);
    expect(suggestFieldNames("free text h")).toEqual(["host"]);
  });

  it("returns nothing once the word already has a colon", () => {
    expect(suggestFieldNames("host:doc")).toEqual([]);
  });

  it("returns nothing for an empty last word", () => {
    expect(suggestFieldNames("free ")).toEqual([]);
  });
});

describe("currentFieldDraft", () => {
  it("extracts the field and in-progress value being typed", () => {
    expect(currentFieldDraft("eth0 host:doc")).toEqual({ field: "host", value: "doc" });
  });

  it("returns null when not currently typing a field value", () => {
    expect(currentFieldDraft("eth0")).toBeNull();
    expect(currentFieldDraft("foo:bar")).toBeNull();
  });

  // Regression: the "host:d → empty list" bug. The draft value must be just the
  // typed prefix ("" then "d" then "docker-v"), so the host search keeps
  // matching; an empty prefix lists all hosts, a one-char prefix must not clear
  // the list.
  it("yields an empty value right after the colon (host: lists all)", () => {
    expect(currentFieldDraft("host:")).toEqual({ field: "host", value: "" });
  });

  it("yields the single typed character, not the whole word", () => {
    expect(currentFieldDraft("host:d")).toEqual({ field: "host", value: "d" });
  });

  it("grows the prefix as the user keeps typing", () => {
    expect(currentFieldDraft("host:docker-v")).toEqual({ field: "host", value: "docker-v" });
  });

  it("extracts the draft from the last word when preceded by free text", () => {
    expect(currentFieldDraft("cpu load host:")).toEqual({ field: "host", value: "" });
    expect(currentFieldDraft("cpu load host:docker-v")).toEqual({ field: "host", value: "docker-v" });
  });

  it("strips the opening quote of a still-open quoted value", () => {
    expect(currentFieldDraft('host:"docker-v')).toEqual({ field: "host", value: "docker-v" });
    expect(currentFieldDraft('cpu host:"doc')).toEqual({ field: "host", value: "doc" });
  });

  it("strips surrounding quotes of a closed quoted value", () => {
    expect(currentFieldDraft('host:"docker"')).toEqual({ field: "host", value: "docker" });
  });

  it("supports every recognized field prefix", () => {
    expect(currentFieldDraft("group:pro")).toEqual({ field: "group", value: "pro" });
    expect(currentFieldDraft("component:cp")).toEqual({ field: "component", value: "cp" });
    expect(currentFieldDraft("key:eth")).toEqual({ field: "key", value: "eth" });
    expect(currentFieldDraft("unit:%")).toEqual({ field: "unit", value: "%" });
  });
});
