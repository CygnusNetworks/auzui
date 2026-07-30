import { describe, expect, it } from "vitest";
import type { LogStream } from "@auzui/logs";
import { isStreamSort, sortLogStreams } from "../log-streams";

function s(id: string, title: string, serverLabel?: string): LogStream {
  return { id, title, description: "", disabled: false, isDefault: false, serverLabel };
}

// Wild gemischte Union wie vom Gateway (Screenshot-Fall).
const mixed: LogStream[] = [
  s("m1", "All messages", "graylog-a"),
  s("e2", "All system events", "graylog-b"),
  s("m2", "All messages", "graylog-b"),
  s("e1", "All system events", "graylog-a"),
  s("m3", "All messages", "graylog-c"),
];

describe("sortLogStreams", () => {
  it("name mode groups equally-named streams adjacent, then by server label", () => {
    const out = sortLogStreams(mixed, "name").map((x) => [x.title, x.serverLabel]);
    expect(out).toEqual([
      ["All messages", "graylog-a"],
      ["All messages", "graylog-b"],
      ["All messages", "graylog-c"],
      ["All system events", "graylog-a"],
      ["All system events", "graylog-b"],
    ]);
  });

  it("server mode blocks by server label, then by title", () => {
    const out = sortLogStreams(mixed, "server").map((x) => [x.serverLabel, x.title]);
    expect(out).toEqual([
      ["graylog-a", "All messages"],
      ["graylog-a", "All system events"],
      ["graylog-b", "All messages"],
      ["graylog-b", "All system events"],
      ["graylog-c", "All messages"],
    ]);
  });

  it("does not mutate the input", () => {
    const input = [...mixed];
    sortLogStreams(input, "name");
    expect(input).toEqual(mixed);
  });

  it("is stable / total order via id tiebreak for identical title+server", () => {
    const dup = [s("b", "X", "gl"), s("a", "X", "gl")];
    expect(sortLogStreams(dup, "name").map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("isStreamSort guards persisted values", () => {
    expect(isStreamSort("name")).toBe(true);
    expect(isStreamSort("server")).toBe(true);
    expect(isStreamSort("bogus")).toBe(false);
    expect(isStreamSort(undefined)).toBe(false);
  });
});
