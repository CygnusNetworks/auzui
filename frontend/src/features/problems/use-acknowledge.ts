import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import { buildAckAction } from "../../lib/ack";
import type { ZabbixProblem } from "@auzui/zabbix-client";

export interface AcknowledgeInput {
  eventid: string;
  ack?: boolean;
  unack?: boolean;
  message?: string;
}

/**
 * event.acknowledge with an optimistic update on the `problems` query cache
 * (flips `acknowledged` immediately) and an invalidate on settle so the next
 * poll reconciles with the server.
 */
export function useAcknowledge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AcknowledgeInput) =>
      zabbixApi.eventAcknowledge({
        eventids: [input.eventid],
        action: buildAckAction(input),
        message: input.message,
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["problems"] });
      const previous = queryClient.getQueryData<ZabbixProblem[]>(["problems"]);
      if (previous && (input.ack || input.unack)) {
        queryClient.setQueryData<ZabbixProblem[]>(
          ["problems"],
          previous.map((p) =>
            p.eventid === input.eventid
              ? { ...p, acknowledged: input.ack ? "1" : "0" }
              : p,
          ),
        );
      }
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(["problems"], context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["problems"] });
    },
  });
}
