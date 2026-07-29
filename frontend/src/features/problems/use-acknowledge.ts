import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import { buildAckAction } from "../../lib/ack";
import type { ZabbixProblem, ZabbixSeverity } from "@auzui/zabbix-client";

export interface AcknowledgeInput {
  /** One or more event ids — event.acknowledge natively accepts a batch. */
  eventids: string[];
  ack?: boolean;
  unack?: boolean;
  message?: string;
  suppress?: boolean;
  /** Unix timestamp, or 0 for indefinite. Only meaningful together with `suppress`. */
  suppressUntil?: number;
  unsuppress?: boolean;
  /** Presence of a value (including 0) requests a severity change. */
  severity?: number;
}

/**
 * event.acknowledge with an optimistic update on the `problems` query cache
 * (flips acknowledged/suppressed/severity immediately for every affected
 * event) and an invalidate on settle so the next poll reconciles with the
 * server.
 */
export function useAcknowledge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AcknowledgeInput) =>
      zabbixApi.eventAcknowledge({
        eventids: input.eventids,
        action: buildAckAction(input),
        message: input.message,
        severity: input.severity,
        suppress_until: input.suppress ? (input.suppressUntil ?? 0) : undefined,
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["problems"] });
      // Beide Varianten (default / with-suppressed) teilen das ["problems", …]
      // Präfix — optimistisch in allen matchenden Caches spiegeln.
      const previous = queryClient.getQueriesData<ZabbixProblem[]>({ queryKey: ["problems"] });
      const ids = new Set(input.eventids);
      queryClient.setQueriesData<ZabbixProblem[]>({ queryKey: ["problems"] }, (old) =>
        old?.map((p) => {
          if (!ids.has(p.eventid)) return p;
          return {
            ...p,
            ...(input.ack || input.unack ? { acknowledged: input.ack ? "1" : "0" } : {}),
            ...(input.suppress || input.unsuppress
              ? { suppressed: input.suppress ? "1" : "0" }
              : {}),
            ...(input.severity !== undefined
              ? { severity: String(input.severity) as ZabbixSeverity }
              : {}),
          };
        }),
      );
      return { previous };
    },
    onError: (_err, _input, context) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["problems"] });
    },
  });
}
