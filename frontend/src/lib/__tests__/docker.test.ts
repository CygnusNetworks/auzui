import { describe, expect, it } from "vitest";
import type { DockerContainer, DockerLogLine, DockerPort } from "@auzui/docker";
import {
  DOCKER_LOG_BUFFER_CAP,
  UNGROUPED_STACK,
  containerBadgeTone,
  containerStateWeight,
  formatImageTag,
  formatPort,
  formatPorts,
  groupContainersByStack,
  mergeLogLines,
  sortContainersByState,
} from "../docker";

function container(overrides: Partial<DockerContainer> = {}): DockerContainer {
  return {
    id: overrides.id ?? "c1",
    hostId: "prod-a",
    name: "web-1",
    names: ["web-1"],
    image: "nginx",
    tag: "1.27",
    imageId: "sha256:x",
    state: "running",
    status: "Up 2 hours",
    health: null,
    created: 1700000000,
    ports: [],
    project: "",
    service: "",
    composeWorkingDir: "",
    labels: {},
    ...overrides,
  };
}

describe("groupContainersByStack", () => {
  it("groups containers by compose project", () => {
    const containers = [
      container({ id: "a", project: "myapp", name: "web" }),
      container({ id: "b", project: "myapp", name: "db" }),
      container({ id: "c", project: "other", name: "cache" }),
    ];
    const groups = groupContainersByStack(containers);
    expect(groups).toEqual([
      { project: "myapp", containers: [containers[0], containers[1]] },
      { project: "other", containers: [containers[2]] },
    ]);
  });

  it("puts containers without a project label into the ungrouped group", () => {
    const containers = [
      container({ id: "a", project: "", name: "standalone" }),
      container({ id: "b", project: "myapp", name: "web" }),
    ];
    const groups = groupContainersByStack(containers);
    expect(groups.map((g) => g.project)).toEqual(["myapp", UNGROUPED_STACK]);
    expect(groups[1]?.containers).toEqual([containers[0]]);
  });

  it("sorts ungrouped last even alphabetically before other project names", () => {
    const containers = [
      container({ id: "a", project: "" }),
      container({ id: "b", project: "zzz-app" }),
      container({ id: "c", project: "aaa-app" }),
    ];
    const groups = groupContainersByStack(containers);
    expect(groups.map((g) => g.project)).toEqual(["aaa-app", "zzz-app", UNGROUPED_STACK]);
  });

  it("returns an empty array for no containers", () => {
    expect(groupContainersByStack([])).toEqual([]);
  });
});

