import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DockerAction, DockerSource } from "@auzui/docker";
import { useT } from "../../lib/i18n";

/** Actions that change/replace a running container — gated behind a confirm dialog (plan D8). */
const DESTRUCTIVE_ACTIONS: ReadonlySet<DockerAction> = new Set(["stop", "restart", "pull_recreate"]);

/**
 * Container action mutation shared by the DockerPage row buttons and the
 * ContainerDetailPanel's Info tab: invalidates every query whose data an
 * action can change (container list/state, host summary counts, this
 * container's inspect payload, and update status after a pull_recreate).
 */
export function useDockerContainerAction(source: DockerSource, hostId: string, cid: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: DockerAction) => source.action(hostId, cid, action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["docker-containers"] });
      void queryClient.invalidateQueries({ queryKey: ["docker-hosts"] });
      void queryClient.invalidateQueries({ queryKey: ["docker-inspect", hostId, cid] });
      void queryClient.invalidateQueries({ queryKey: ["docker-updates"] });
      void queryClient.invalidateQueries({ queryKey: ["docker-bulk-stats"] });
    },
  });
}

const ACTION_BUTTON_CLASS =
  "rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink-2 hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Quick-action buttons for one container. Renders nothing when `canAct` is
 * false — the server enforces the admin/readonly-host gate regardless, this
 * is purely a display-level mirror of GET /api/docker/permissions (plan D4).
 * start/stop toggle by current `state`; restart and pull_recreate are always
 * offered while any action is possible.
 */
export function ActionButtons({
  source,
  hostId,
  cid,
  state,
  canAct,
  className = "",
}: {
  source: DockerSource;
  hostId: string;
  cid: string;
  state: string;
  canAct: boolean;
  className?: string;
}) {
  const t = useT();
  const mutation = useDockerContainerAction(source, hostId, cid);

  if (!canAct) return null;

  function confirmMessage(action: "stop" | "restart" | "pull_recreate"): string {
    switch (action) {
      case "stop":
        return t("docker.actions.confirm.stop", cid);
      case "restart":
        return t("docker.actions.confirm.restart", cid);
      case "pull_recreate":
        return t("docker.actions.confirm.pull_recreate", cid);
    }
  }

  function run(action: DockerAction) {
    if (DESTRUCTIVE_ACTIONS.has(action) && !window.confirm(confirmMessage(action as "stop" | "restart" | "pull_recreate"))) {
      return;
    }
    mutation.mutate(action);
  }

  const running = state === "running";
  const busy = mutation.isPending;
  const errorTitle = mutation.isError
    ? mutation.error instanceof Error
      ? mutation.error.message
      : t("docker.actions.unknownError")
    : undefined;

  return (
    <div
      className={`flex items-center gap-1 ${className}`}
      onClick={(e) => e.stopPropagation()}
      title={errorTitle}
    >
      {running ? (
        <button type="button" disabled={busy} onClick={() => run("stop")} className={ACTION_BUTTON_CLASS}>
          {t("docker.actions.stop")}
        </button>
      ) : (
        <button type="button" disabled={busy} onClick={() => run("start")} className={ACTION_BUTTON_CLASS}>
          {t("docker.actions.start")}
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => run("restart")} className={ACTION_BUTTON_CLASS}>
        {t("docker.actions.restart")}
      </button>
      <button type="button" disabled={busy} onClick={() => run("pull_recreate")} className={ACTION_BUTTON_CLASS}>
        {t("docker.actions.pullRecreate")}
      </button>
    </div>
  );
}
