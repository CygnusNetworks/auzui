import type {
  LogMessage,
  LogSearchParams,
  LogSearchResult,
  LogSource,
  LogStream,
} from "./source";

export interface GraylogSourceOptions {
  /** Base URL of the auzui-gateway, default "" (same origin). */
  gatewayBase?: string;
  /** Zabbix session token — the gateway checks host permissions with it. */
  getToken: () => string | undefined;
  fetchFn?: typeof fetch;
}

interface GatewayStream {
  id: string;
  title: string;
  description: string;
  disabled: boolean;
  is_default: boolean;
}

interface GatewayMessage {
  timestamp: number;
  source: string;
  message: string;
  level?: number;
  facility?: string;
  stream_ids?: string[];
  fields?: Record<string, unknown>;
}

interface GatewaySearchResult {
  messages: GatewayMessage[];
  total: number;
  matched_sources?: string[];
}

/**
 * Talks to the auzui-gateway /api/logs/* endpoints (PLAN.md section H).
 * The Graylog token never reaches the browser; the gateway enforces Zabbix
 * host permissions with the caller's session token.
 */
export class GraylogSource implements LogSource {
  readonly enabled = true;
  private readonly base: string;
  private readonly getToken: () => string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(opts: GraylogSourceOptions) {
    this.base = opts.gatewayBase ?? "";
    this.getToken = opts.getToken;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /** GET /api/logs/status → whether the gateway has Graylog configured. */
  static async status(
    gatewayBase = "",
    fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  ): Promise<boolean> {
    try {
      const res = await fetchFn(`${gatewayBase}/api/logs/status`);
      if (!res.ok) return false;
      const body = (await res.json()) as { enabled?: boolean };
      return body.enabled === true;
    } catch {
      return false;
    }
  }

  async streams(signal?: AbortSignal): Promise<LogStream[]> {
    const res = await this.request("GET", "/api/logs/streams", undefined, signal);
    const body = (await res.json()) as { streams: GatewayStream[] };
    return body.streams.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      disabled: s.disabled,
      isDefault: s.is_default,
    }));
  }

  async search(params: LogSearchParams): Promise<LogSearchResult> {
    const res = await this.request(
      "POST",
      "/api/logs/search",
      {
        query: params.query ?? "*",
        stream_ids: params.streamIds,
        from: params.from,
        to: params.to,
        limit: params.limit ?? 100,
        offset: params.offset ?? 0,
      },
      params.signal,
    );
    return this.toResult((await res.json()) as GatewaySearchResult);
  }

  async hostLogs(
    hostid: string,
    params: Omit<LogSearchParams, "query"> & { extraQuery?: string },
  ): Promise<LogSearchResult> {
    const res = await this.request(
      "POST",
      `/api/logs/host/${encodeURIComponent(hostid)}`,
      {
        from: params.from,
        to: params.to,
        limit: params.limit ?? 100,
        extra_query: params.extraQuery,
        stream_ids: params.streamIds,
      },
      params.signal,
    );
    return this.toResult((await res.json()) as GatewaySearchResult);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const token = this.getToken();
    const res = await this.fetchFn(`${this.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!res.ok) {
      throw new Error((await this.extractErrorDetail(res)) ?? `gateway ${path} failed: HTTP ${res.status}`);
    }
    return res;
  }

  /** FastAPI's HTTPException serializes as {"detail": "..."} — surface that text (e.g. "Graylog timeout", "Graylog returned HTTP 400") instead of a bare status code. */
  private async extractErrorDetail(res: Response): Promise<string | undefined> {
    try {
      const body = (await res.clone().json()) as { detail?: unknown };
      return typeof body.detail === "string" ? body.detail : undefined;
    } catch {
      return undefined;
    }
  }

  private toResult(raw: GatewaySearchResult): LogSearchResult {
    const messages: LogMessage[] = raw.messages.map((m) => ({
      timestamp: m.timestamp,
      source: m.source,
      message: m.message,
      level: m.level,
      facility: m.facility,
      streamIds: m.stream_ids,
      fields: m.fields ?? {},
    }));
    return { messages, total: raw.total, matchedSources: raw.matched_sources };
  }
}
