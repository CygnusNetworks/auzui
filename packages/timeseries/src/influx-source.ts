import type {
  QueryOptions,
  Series,
  SeriesRequestItem,
  TimeRange,
  TimeseriesSource,
} from "./source";

export interface InfluxSourceOptions {
  /** Base URL of the auzui-gateway, default "" (same origin). */
  gatewayBase?: string;
  /** Zabbix session token — the gateway checks item permissions with it. */
  getToken: () => string | undefined;
  fetchFn?: typeof fetch;
}

interface GatewayTsResponse {
  series: { itemid: string; points: [number, number][] }[];
}

/**
 * Optional fast path: auzui-gateway → InfluxDB (effluence). Server-side
 * aggregateWindow does the downsampling; the gateway enforces Zabbix item
 * permissions and keeps the Influx token out of the browser.
 */
export class InfluxSource implements TimeseriesSource {
  readonly kind = "influx" as const;
  private readonly base: string;
  private readonly getToken: () => string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(opts: InfluxSourceOptions) {
    this.base = opts.gatewayBase ?? "";
    this.getToken = opts.getToken;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /** GET /api/ts/status → whether the gateway has Influx configured. */
  static async status(
    gatewayBase = "",
    fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  ): Promise<boolean> {
    try {
      const res = await fetchFn(`${gatewayBase}/api/ts/status`);
      if (!res.ok) return false;
      const body = (await res.json()) as { enabled?: boolean };
      return body.enabled === true;
    } catch {
      return false;
    }
  }

  async query(
    items: SeriesRequestItem[],
    range: TimeRange,
    opts: QueryOptions = {},
  ): Promise<Series[]> {
    const token = this.getToken();
    const res = await this.fetchFn(`${this.base}/api/ts/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        itemids: items.map((i) => i.itemid),
        start: range.from,
        end: range.to,
        points: opts.points ?? 800,
        fn: opts.fn ?? "last",
      }),
      signal: opts.signal,
    });
    if (!res.ok) {
      throw new Error(`gateway /api/ts/query failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as GatewayTsResponse;
    return body.series.map((s) => ({
      itemid: s.itemid,
      points: s.points.map(([t, v]) => ({ t, v })),
      source: "influx" as const,
    }));
  }
}
