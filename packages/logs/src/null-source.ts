import type {
  LogFilterSet,
  LogSearchResult,
  LogServersResult,
  LogSource,
  LogStream,
} from "./source";

/** No-op implementation used when the gateway reports logs disabled. */
export class NullLogSource implements LogSource {
  readonly enabled = false;

  async servers(): Promise<LogServersResult> {
    return { servers: [], dedupEnabled: false };
  }

  async streams(): Promise<LogStream[]> {
    return [];
  }

  async search(): Promise<LogSearchResult> {
    return { messages: [], total: 0 };
  }

  async hostLogs(): Promise<LogSearchResult> {
    return { messages: [], total: 0 };
  }

  async listFilterSets(): Promise<LogFilterSet[]> {
    return [];
  }

  async createFilterSet(): Promise<LogFilterSet> {
    throw new Error("logs disabled");
  }

  async updateFilterSet(): Promise<LogFilterSet> {
    throw new Error("logs disabled");
  }

  async deleteFilterSet(): Promise<void> {
    // no-op
  }
}
