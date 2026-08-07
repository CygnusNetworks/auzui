import { describe, expect, it } from "vitest";
import type { DockerContainer, DockerLogLine, DockerPort } from "@auzui/docker";
import {
  DOCKER_LOG_BUFFER_CAP,
  UNGROUPED_STACK,
  containerBadgeTone,
  containerStateWeight,
  describeResourceRow,
  describeResourceRows,
  formatBytes,
  formatImageTag,
  imageDigest,
  imageReclaimable,
  networkFlags,
  networkGateways,
  resourceAge,
  resourceComposeProject,
  resourceCreatedAt,
  resourceLabels,
  resourceLaneSummary,
  formatPort,
  formatPorts,
  groupContainersByStack,
  mergeLogLines,
  shortDockerId,
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

describe("formatBytes", () => {
  it("renders whole bytes without decimals and larger units with one", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GiB");
  });

  it("clamps non-positive and non-finite sizes to 0 B", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("shortDockerId", () => {
  it("strips the sha256: prefix and keeps 12 hex chars", () => {
    expect(shortDockerId("sha256:abcdef0123456789aaaa")).toBe("abcdef012345");
  });

  it("leaves a short or unprefixed id alone", () => {
    expect(shortDockerId("abc")).toBe("abc");
  });
});

describe("describeResourceRow", () => {
  it("names a tagged image by its first tag and shows its short id underneath", () => {
    const row = {
      hostId: "prod-a",
      usedBy: ["web-nginx"],
      Id: "sha256:aabbccddeeff00112233",
      RepoTags: ["nginx:1.27"],
      Size: 187 * 1024 * 1024,
    };
    // toMatchObject, not toEqual: the display also carries createdAt and the
    // source row, which the panel reads and these cases do not describe.
    expect(describeResourceRow("images", row)).toMatchObject({
      key: "sha256:aabbccddeeff00112233",
      name: "nginx:1.27",
      sub: "aabbccddeeff",
      right: "187.0 MiB",
      usedBy: ["web-nginx"],
    });
  });

  it("lists an image's remaining tags instead of its id when it has several", () => {
    const row = {
      hostId: "prod-a",
      usedBy: [],
      Id: "sha256:aabbccddeeff00112233",
      RepoTags: ["nginx:1.27", "nginx:latest"],
      Size: 1024,
    };
    expect(describeResourceRow("images", row).sub).toBe("nginx:latest");
  });

  it("falls back to the short id for a dangling image, dropping the <none> pseudo-tag", () => {
    const row = {
      hostId: "prod-a",
      usedBy: [],
      Id: "sha256:aabbccddeeff00112233",
      RepoTags: ["<none>:<none>"],
      Size: 0,
    };
    const display = describeResourceRow("images", row);
    expect(display.name).toBe("aabbccddeeff");
    expect(display.sub).toBe("");
  });

  it("describes a volume by name, mountpoint and driver", () => {
    const row = {
      hostId: "prod-a",
      usedBy: ["postgres-main"],
      Name: "pgdata",
      Driver: "local",
      Mountpoint: "/var/lib/docker/volumes/pgdata/_data",
    };
    expect(describeResourceRow("volumes", row)).toMatchObject({
      key: "pgdata",
      name: "pgdata",
      sub: "/var/lib/docker/volumes/pgdata/_data",
      right: "local",
      usedBy: ["postgres-main"],
    });
  });

  it("describes a network by name, IPAM subnets and driver", () => {
    const row = {
      hostId: "prod-a",
      usedBy: ["web-nginx", "web-app"],
      Id: "netid",
      Name: "bridge",
      Driver: "bridge",
      IPAM: { Driver: "default", Config: [{ Subnet: "172.17.0.0/16", Gateway: "172.17.0.1" }] },
    };
    expect(describeResourceRow("networks", row)).toMatchObject({
      key: "netid",
      name: "bridge",
      sub: "172.17.0.0/16",
      right: "bridge",
      usedBy: ["web-nginx", "web-app"],
    });
  });

  it("survives a network without IPAM config rather than throwing", () => {
    // `host` and `none` are exactly this shape on every real Docker host.
    const row = { hostId: "prod-a", usedBy: [], Id: "netid", Name: "host", Driver: "host" };
    expect(describeResourceRow("networks", row).sub).toBe("");
  });

  it("treats a row without usedBy as unused rather than crashing on it", () => {
    // The field is always sent by the current gateway, but a row that predates
    // it (or a failed usage lookup) must still render.
    const row = { hostId: "prod-a" } as unknown as Parameters<typeof describeResourceRow>[1];
    expect(describeResourceRow("volumes", row).usedBy).toEqual([]);
  });
});

describe("describeResourceRows", () => {
  it("sorts by display name, since the gateway's per-host fan-out order is arbitrary", () => {
    const rows = [
      { hostId: "prod-a", usedBy: [], Name: "web", Driver: "local", Mountpoint: "/m/web" },
      { hostId: "prod-a", usedBy: [], Name: "api", Driver: "local", Mountpoint: "/m/api" },
    ];
    expect(describeResourceRows("volumes", rows).map((r) => r.name)).toEqual(["api", "web"]);
  });
});

describe("resourceCreatedAt", () => {
  it("reads an image's unix-int Created", () => {
    expect(resourceCreatedAt({ hostId: "h", usedBy: [], Created: 1_700_000_000 })).toBe(1_700_000_000);
  });

  it("reads a volume's RFC3339 CreatedAt", () => {
    const at = resourceCreatedAt({ hostId: "h", usedBy: [], CreatedAt: "2026-05-02T09:14:00Z" });
    expect(at).toBe(Math.floor(Date.parse("2026-05-02T09:14:00Z") / 1000));
  });

  it("reads a network's RFC3339 Created — the same key as images, other type", () => {
    const at = resourceCreatedAt({ hostId: "h", usedBy: [], Created: "2026-05-02T09:14:00Z" });
    expect(at).toBe(Math.floor(Date.parse("2026-05-02T09:14:00Z") / 1000));
  });

  it("returns undefined for a missing or unparseable value", () => {
    expect(resourceCreatedAt({ hostId: "h", usedBy: [] })).toBeUndefined();
    expect(resourceCreatedAt({ hostId: "h", usedBy: [], Created: "not a date" })).toBeUndefined();
    expect(resourceCreatedAt({ hostId: "h", usedBy: [], Created: 0 })).toBeUndefined();
  });
});

describe("resourceAge", () => {
  const now = 1_800_000_000;
  const days = (n: number) => now - n * 86_400;

  it("buckets under a day as today", () => {
    expect(resourceAge(days(0), now)).toEqual({ unit: "today", value: 0 });
  });

  it("counts days up to two months", () => {
    expect(resourceAge(days(45), now)).toEqual({ unit: "days", value: 45 });
  });

  it("switches to months at 60 days and to years at 24 months", () => {
    expect(resourceAge(days(60), now)).toEqual({ unit: "months", value: 2 });
    expect(resourceAge(days(400), now)).toEqual({ unit: "months", value: 13 });
    expect(resourceAge(days(1000), now)).toEqual({ unit: "years", value: 2 });
  });

  it("clamps a future timestamp to today rather than reporting a negative age", () => {
    expect(resourceAge(now + 86_400, now)).toEqual({ unit: "today", value: 0 });
  });
});

describe("imageReclaimable", () => {
  it("subtracts the shared layers when Docker actually computed them", () => {
    expect(imageReclaimable({ hostId: "h", usedBy: [], Size: 1000, SharedSize: 400 })).toBe(600);
  });

  it("treats the -1 placeholder as 'not computed' and reports the full size", () => {
    // docker-py's images.list() never passes shared-size=1, so -1 is the norm.
    expect(imageReclaimable({ hostId: "h", usedBy: [], Size: 1000, SharedSize: -1 })).toBe(1000);
  });

  it("returns undefined without a size", () => {
    expect(imageReclaimable({ hostId: "h", usedBy: [] })).toBeUndefined();
  });
});

describe("imageDigest", () => {
  it("takes the digest half of the first RepoDigest", () => {
    const row = { hostId: "h", usedBy: [], RepoDigests: ["nginx@sha256:abc123"] };
    expect(imageDigest(row)).toBe("sha256:abc123");
  });

  it("is empty when the image has no digest — a locally built image has none", () => {
    expect(imageDigest({ hostId: "h", usedBy: [], RepoDigests: [] })).toBe("");
  });
});

describe("networkFlags / networkGateways", () => {
  it("lists only the flags that are actually set, in a stable order", () => {
    const row = { hostId: "h", usedBy: [], Internal: true, EnableIPv6: true, Attachable: false };
    expect(networkFlags(row)).toEqual(["internal", "ipv6"]);
  });

  it("reports no flags for a plain bridge network", () => {
    expect(networkFlags({ hostId: "h", usedBy: [], Internal: false })).toEqual([]);
  });

  it("pulls gateways out of IPAM.Config", () => {
    const row = {
      hostId: "h",
      usedBy: [],
      IPAM: { Config: [{ Subnet: "172.18.0.0/16", Gateway: "172.18.0.1" }] },
    };
    expect(networkGateways(row)).toEqual(["172.18.0.1"]);
  });
});

describe("resourceLabels / resourceComposeProject", () => {
  it("sorts labels by key and drops non-string values", () => {
    const row = { hostId: "h", usedBy: [], Labels: { zeta: "1", alpha: "2", broken: 3 } };
    expect(resourceLabels(row)).toEqual([
      { key: "alpha", value: "2" },
      { key: "zeta", value: "1" },
    ]);
  });

  it("finds the compose project, and is empty for an unmanaged resource", () => {
    const managed = { hostId: "h", usedBy: [], Labels: { "com.docker.compose.project": "webshop" } };
    expect(resourceComposeProject(managed)).toBe("webshop");
    expect(resourceComposeProject({ hostId: "h", usedBy: [] })).toBe("");
  });
});

describe("resourceLaneSummary", () => {
  it("counts the unused rows and the bytes their removal would free", () => {
    const rows = [
      { hostId: "h", usedBy: ["web"], Size: 500, SharedSize: -1 },
      { hostId: "h", usedBy: [], Size: 300, SharedSize: -1 },
      { hostId: "h", usedBy: [], Size: 200, SharedSize: 50 },
    ];
    expect(resourceLaneSummary("images", rows)).toEqual({ total: 3, unused: 2, reclaimable: 450 });
  });

  it("reports no reclaimable bytes for volumes — Docker does not size them here", () => {
    const rows = [
      { hostId: "h", usedBy: [], Name: "orphan" },
      { hostId: "h", usedBy: ["db"], Name: "pgdata" },
    ];
    expect(resourceLaneSummary("volumes", rows)).toEqual({ total: 2, unused: 1, reclaimable: 0 });
  });
});
