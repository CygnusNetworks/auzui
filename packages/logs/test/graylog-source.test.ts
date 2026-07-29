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

  it("sends offset for pagination and include/exclude filter chips", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.offset).toBe(50);
      expect(body.include).toEqual([{ field: "facility", value: "local0" }]);
      expect(body.exclude).toEqual([{ field: "application_name", value: "sshd" }]);
      return jsonResponse({ messages: [], total: 0 });
    }) as unknown as typeof fetch;

    const src = new GraylogSource({ getToken: () => "tok", fetchFn });
    await src.search({
      from: 0,
      to: 100,
      offset: 50,
      include: [{ field: "facility", value: "local0" }],
      exclude: [{ field: "application_name", value: "sshd" }],
    });
  });

  it("omits include/exclude keys entirely when no filters are set", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.include).toBeUndefined();
      expect(body.exclude).toBeUndefined();
      return jsonResponse({ messages: [], total: 0 });
    }) as unknown as typeof fetch;

    const src = new GraylogSource({ getToken: () => "tok", fetchFn });
    await src.search({ from: 0, to: 100 });
  });

  it("maps gateway message id and facility_num through to LogMessage", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        messages: [
          {
            id: "msg-1",
            timestamp: 100,
            source: "web01",
            message: "hi",
            facility: "local0",
            facility_num: 16,
          },
        ],
        total: 1,
      }),
    ) as unknown as typeof fetch;

    const src = new GraylogSource({ getToken: () => "tok", fetchFn });
    const result = await src.search({ from: 0, to: 100 });
    expect(result.messages[0]).toMatchObject({ id: "msg-1", facilityNum: 16 });
  });

  it("hostLogs sends offset and exclude filters (e.g. host exclude chips)", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.offset).toBe(20);
      expect(body.exclude).toEqual([{ field: "source", value: "noisy-host" }]);
      return jsonResponse({ messages: [], total: 0 });
    }) as unknown as typeof fetch;

    const src = new GraylogSource({ getToken: () => "tok", fetchFn });
    await src.hostLogs("42", {
      from: 0,
      to: 100,
      offset: 20,
      exclude: [{ field: "source", value: "noisy-host" }],
    });
  });

  it("throws on gateway error status", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    const src = new GraylogSource({ getToken: () => "tok", fetchFn });
    await expect(src.hostLogs("42", { from: 0, to: 1 })).rejects.toThrow("HTTP 403");
  });

  it("surfaces the gateway's FastAPI error detail instead of a bare status code", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ detail: "Graylog timeout" }, 504)) as unknown as typeof fetch;
    const src = new GraylogSource({ getToken: () => "tok", fetchFn });
    await expect(src.search({ from: 0, to: 1 })).rejects.toThrow("Graylog timeout");
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
