import { describe, expect, it } from "vitest";
import {
  filtersFromSearch,
  filtersToSearchValue,
  parseServersParam,
  validateLogsSearch,
} from "../search-params";

describe("logs search params: include/exclude filter chips", () => {
  it("round-trips a simple filter through encode/decode", () => {
    const encoded = filtersToSearchValue([{ field: "facility", value: "local0" }]);
    expect(encoded).toBe("facility:local0");
    expect(filtersFromSearch(encoded)).toEqual([{ field: "facility", value: "local0" }]);
  });

  it("URI-encodes values containing ':' or ',' so they don't corrupt the CSV shape", () => {
    const encoded = filtersToSearchValue([{ field: "application_name", value: "a,b:c" }]);
    expect(encoded).toBe("application_name:a%2Cb%3Ac");
    expect(filtersFromSearch(encoded)).toEqual([{ field: "application_name", value: "a,b:c" }]);
  });

  it("round-trips multiple filters", () => {
    const filters = [
      { field: "facility" as const, value: "local0" },
      { field: "application_name" as const, value: "sshd" },
    ];
    expect(filtersFromSearch(filtersToSearchValue(filters))).toEqual(filters);
  });

  it("returns undefined for an empty filter list (keeps the URL clean)", () => {
    expect(filtersToSearchValue([])).toBeUndefined();
  });

  it("ignores unknown fields and malformed entries instead of throwing", () => {
    expect(filtersFromSearch("bogus-field:x,facility:local0,noseparatorhere")).toEqual([
      { field: "facility", value: "local0" },
    ]);
  });

  it("returns an empty list for absent/undefined input", () => {
    expect(filtersFromSearch(undefined)).toEqual([]);
  });

  it("validateLogsSearch keeps include/exclude as raw strings, not parsed further", () => {
    const search = validateLogsSearch({ stream: "s1", host: "web01", include: "facility:local0" });
    expect(search).toEqual({ stream: "s1", host: "web01", include: "facility:local0", exclude: undefined });
  });

  it("validateLogsSearch parses page (string or number) and drops invalid/<1 pages", () => {
    expect(validateLogsSearch({ page: "3" }).page).toBe(3);
    expect(validateLogsSearch({ page: 2 }).page).toBe(2);
    expect(validateLogsSearch({ page: "0" }).page).toBeUndefined();
    expect(validateLogsSearch({ page: "abc" }).page).toBeUndefined();
  });

  it("validateLogsSearch keeps a deep link's q, dropping empty/non-string ones", () => {
    expect(validateLogsSearch({ q: "web-1" }).q).toBe("web-1");
    expect(validateLogsSearch({ q: "" }).q).toBeUndefined();
    expect(validateLogsSearch({ q: 42 }).q).toBeUndefined();
    expect(validateLogsSearch({}).q).toBeUndefined();
  });

  it("validateLogsSearch keeps servers and set as strings", () => {
    const search = validateLogsSearch({ servers: "gl-a,gl-b", set: "abc123" });
    expect(search.servers).toBe("gl-a,gl-b");
    expect(search.set).toBe("abc123");
  });

  it("parseServersParam splits and trims, dropping blanks", () => {
    expect(parseServersParam("gl-a, gl-b ,")).toEqual(["gl-a", "gl-b"]);
    expect(parseServersParam(undefined)).toEqual([]);
  });
});
