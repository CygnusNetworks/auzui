import { describe, expect, it, vi } from "vitest";
import { GatewayDockerSource, NullDockerSource } from "../src/index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GatewayDockerSource.status", () => {
  it("returns true when the gateway reports enabled", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ enabled: true })) as unknown as typeof fetch;
    expect(await GatewayDockerSource.status("", fetchFn)).toBe(true);
  });

  it("returns false on a non-ok response", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 500)) as unknown as typeof fetch;
    expect(await GatewayDockerSource.status("", fetchFn)).toBe(false);
  });

  it("returns false when fetch throws", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await GatewayDockerSource.status("", fetchFn)).toBe(false);
  });
});

describe("GatewayDockerSource", () => {
  it("maps gateway host summaries snake_case -> camelCase", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("/api/docker/hosts");
      return jsonResponse({
        hosts: [
          {
            id: "prod-a",
            label: "prod-a",
            readonly: true,
            compose: false,
            zabbix_host: "",
            engine_version: "27.0.1",
            containers_running: 3,
            containers_stopped: 1,
            images: 12,
          },
        ],
        errors: [{ host_id: "edge", message: "connection refused" }],
      });
    }) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.hosts();
    expect(result).toEqual({
      hosts: [
        {
          id: "prod-a",
          label: "prod-a",
          readonly: true,
          compose: false,
          zabbixHost: "",
          engineVersion: "27.0.1",
          containersRunning: 3,
          containersStopped: 1,
          images: 12,
        },
      ],
      errors: [{ hostId: "edge", message: "connection refused" }],
    });
  });

  it("sends bearer token and builds the containers query string with repeated host keys", async () => {
    // docker_routes.py declares `hosts: list[str] | None = Query(...)`, FastAPI's
    // repeated-key convention (?hosts=a&hosts=b) — NOT a comma-joined value.
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("/api/docker/containers?hosts=prod-a&hosts=db-1&all=1");
      expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
      return jsonResponse({ containers: [], errors: [] });
    }) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    await src.containers({ hostIds: ["prod-a", "db-1"], all: true });
  });

  it("maps a normalized container row snake_case -> camelCase", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        containers: [
          {
            id: "abc123",
            host_id: "prod-a",
            name: "web-1",
            names: ["web-1"],
            image: "nginx",
            tag: "1.27",
            image_id: "sha256:deadbeef",
            state: "running",
            status: "Up 2 hours (healthy)",
            health: "healthy",
            created: 1700000000,
            ports: [{ private: 80, public: 8080, type: "tcp", ip: "0.0.0.0" }],
            project: "myapp",
            service: "web",
            compose_working_dir: "/srv/myapp",
            labels: { "com.docker.compose.project": "myapp" },
          },
        ],
        errors: [],
      }),
    ) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.containers();
    expect(result.containers).toEqual([
      {
        id: "abc123",
        hostId: "prod-a",
        name: "web-1",
        names: ["web-1"],
        image: "nginx",
        tag: "1.27",
        imageId: "sha256:deadbeef",
        state: "running",
        status: "Up 2 hours (healthy)",
        health: "healthy",
        created: 1700000000,
        ports: [{ private: 80, public: 8080, type: "tcp", ip: "0.0.0.0" }],
        project: "myapp",
        service: "web",
        composeWorkingDir: "/srv/myapp",
        labels: { "com.docker.compose.project": "myapp" },
      },
    ]);
  });

  it("maps inspect keeping the host_id -> hostId rename and passing through the rest", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("/api/docker/containers/prod-a/abc123");
      return jsonResponse({ host_id: "prod-a", Id: "abc123", Config: { Image: "nginx:1.27" } });
    }) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.inspect("prod-a", "abc123");
    expect(result).toEqual({ hostId: "prod-a", Id: "abc123", Config: { Image: "nginx:1.27" } });
  });

  it("maps single-container stats snake_case -> camelCase", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("/api/docker/containers/prod-a/abc123/stats");
      return jsonResponse({
        cpu_pct: 12.34,
        mem_used: 1048576,
        mem_limit: 2097152,
        net_rx: 100,
        net_tx: 200,
        blk_read: 300,
        blk_write: 400,
      });
    }) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    expect(await src.stats("prod-a", "abc123")).toEqual({
      cpuPct: 12.34,
      memUsed: 1048576,
      memLimit: 2097152,
      netRx: 100,
      netTx: 200,
      blkRead: 300,
      blkWrite: 400,
    });
  });

  it("bulkStats posts targets and maps the nested hostId -> cid -> stats map", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("/api/docker/stats");
      expect(JSON.parse(String(init?.body))).toEqual({ targets: { "prod-a": ["abc123"] } });
      return jsonResponse({
        stats: {
          "prod-a": {
            abc123: {
              cpu_pct: 1,
              mem_used: 2,
              mem_limit: 3,
              net_rx: 4,
              net_tx: 5,
              blk_read: 6,
              blk_write: 7,
            },
          },
        },
        errors: [],
      });
    }) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.bulkStats({ "prod-a": ["abc123"] });
    expect(result.stats["prod-a"]?.["abc123"]).toEqual({
      cpuPct: 1,
      memUsed: 2,
      memLimit: 3,
      netRx: 4,
      netTx: 5,
      blkRead: 6,
      blkWrite: 7,
    });
  });

  it("builds the logs query string and maps cursor/lines through", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe(
        "/api/docker/containers/prod-a/abc123/logs?since=100&tail=200&stdout=true&stderr=true",
      );
      return jsonResponse({
        lines: [{ ts: 100.123, stream: "stdout", message: "hello" }],
        cursor: "2024-01-01T00:00:00.123000001Z",
      });
    }) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.logs("prod-a", "abc123", { since: 100, tail: 200, stdout: true, stderr: true });
    expect(result).toEqual({
      lines: [{ ts: 100.123, stream: "stdout", message: "hello" }],
      cursor: "2024-01-01T00:00:00.123000001Z",
    });
  });

  it("logs() maps a null cursor to null (not undefined)", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ lines: [], cursor: null }),
    ) as unknown as typeof fetch;
    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    expect((await src.logs("prod-a", "abc123")).cursor).toBeNull();
  });

  it("search maps results per resource type and tags host_id -> hostId on raw rows", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("/api/docker/search?q=nginx&types=containers&types=images&hosts=prod-a");
      return jsonResponse({
        results: {
          containers: [],
          images: [{ host_id: "prod-a", used_by: ["web-nginx"], RepoTags: ["nginx:1.27"] }],
          volumes: [],
          networks: [],
        },
        errors: [],
      });
    }) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.search({ q: "nginx", types: ["containers", "images"], hostIds: ["prod-a"] });
    expect(result.results.images).toEqual([
      { hostId: "prod-a", usedBy: ["web-nginx"], RepoTags: ["nginx:1.27"] },
    ]);
  });

  it("search defaults a row without used_by to an empty usedBy", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        results: { containers: [], images: [], volumes: [{ host_id: "prod-a", Name: "pgdata" }], networks: [] },
        errors: [],
      }),
    ) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.search({ q: "", types: ["volumes"] });
    expect(result.results.volumes).toEqual([{ hostId: "prod-a", usedBy: [], Name: "pgdata" }]);
  });

  it("maps updates snake_case -> camelCase, nested by host and container", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("/api/docker/updates");
      return jsonResponse({
        updates: {
          "prod-a": {
            abc123: {
              tag: "1.27",
              local_digest: "sha256:aaa",
              remote_digest: "sha256:bbb",
              status: "outdated",
            },
          },
        },
        errors: [],
      });
    }) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.updates();
    expect(result.updates["prod-a"]?.["abc123"]).toEqual({
      tag: "1.27",
      localDigest: "sha256:aaa",
      remoteDigest: "sha256:bbb",
      status: "outdated",
    });
  });

  it("maps permissions can_act -> canAct", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ can_act: true })) as unknown as typeof fetch;
    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    expect(await src.permissions()).toEqual({ canAct: true });
  });

  it("action posts the action and maps container_id -> containerId", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("/api/docker/containers/prod-a/abc123/action");
      expect(JSON.parse(String(init?.body))).toEqual({ action: "restart" });
      return jsonResponse({ action: "restart", container_id: "abc123" });
    }) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.action("prod-a", "abc123", "restart");
    expect(result).toEqual({ action: "restart", containerId: "abc123", updated: undefined, digest: undefined });
  });

  it("action maps pull_recreate's updated/digest fields", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ updated: true, digest: "sha256:new", container_id: "def456" }),
    ) as unknown as typeof fetch;
    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.action("prod-a", "abc123", "pull_recreate");
    expect(result).toEqual({
      action: undefined,
      containerId: "def456",
      updated: true,
      digest: "sha256:new",
    });
  });

  it("stacks maps grouped containers and the compose flag", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("/api/docker/stacks/edge");
      return jsonResponse({
        stacks: [
          {
            project: "myapp",
            containers: [
              {
                id: "c1",
                host_id: "edge",
                name: "web",
                names: ["web"],
                image: "nginx",
                tag: "latest",
                image_id: "sha256:x",
                state: "running",
                status: "Up",
                health: null,
                created: 1,
                ports: [],
                project: "myapp",
                service: "web",
                compose_working_dir: "/srv/myapp",
                labels: {},
              },
            ],
          },
        ],
        compose: true,
        errors: [],
      });
    }) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.stacks("edge");
    expect(result.compose).toBe(true);
    expect(result.stacks[0]?.containers[0]?.hostId).toBe("edge");
  });

  it("stacks maps a stack's ps rows through untouched", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        stacks: [
          {
            project: "myapp",
            containers: [],
            ps: [{ Name: "myapp-web-1", State: "running" }],
          },
        ],
        compose: true,
        errors: [],
      }),
    ) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.stacks("edge");
    expect(result.stacks[0]?.ps).toEqual([{ Name: "myapp-web-1", State: "running" }]);
  });

  it("stacks omits ps on a stack when the gateway didn't send it", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        stacks: [{ project: "myapp", containers: [] }],
        compose: false,
        errors: [],
      }),
    ) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.stacks("db-1");
    expect(result.stacks[0]).not.toHaveProperty("ps");
  });

  it("stackConfig fetches the compose file's path/content", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("/api/docker/stacks/edge/myapp/config");
      return jsonResponse({ path: "/srv/myapp/docker-compose.yml", content: "services:\n  web: {}\n" });
    }) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.stackConfig("edge", "myapp");
    expect(result).toEqual({ path: "/srv/myapp/docker-compose.yml", content: "services:\n  web: {}\n" });
  });

  it("stackAction posts the action and returns stdout/stderr", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("/api/docker/stacks/edge/myapp/action");
      expect(JSON.parse(String(init?.body))).toEqual({ action: "up" });
      return jsonResponse({ stdout: "Recreating myapp_web_1 ... done", stderr: "" });
    }) as unknown as typeof fetch;

    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    const result = await src.stackAction("edge", "myapp", "up");
    expect(result).toEqual({ stdout: "Recreating myapp_web_1 ... done", stderr: "" });
  });

  it("surfaces FastAPI's {detail} on non-ok responses", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ detail: "unknown docker host: bogus" }, 404),
    ) as unknown as typeof fetch;
    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    await expect(src.hosts()).rejects.toThrow("unknown docker host: bogus");
  });

  it("falls back to a generic HTTP-status message when there is no {detail}", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const src = new GatewayDockerSource({ getToken: () => "tok", fetchFn });
    await expect(src.hosts()).rejects.toThrow("gateway /api/docker/hosts failed: HTTP 500");
  });
});

