import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import type { MaintenanceCreatePayload } from "../../lib/maintenance";

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["maintenances"] });
  void queryClient.invalidateQueries({ queryKey: ["maintenance-hosts"] });
  void queryClient.invalidateQueries({ queryKey: ["problems"] });
}

export function useCreateMaintenance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MaintenanceCreatePayload) => zabbixApi.maintenanceCreate(payload),
    onSettled: () => invalidateAll(queryClient),
  });
}

export function useUpdateMaintenance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      maintenanceid,
      payload,
    }: {
      maintenanceid: string;
      payload: MaintenanceCreatePayload;
    }) => zabbixApi.maintenanceUpdate({ maintenanceid, ...payload }),
    onSettled: () => invalidateAll(queryClient),
  });
}

export function useDeleteMaintenance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (maintenanceid: string) => zabbixApi.maintenanceDelete([maintenanceid]),
    onSettled: () => invalidateAll(queryClient),
  });
}