describe("containerStateWeight / sortContainersByState", () => {
  it("weighs running lowest and unknown states highest", () => {
    expect(containerStateWeight("running")).toBe(0);
    expect(containerStateWeight("exited")).toBeGreaterThan(containerStateWeight("running"));
    expect(containerStateWeight("some-future-state")).toBeGreaterThan(containerStateWeight("dead"));
  });

  it("sorts running containers before exited/dead ones", () => {
    const containers = [
      container({ id: "a", name: "z-exited", state: "exited" }),
      container({ id: "b", name: "a-running", state: "running" }),
      container({ id: "c", name: "m-dead", state: "dead" }),
    ];
    const sorted = sortContainersByState(containers);
    expect(sorted.map((c) => c.id)).toEqual(["b", "a", "c"]);
  });

  it("breaks ties within the same state by name", () => {
    const containers = [
      container({ id: "a", name: "zebra", state: "running" }),
      container({ id: "b", name: "alpha", state: "running" }),
    ];
    const sorted = sortContainersByState(containers);
    expect(sorted.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("does not mutate the input array", () => {
    const containers = [container({ id: "a", state: "exited" }), container({ id: "b", state: "running" })];
    const original = [...containers];
    sortContainersByState(containers);
    expect(containers).toEqual(original);
  });
});

describe("containerBadgeTone", () => {
  it("maps running to ok", () => {
    expect(containerBadgeTone("running")).toBe("ok");
  });

  it("maps exited/dead to danger", () => {
    expect(containerBadgeTone("exited")).toBe("danger");
    expect(containerBadgeTone("dead")).toBe("danger");
  });

  it("maps restarting to warn", () => {
    expect(containerBadgeTone("restarting")).toBe("warn");
  });

  it("maps paused/created to neutral", () => {
    expect(containerBadgeTone("paused")).toBe("neutral");
    expect(containerBadgeTone("created")).toBe("neutral");
  });

  it("an unhealthy healthcheck overrides a running state to danger", () => {
    expect(containerBadgeTone("running", "unhealthy")).toBe("danger");
  });

  it("a starting healthcheck overrides a running state to warn", () => {
    expect(containerBadgeTone("running", "starting")).toBe("warn");
  });

  it("a healthy healthcheck does not downgrade a running state", () => {
    expect(containerBadgeTone("running", "healthy")).toBe("ok");
  });
});

describe("formatPort / formatPorts", () => {
  it("formats an unpublished port as private/type", () => {
    const port: DockerPort = { private: 80, public: null, type: "tcp", ip: "" };
    expect(formatPort(port)).toBe("80/tcp");
  });

  it("formats a published port as public:private/type", () => {
    const port: DockerPort = { private: 80, public: 8080, type: "tcp", ip: "0.0.0.0" };
    expect(formatPort(port)).toBe("8080:80/tcp");
  });

  it("includes a specific bound host IP, but not the 0.0.0.0/:: wildcard", () => {
    const bound: DockerPort = { private: 80, public: 8080, type: "tcp", ip: "127.0.0.1" };
    expect(formatPort(bound)).toBe("127.0.0.1:8080:80/tcp");
    const wildcardV6: DockerPort = { private: 80, public: 8080, type: "tcp", ip: "::" };
    expect(formatPort(wildcardV6)).toBe("8080:80/tcp");
  });

  it("joins multiple ports with a comma", () => {
    const ports: DockerPort[] = [
      { private: 80, public: 8080, type: "tcp", ip: "0.0.0.0" },
      { private: 443, public: null, type: "tcp", ip: "" },
    ];
    expect(formatPorts(ports)).toBe("8080:80/tcp, 443/tcp");
  });

  it("formats an empty port list as an empty string", () => {
    expect(formatPorts([])).toBe("");
  });
});

describe("formatImageTag", () => {
  it("joins image and tag with a colon", () => {
    expect(formatImageTag("nginx", "1.27")).toBe("nginx:1.27");
  });

  it("falls back to the bare image when there is no tag", () => {
    expect(formatImageTag("nginx", "")).toBe("nginx");
  });

  it("returns an empty string for an empty image", () => {
    expect(formatImageTag("", "1.27")).toBe("");
  });
});

describe("mergeLogLines", () => {
  function line(ts: number, message: string, stream: "stdout" | "stderr" = "stdout"): DockerLogLine {
    return { ts, stream, message };
  }

  it("appends new lines to the buffer", () => {
    const existing = [line(1, "a")];
    const merged = mergeLogLines(existing, [line(2, "b")]);
    expect(merged).toEqual([line(1, "a"), line(2, "b")]);
  });

  it("is idempotent: delivering the same line twice keeps it only once", () => {
    const existing = [line(1, "a")];
    const merged = mergeLogLines(existing, [line(1, "a")]);
    expect(merged).toEqual([line(1, "a")]);
  });

  it("dedupes across a batch that overlaps the existing buffer", () => {
    const existing = [line(1, "a"), line(2, "b")];
    const merged = mergeLogLines(existing, [line(2, "b"), line(3, "c")]);
    expect(merged).toEqual([line(1, "a"), line(2, "b"), line(3, "c")]);
  });

  it("treats identical timestamp+message but different stream as distinct lines", () => {
    const existing = [line(1, "a", "stdout")];
    const merged = mergeLogLines(existing, [line(1, "a", "stderr")]);
    expect(merged).toEqual([line(1, "a", "stdout"), line(1, "a", "stderr")]);
  });

  it("returns the same buffer reference-equal-ish when incoming is empty", () => {
    const existing = [line(1, "a")];
    expect(mergeLogLines(existing, [])).toBe(existing);
  });

  it("does not mutate the existing buffer", () => {
    const existing = [line(1, "a")];
    const before = [...existing];
    mergeLogLines(existing, [line(2, "b")]);
    expect(existing).toEqual(before);
  });

  it("caps the buffer at DOCKER_LOG_BUFFER_CAP, trimming the oldest lines from the front", () => {
    const existing = Array.from({ length: DOCKER_LOG_BUFFER_CAP }, (_, i) => line(i, `msg-${i}`));
    const merged = mergeLogLines(existing, [line(DOCKER_LOG_BUFFER_CAP, "new")]);
    expect(merged.length).toBe(DOCKER_LOG_BUFFER_CAP);
    // The oldest line (ts=0) was trimmed; the newest is present.
    expect(merged[0]).toEqual(line(1, "msg-1"));
    expect(merged.at(-1)).toEqual(line(DOCKER_LOG_BUFFER_CAP, "new"));
  });
});
