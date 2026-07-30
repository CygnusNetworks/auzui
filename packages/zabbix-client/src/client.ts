import type { ZabbixApiErrorShape } from "./types";

export interface ZabbixClientOptions {
  /** Full URL of api_jsonrpc.php, e.g. https://zabbix.example.de/api_jsonrpc.php */
  url: string;
  /** Session/API token; sent as Bearer. Not needed for user.login/apiinfo.version. */
  token?: string;
  /** Per-request timeout in ms. Default 30 000. */
  timeoutMs?: number;
  /** Custom fetch (tests, node). Defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
}

/** Error reported by the Zabbix API itself (JSON-RPC error member). */
export class ZabbixApiError extends Error {
  readonly code: number;
  readonly data?: string;

  constructor(err: ZabbixApiErrorShape) {
    super(err.data ? `${err.message} ${err.data}` : err.message);
    this.name = "ZabbixApiError";
    this.code = err.code;
    this.data = err.data;
  }
}

/** Transport-level failure: HTTP status, network error, malformed body. */
export class ZabbixTransportError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ZabbixTransportError";
    this.status = status;
  }
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: ZabbixApiErrorShape;
}

/**
 * Minimal JSON-RPC 2.0 client for the Zabbix API.
 *
 * Auth model (Zabbix >= 6.4): the session token from user.login (or an API
 * token) travels as an `Authorization: Bearer` header; the legacy `auth`
 * body member is not sent.
 */
export class ZabbixClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private token?: string;
  private nextId = 1;

  constructor(opts: ZabbixClientOptions) {
    this.url = opts.url;
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    // Not bound eagerly: resolving `globalThis.fetch` at call time (rather
    // than snapshotting it here) lets a module-level singleton (e.g. the
    // shared `zabbixClient` in lib/auth/store.ts) keep working if something
    // legitimately replaces globalThis.fetch after this constructor has
    // already run — e.g. the demo build's mock-backend shim, installed
    // dynamically after the singleton is constructed (src/demo/start.ts).
    this.fetchFn = opts.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  getToken(): string | undefined {
    return this.token;
  }

  async call<T>(method: string, params: unknown = {}, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
    const onOuterAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onOuterAbort, { once: true });

    const headers: Record<string, string> = {
      "Content-Type": "application/json-rpc",
    };
    // user.login and apiinfo.version reject requests that carry auth.
    if (this.token && method !== "user.login" && method !== "apiinfo.version") {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    let res: Response;
    try {
      res = await this.fetchFn(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
        signal: controller.signal,
      });
    } catch (e) {
      throw new ZabbixTransportError(
        e instanceof Error ? e.message : "network error",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onOuterAbort);
    }

    if (!res.ok) {
      throw new ZabbixTransportError(`HTTP ${res.status}`, res.status);
    }

    let body: JsonRpcResponse<T>;
    try {
      body = (await res.json()) as JsonRpcResponse<T>;
    } catch {
      throw new ZabbixTransportError("invalid JSON in response", res.status);
    }

    if (body.error) throw new ZabbixApiError(body.error);
    if (body.result === undefined) {
      throw new ZabbixTransportError("JSON-RPC response without result");
    }
    return body.result;
  }
}
