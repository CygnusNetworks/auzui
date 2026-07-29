import { describe, expect, it, vi } from "vitest";
import { ZabbixApi, ZabbixApiError, ZabbixClient, ZabbixTransportError } from "../src/index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mkClient(fetchFn: typeof fetch, token?: string) {
  return new ZabbixClient({ url: "https://zbx.test/api_jsonrpc.php", token, fetchFn });
}

describe("ZabbixClient", () => {
  it("sends a JSON-RPC envelope and returns result", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.jsonrpc).toBe("2.0");
      expect(body.method).toBe("apiinfo.version");
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: "7.0.0" });
    }) as unknown as typeof fetch;

    const version = await mkClient(fetchFn).call<string>("apiinfo.version", []);
    expect(version).toBe("7.0.0");
  });

  it("sends Bearer token except for user.login/apiinfo.version", async () => {
    const seen: Record<string, string | undefined> = {};
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      seen[body.method] = (init?.headers as Record<string, string>)["Authorization"];
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: [] });
    }) as unknown as typeof fetch;

    const client = mkClient(fetchFn, "tok123");
    await client.call("host.get", {});
    await client.call("apiinfo.version", []);
    expect(seen["host.get"]).toBe("Bearer tok123");
    expect(seen["apiinfo.version"]).toBeUndefined();
  });

  it("throws ZabbixApiError on error member", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32602, message: "Invalid params.", data: "Session terminated." },
      }),
    ) as unknown as typeof fetch;

    await expect(mkClient(fetchFn).call("host.get")).rejects.toMatchObject({
      name: "ZabbixApiError",
      code: -32602,
    });
  });

  it("throws ZabbixTransportError on HTTP failure", async () => {
    const fetchFn = vi.fn(async () => new Response("boom", { status: 502 })) as unknown as typeof fetch;
    await expect(mkClient(fetchFn).call("host.get")).rejects.toBeInstanceOf(ZabbixTransportError);
  });
});

describe("ZabbixApi", () => {
  it("login stores the session token on the client", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.method).toBe("user.login");
      expect(body.params).toEqual({ username: "u", password: "p" });
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: "sess-token" });
    }) as unknown as typeof fetch;

    const client = mkClient(fetchFn);
    const api = new ZabbixApi(client);
    await expect(api.login("u", "p")).resolves.toBe("sess-token");
    expect(client.getToken()).toBe("sess-token");
  });

  it("wraps errors from typed methods", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32500, message: "Not authorised." },
      }),
    ) as unknown as typeof fetch;

    const api = new ZabbixApi(mkClient(fetchFn, "bad"));
    await expect(api.problemGet()).rejects.toBeInstanceOf(ZabbixApiError);
  });
});
