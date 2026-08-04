import type {
  DockerActionResult,
  DockerContainersResult,
  DockerHostsResult,
  DockerInspect,
  DockerLogsResult,
  DockerPermissions,
  DockerSearchResult,
  DockerSource,
  DockerStackActionResult,
  DockerStackConfig,
  DockerStacksResult,
  DockerStats,
  DockerStatsBulkResult,
  DockerUpdatesResult,
} from "./source";

/** No-op implementation used when the gateway reports Docker disabled. */
export class NullDockerSource implements DockerSource {
  readonly enabled = false;

  async hosts(): Promise<DockerHostsResult> {
    return { hosts: [], errors: [] };
  }

  async containers(): Promise<DockerContainersResult> {
    return { containers: [], errors: [] };
  }

  async inspect(hostId: string, cid: string): Promise<DockerInspect> {
    throw new Error(`docker disabled: cannot inspect ${cid} on host ${hostId}`);
  }

  async stats(): Promise<DockerStats> {
    return {
      cpuPct: 0,
      memUsed: 0,
      memLimit: 0,
      netRx: 0,
      netTx: 0,
      blkRead: 0,
      blkWrite: 0,
    };
  }

  async bulkStats(): Promise<DockerStatsBulkResult> {
    return { stats: {}, errors: [] };
  }

  async logs(): Promise<DockerLogsResult> {
    return { lines: [], cursor: null };
  }

  async search(): Promise<DockerSearchResult> {
    return { results: { containers: [], images: [], volumes: [], networks: [] }, errors: [] };
  }

  async updates(): Promise<DockerUpdatesResult> {
    return { updates: {}, errors: [] };
  }

  async permissions(): Promise<DockerPermissions> {
    return { canAct: false };
  }

  async action(hostId: string, cid: string, action: string): Promise<DockerActionResult> {
    throw new Error(`docker disabled: cannot ${action} ${cid} on host ${hostId}`);
  }

  async stacks(): Promise<DockerStacksResult> {
    return { stacks: [], compose: false, errors: [] };
  }

  async stackConfig(hostId: string, project: string): Promise<DockerStackConfig> {
    throw new Error(`docker disabled: cannot read compose config for stack ${project} on host ${hostId}`);
  }

  async stackAction(hostId: string, project: string, action: string): Promise<DockerStackActionResult> {
    throw new Error(`docker disabled: cannot ${action} stack ${project} on host ${hostId}`);
  }
}
