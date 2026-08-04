import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DockerComposePs, DockerContainer, DockerSource, DockerStackAction } from "@auzui/docker";
import { containerBadgeTone, formatImageTag } from "../../lib/docker";
import { useT } from "../../lib/i18n";
import { useDockerStackConfig, useDockerStacks } from "./use-docker-page";
import { DOT_TONE_CLASS } from "./ContainerDetailPanel";

const STACK_ACTIONS: DockerStackAction[] = ["pull", "up", "restart"];

/** Compose stack action mutation: invalidates the host's stacks + container list on success. */
function useDockerStackAction(source: DockerSource, hostId: string, project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: DockerStackAction) => source.stackAction(hostId, project, action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["docker-stacks", hostId] });
      void queryClient.invalidateQueries({ queryKey: ["docker-containers"] });
      void queryClient.invalidateQueries({ queryKey: ["docker-hosts"] });
    },
  });
}

/**
 * Detail panel for one compose stack (Dockge-level view, plan D8): its
 * containers (enriched with live `docker compose ps` state when the host is
 * compose-capable), the compose file it was deployed from — read-only
 * content on SSH/compose hosts (GET .../config), just the path from
 * container labels otherwise — and pull/up/restart actions.
 */
export function StackPanel({
  source,
  hostId,
  project,
  canAct,
}: {
  source: DockerSource;
  hostId: string;
  project: string;
  canAct: boolean;
}) {
  const t = useT();
  const stacksQuery = useDockerStacks(source, hostId);
  const mutation = useDockerStackAction(source, hostId, project);
  const composeCapable = stacksQuery.data?.compose === true;
  const configQuery = useDockerStackConfig(source, hostId, project, composeCapable);

  if (stacksQuery.isLoading) {
    return <div className="p-3.5 text-sm text-ink-2">{t("docker.stackPanel.loading")}</div>;
  }
  const stack = stacksQuery.data?.stacks.find((s) => s.project === project);
  if (!stack) {
    return <div className="p-3.5 text-sm text-ink-2">{t("docker.stackPanel.notFound")}</div>;
  }
  const configFile = firstConfigFile(stack.containers);
  const psStatus = psStatusByContainer(stack.containers, stack.ps);

  function run(action: DockerStackAction) {
    if (action !== "pull" && !window.confirm(t("docker.stackPanel.confirm", project))) return;
    mutation.mutate(action);
  }

  return (
    <div>
      <div className="border-b border-line-soft p-3.5">
        <div className="text-sm font-semibold">{project}</div>
        <div className="mt-1 font-mono text-[11px] text-ink-muted">
          {t("docker.stackPanel.containerCount", stack.containers.length)}
        </div>
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("docker.stackPanel.containers")}
        </div>
        <div className="flex flex-col gap-1.5">
          {stack.containers.map((c) => {
            const ps = psStatus.get(c.id);
            return (
              <div key={c.id} className="flex items-center gap-2 text-[12px]">
                <i className={`inline-block h-1.5 w-1.5 rounded-sm ${DOT_TONE_CLASS[containerBadgeTone(c.state, c.health)]}`} />
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.service || c.name}</span>
                {ps && <span className="truncate font-mono text-[10px] text-ink-muted">{ps}</span>}
                <span className="truncate font-mono text-[10.5px] text-ink-muted">
                  {formatImageTag(c.image, c.tag)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("docker.stackPanel.composeFile")}
        </div>
        {composeCapable ? (
          configQuery.isLoading ? (
            <div className="text-[11.5px] text-ink-muted">{t("docker.stackPanel.composeFileLoading")}</div>
          ) : configQuery.isError ? (
            <div className="text-[11.5px] text-ink-muted">{t("docker.stackPanel.composeFileError")}</div>
          ) : configQuery.data ? (
            <div>
              <div className="mb-1.5 break-all font-mono text-[10.5px] text-ink-muted">
                {configQuery.data.path}
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre rounded-md bg-surface-2 p-2 font-mono text-[11px] text-ink-2">
                {configQuery.data.content}
              </pre>
            </div>
          ) : (
            <div className="text-[11.5px] text-ink-muted">{t("docker.stackPanel.noComposeFile")}</div>
          )
        ) : configFile ? (
          <div className="break-all rounded-md bg-surface-2 p-2 font-mono text-[11px] text-ink-2">
            {configFile}
          </div>
        ) : (
          <div className="text-[11.5px] text-ink-muted">{t("docker.stackPanel.noComposeFile")}</div>
        )}
      </div>

      <div className="p-3.5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("docker.stackPanel.actions")}
        </div>
        {!canAct ? (
          <div className="text-[11.5px] text-ink-muted">{t("docker.stackPanel.noPermission")}</div>
        ) : !composeCapable ? (
          <div className="text-[11.5px] text-ink-muted">{t("docker.stackPanel.notComposeCapable")}</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {STACK_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                disabled={mutation.isPending}
                onClick={() => run(action)}
                className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t(`docker.stackPanel.action.${action}`)}
              </button>
            ))}
          </div>
        )}
        {mutation.isError && (
          <div className="mt-2 text-[11.5px] text-sev-high">
            {mutation.error instanceof Error ? mutation.error.message : t("docker.actions.unknownError")}
          </div>
        )}
        {mutation.isSuccess && mutation.data && (
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 font-mono text-[10.5px] text-ink-2">
            {mutation.data.stdout || mutation.data.stderr}
          </pre>
        )}
      </div>
    </div>
  );
}

/** Reads `com.docker.compose.project.config_files` off the first container that has it. */
export function firstConfigFile(containers: DockerContainer[]): string | undefined {
  for (const c of containers) {
    const configFiles = c.labels["com.docker.compose.project.config_files"];
    if (configFiles) return configFiles;
  }
  return undefined;
}

/**
 * Matches each `docker compose ps --format json` row to the container it
 * describes (by name — compose ps's "Name" field is the container's full
 * name) and picks out its "Status" text, which is often more current/
 * detailed than the container-list Status snapshot StackPanel otherwise
 * shows (e.g. "Up 2 minutes (healthy)" vs. a stale poll). Rows without a
 * usable Name/Status, or with no matching container, are silently skipped
 * — this is a best-effort enrichment, never required for the panel to
 * render.
 */
export function psStatusByContainer(
  containers: DockerContainer[],
  ps: DockerComposePs[] | undefined,
): Map<string, string> {
  const byId = new Map<string, string>();
  if (!ps) return byId;
  for (const row of ps) {
    const name = typeof row["Name"] === "string" ? row["Name"] : undefined;
    const status = typeof row["Status"] === "string" ? row["Status"] : undefined;
    if (!name || !status) continue;
    const container = containers.find((c) => c.name === name || c.names.includes(name));
    if (container) byId.set(container.id, status);
  }
  return byId;
}
