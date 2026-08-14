import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";

/**
 * event.get with selectAcknowledges — powers the detail panel's timeline.
 *
 * The parameter is camelCase: Zabbix 6.0 dropped the old snake_case
 * `select_acknowledges` and now rejects the whole request with "unexpected
 * parameter", which left the timeline permanently empty — no ack reason, no
 * comment, just "Problem erkannt".
 */
export function useEventTimeline(eventid: string | undefined) {
  return useQuery({
    queryKey: ["event-timeline", eventid],
    queryFn: () =>
      zabbixApi.eventGet({
        eventids: [eventid!],
        selectAcknowledges: "extend",
      }),
    enabled: !!eventid,
    staleTime: 15_000,
  });
}
