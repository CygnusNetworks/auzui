import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const eventGet = vi.fn().mockResolvedValue([]);
vi.mock("../../../lib/auth/store", () => ({ zabbixApi: { eventGet: (p: unknown) => eventGet(p) } }));

const { useEventTimeline } = await import("../use-event-timeline");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useEventTimeline", () => {
  /**
   * Regression: the old snake_case `select_acknowledges` is rejected outright
   * by Zabbix >= 6.0 ("unexpected parameter"), so the whole request failed and
   * the detail panel's timeline stayed empty — acknowledged problems showed no
   * ack reason and no comment.
   */
  it("requests the acknowledges with the camelCase parameter name", async () => {
    renderHook(() => useEventTimeline("404559"), { wrapper });
    await waitFor(() => expect(eventGet).toHaveBeenCalled());
    expect(eventGet).toHaveBeenCalledWith({ eventids: ["404559"], selectAcknowledges: "extend" });
  });

  it("does not query without an event id", () => {
    eventGet.mockClear();
    renderHook(() => useEventTimeline(undefined), { wrapper });
    expect(eventGet).not.toHaveBeenCalled();
  });
});
