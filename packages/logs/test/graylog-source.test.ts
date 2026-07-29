import { describe, expect, it, vi } from "vitest";
import { GraylogSource, NullLogSource } from "../src/index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GraylogSource", () => {
  it("maps gateway streams to LogStream", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        streams: [
          { id: "a", title: "Syslog", description: "", disabled: false, is_default: true },
        ],
      }),
    ) as unknown as typeof fetch;

    const src = new GraylogSource({ getToken: () => "tok", fetchFn });
    const streams = await src.streams();
    expect(streams).toEqual([
      { id: "a", title: "Syslog", description: "", disabled: false, isDefault: true },
    ]);
  });

  it("sends bearer token and search body", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("/api/logs/search");
      expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
      const body = JSON.parse(String(init?.body));
      expect(body.query).toBe("source:web01");
      expect(body.limit).toBe(50);
      return jsonResponse({ messages: [], total: 0 });
    }) as unknown as typeof fetch;

    const src = new GraylogSource({ getToken: () => "tok", fetchFn });
    const result = await src.search({ query: "source:web01", from: 0, to: 100, limit: 50 });
    expect(result.total).toBe(0);
  });

  it("throws on gateway error status", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    const src = new GraylogSource({ getToken: () => "tok", fetchFn });
    await expect(src.hostLogs("42", { from: 0, to: 1 })).rejects.toThrow("HTTP 403");
  });

  it("status() returns false when gateway unreachable", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(GraylogSource.status("", fetchFn)).resolves.toBe(false);
  });
});

describe("NullLogSource", () => {
  it("is disabled and returns empty results", async () => {
    const src = new NullLogSource();
    expect(src.enabled).toBe(false);
    await expect(src.streams()).resolves.toEqual([]);
    await expect(src.search()).resolves.toEqual({ messages: [], total: 0 });
  });
});
