import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import { QUERY_TIMEOUT_MS, withTimeout } from "../../lib/use-timeseries";
import { aggregateDailyAvailability, enrichWebScenarios, type EnrichedWebScenario } from "../../lib/web-scenarios";

const DAY_SECONDS = 86_400;

/**
 * Every web (HTTP) scenario, joined with its live status items (web.test.*).
 *
 * `webitems: true` is required here — Zabbix's `item.get` excludes
 * web-monitoring items by default (undocumented in the method's main param
 * list, only mentioned under the flag itself). Without it this query always
 * returns `[]` for any `web.test.*` search, so every scenario's
 * `responseTimeItem`/`failItem` stays undefined and the detail panel's
 * history/trend queries never even fire (they're gated on those being
 * present) — verified against the live deployment, where item.get with this
 * host's `web.test.` search returned zero rows, and returned the expected
 * items only once `webitems: true` was added.
 */
export function useWebScenarios(): {
  scenarios: EnrichedWebScenario[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
} {
  const httptestQuery = useQuery({
    queryKey: ["web-scenarios", "httptest"],
    queryFn: () =>
      zabbixApi.httptestGet({
        output: "extend",
        selectSteps: "extend",
        selectHosts: ["hostid", "host", "name"],
      }),
    staleTime: 60_000,
  });

  const httptests = useMemo(() => httptestQuery.data ?? [], [httptestQuery.data]);
  const hostids = useMemo(() => [...new Set(httptests.map((t) => t.hostid))], [httptests]);

  const itemsQuery = useQuery({
    queryKey: ["web-scenarios", "items", hostids],
    queryFn: () =>
      zabbixApi.itemGet({
        hostids,
        webitems: true,
        search: { key_: "web.test." },
        output: ["itemid", "hostid", "key_", "name", "value_type", "units", "lastvalue", "lastclock"],
      }),
    enabled: hostids.length > 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 20_000,
  });

  const scenarios = useMemo(
    () => enrichWebScenarios(httptests, itemsQuery.data ?? []),
    [httptests, itemsQuery.data],
  );

  return {
    scenarios,
    isLoading: httptestQuery.isLoading,
    isError: httptestQuery.isError || itemsQuery.isError,
    error: httptestQuery.error ?? itemsQuery.error,
    refetch: () => {
      void httptestQuery.refetch();
      void itemsQuery.refetch();
    },
  };
}

/** Enables/disables a scenario (httptest.update, status only) and refetches the list. */
export function useToggleWebScenario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { httptestid: string; enable: boolean }) =>
      zabbixApi.httptestUpdate({ httptestid: params.httptestid, status: params.enable ? "0" : "1" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["web-scenarios", "httptest"] });
    },
  });
}

export interface StepHistorySeries {
  itemid: string;
  stepName: string;
  points: { clock: number; value: number }[];
}

/**
 * Per-step response-time history (last 24h, for the stacked chart) and daily
 * availability (last 14 days, from web.test.fail's trend average) for one
 * selected scenario. Disabled entirely while nothing is selected.
 *
 * Both calls are wrapped in the same timeout used by the shared timeseries
 * path (lib/use-timeseries.ts) purely as defensive insurance against a slow
 * Zabbix instance — measured fast (~160ms/~330ms) against the live
 * deployment, so this isn't expected to bite, but a stall should surface as
 * `slow` instead of silently rendering as empty.
 */
export function useWebScenarioDetail(scenario: EnrichedWebScenario | undefined): {
  stepHistory: StepHistorySeries[];
  availability: ReturnType<typeof aggregateDailyAvailability>;
  isLoading: boolean;
  slow: boolean;
  refetch: () => void;
} {
  const stepItemIds = useMemo(
    () => (scenario?.steps ?? []).map((s) => s.responseTimeItem?.itemid).filter((id): id is string => !!id),
    [scenario],
  );

  const historyQuery = useQuery({
    queryKey: ["web-scenarios", "step-history", stepItemIds],
    queryFn: () => {
      const till = Math.floor(Date.now() / 1000);
      return withTimeout(
        zabbixApi.historyGet({
          itemids: stepItemIds,
          history: 0,
          time_from: till - DAY_SECONDS,
          time_till: till,
        }),
        QUERY_TIMEOUT_MS,
      );
    },
    enabled: stepItemIds.length > 0,
    staleTime: 30_000,
    retry: false,
  });

  const trendQuery = useQuery({
    queryKey: ["web-scenarios", "fail-trend", scenario?.failItem?.itemid],
    queryFn: () => {
      const till = Math.floor(Date.now() / 1000);
      return withTimeout(
        zabbixApi.trendGet({
          itemids: [scenario!.failItem!.itemid],
          time_from: till - 14 * DAY_SECONDS,
          time_till: till,
        }),
        QUERY_TIMEOUT_MS,
      );
    },
    enabled: !!scenario?.failItem,
    staleTime: 60_000,
    retry: false,
  });

  const stepHistory = useMemo<StepHistorySeries[]>(() => {
    if (!scenario) return [];
    const points = historyQuery.data ?? [];
    return scenario.steps
      .filter((s) => !!s.responseTimeItem)
      .map((s) => ({
        itemid: s.responseTimeItem!.itemid,
        stepName: s.step.name,
        points: points
          .filter((p) => p.itemid === s.responseTimeItem!.itemid)
          .map((p) => ({ clock: Number(p.clock), value: Number(p.value) }))
          .sort((a, b) => a.clock - b.clock),
      }));
  }, [scenario, historyQuery.data]);

  const availability = useMemo(
    () => aggregateDailyAvailability(trendQuery.data ?? []),
    [trendQuery.data],
  );

  return {
    stepHistory,
    availability,
    isLoading: historyQuery.isLoading || trendQuery.isLoading,
    slow: historyQuery.isError || trendQuery.isError,
    refetch: () => {
      void historyQuery.refetch();
      void trendQuery.refetch();
    },
  };
}
