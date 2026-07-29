import { describe, expect, it, vi } from "vitest";
import type { ZabbixApi } from "@auzui/zabbix-client";
import { ZabbixApiSource } from "../src/zabbix-api-source";

function mkApi() {
  return {
    historyGet: vi.fn(async () => [
      { itemid: "1", clock: "100", value: "1.5" },
      { itemid: "1", clock: "160", value: "2.5" },
    ]),
    trendGet: vi.fn(async () => [
      { itemid: "1", clock: "3600", num: "60", value_min: "1", value_avg: "2", value_max: "3" },
    ]),
  } as unknown as ZabbixApi & { historyGet: ReturnType<typeof vi.fn>; trendGet: ReturnType<typeof vi.fn> };
}

describe("ZabbixApiSource", () => {
  it("uses history.get within the history window", async () => {
    const api = mkApi();
    const src = new ZabbixApiSource(api);
    const [series] = await src.query([{ itemid: "1", valueType: 3 }], { from: 0, to: 3600 });
    expect(api.historyGet).toHaveBeenCalledOnce();
    expect(api.trendGet).not.toHaveBeenCalled();
    expect(series!.source).toBe("history");
    expect(series!.points).toEqual([
      { t: 100, v: 1.5 },
      { t: 160, v: 2.5 },
    ]);
  });

  it("switches to trend.get beyond the history window", async () => {
    const api = mkApi();
    const src = new ZabbixApiSource(api, { historyMaxRangeSeconds: 3600 });
    const [series] = await src.query([{ itemid: "1", valueType: 0 }], { from: 0, to: 86400 });
    expect(api.trendGet).toHaveBeenCalledOnce();
    expect(api.historyGet).not.toHaveBeenCalled();
    expect(series!.source).toBe("trend");
    expect(series!.points).toEqual([{ t: 3600, v: 2 }]);
  });

  it("passes the value_type through to history.get", async () => {
    const api = mkApi();
    const src = new ZabbixApiSource(api);
    await src.query([{ itemid: "7", valueType: 0 }], { from: 0, to: 60 });
    expect(api.historyGet).toHaveBeenCalledWith(expect.objectContaining({ history: 0 }));
  });
});