describe("NullDockerSource", () => {
  it("is disabled and returns empty/neutral results without network calls", async () => {
    const src = new NullDockerSource();
    expect(src.enabled).toBe(false);
    expect(await src.hosts()).toEqual({ hosts: [], errors: [] });
    expect(await src.containers()).toEqual({ containers: [], errors: [] });
    expect(await src.stats()).toEqual({
      cpuPct: 0,
      memUsed: 0,
      memLimit: 0,
      netRx: 0,
      netTx: 0,
      blkRead: 0,
      blkWrite: 0,
    });
    expect(await src.bulkStats()).toEqual({ stats: {}, errors: [] });
    expect(await src.logs()).toEqual({ lines: [], cursor: null });
    expect(await src.search()).toEqual({
      results: { containers: [], images: [], volumes: [], networks: [] },
      errors: [],
    });
    expect(await src.updates()).toEqual({ updates: {}, errors: [] });
    expect(await src.permissions()).toEqual({ canAct: false });
    expect(await src.stacks()).toEqual({ stacks: [], compose: false, errors: [] });
  });

  it("rejects write operations", async () => {
    const src = new NullDockerSource();
    await expect(src.inspect("h", "c")).rejects.toThrow();
    await expect(src.action("h", "c", "restart")).rejects.toThrow();
    await expect(src.stackAction("h", "p", "up")).rejects.toThrow();
  });

  it("rejects stackConfig", async () => {
    const src = new NullDockerSource();
    await expect(src.stackConfig("h", "p")).rejects.toThrow();
  });
});
