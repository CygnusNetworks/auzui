import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import { aggregateDailyAvailability, enrichWebScenarios, type EnrichedWebScenario } from "../../lib/web-scenarios";

const DAY_SECONDS = 86_400;

/** Every web (HTTP) scenario, joined with its live status items (web.test.*). */
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
 */
export function useWebScenarioDetail(scenario: EnrichedWebScenario | undefined): {
  stepHistory: StepHistorySeries[];
  availability: ReturnType<typeof aggregateDailyAvailability>;
  isLoading: boolean;
} {
  const stepItemIds = useMemo(
    () => (scenario?.steps ?? []).map((s) => s.responseTimeItem?.itemid).filter((id): id is string => !!id),
    [scenario],
  );

  const historyQuery = useQuery({
    queryKey: ["web-scenarios", "step-history", stepItemIds],
    queryFn: () => {
      const till = Math.floor(Date.now() / 1000);
      return zabbixApi.historyGet({
        itemids: stepItemIds,
        history: 0,
        time_from: till - DAY_SECONDS,
        time_till: till,
      });
    },
    enabled: stepItemIds.length > 0,
    staleTime: 30_000,
  });

  const trendQuery = useQuery({
    queryKey: ["web-scenarios", "fail-trend", scenario?.failItem?.itemid],
    queryFn: () => {
      const till = Math.floor(Date.now() / 1000);
      return zabbixApi.trendGet({
        itemids: [scenario!.failItem!.itemid],
        time_from: till - 14 * DAY_SECONDS,
        time_till: till,
      });
    },
    enabled: !!scenario?.failItem,
    staleTime: 60_000,
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
  };
}
