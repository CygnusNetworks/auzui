import type { LogSearchResult, LogSource, LogStream } from "./source";

/** No-op implementation used when the gateway reports logs disabled. */
export class NullLogSource implements LogSource {
  readonly enabled = false;

  async streams(): Promise<LogStream[]> {
    return [];
  }

  async search(): Promise<LogSearchResult> {
    return { messages: [], total: 0 };
  }

  async hostLogs(): Promise<LogSearchResult> {
    return { messages: [], total: 0 };
  }
}
