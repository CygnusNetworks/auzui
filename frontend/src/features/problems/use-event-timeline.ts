import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";

/** event.get with select_acknowledges — powers the detail panel's timeline. */
export function useEventTimeline(eventid: string | undefined) {
  return useQuery({
    queryKey: ["event-timeline", eventid],
    queryFn: () =>
      zabbixApi.eventGet({
        eventids: [eventid!],
        select_acknowledges: "extend",
      }),
    enabled: !!eventid,
    staleTime: 15_000,
  });
}
