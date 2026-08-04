import { beforeAll, describe, expect, it } from "vitest";
import type { DockerContainer } from "@auzui/docker";

// StackPanel.tsx pulls in ContainerDetailPanel (for DOT_TONE_CLASS) -> uPlot,
// which touches `matchMedia` as a module-load side effect; jsdom doesn't
// implement it. These two helpers are pure and have nothing to do with
// charts, so rather than reaching into shared test-setup.ts for a chart
// concern, stub matchMedia locally and import the module dynamically
// (after the stub is in place) just for this file.
let firstConfigFile: typeof import("../StackPanel").firstConfigFile;
let psStatusByContainer: typeof import("../StackPanel").psStatusByContainer;

beforeAll(async () => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  ({ firstConfigFile, psStatusByContainer } = await import("../StackPanel"));
});

function mkContainer(overrides: Partial<DockerContainer> = {}): DockerContainer {
  return {
    id: "c1",
    hostId: "edge",
    name: "myapp-web-1",
    names: ["myapp-web-1"],
    image: "nginx",
    tag: "1.27",
    imageId: "sha256:abc",
    state: "running",
    status: "Up 2 hours",
    health: null,
    created: 1700000000,
    ports: [],
    project: "myapp",
    service: "web",
    composeWorkingDir: "/srv/myapp",
    labels: {},
    ...overrides,
  };
}

describe("firstConfigFile", () => {
  it("reads the config_files label off the first container that has it", () => {
    const containers = [
      mkContainer({ id: "c1", labels: {} }),
      mkContainer({
        id: "c2",
        labels: { "com.docker.compose.project.config_files": "/srv/myapp/docker-compose.yml" },
      }),
    ];
    expect(firstConfigFile(containers)).toBe("/srv/myapp/docker-compose.yml");
  });

  it("returns undefined when no container carries the label", () => {
    expect(firstConfigFile([mkContainer({ labels: {} })])).toBeUndefined();
  });

  it("returns undefined for an empty container list", () => {
    expect(firstConfigFile([])).toBeUndefined();
  });
});

describe("psStatusByContainer", () => {
  it("matches ps rows to containers by Name and returns their Status", () => {
    const containers = [mkContainer({ id: "c1", name: "myapp-web-1", names: ["myapp-web-1"] })];
    const ps = [{ Name: "myapp-web-1", Status: "Up 2 minutes (healthy)" }];
    expect(psStatusByContainer(containers, ps)).toEqual(new Map([["c1", "Up 2 minutes (healthy)"]]));
  });

  it("returns an empty map when ps is undefined", () => {
    expect(psStatusByContainer([mkContainer()], undefined)).toEqual(new Map());
  });

  it("skips rows without a usable Name or Status", () => {
    const containers = [mkContainer({ id: "c1", name: "myapp-web-1" })];
    const ps = [{ Name: "myapp-web-1" }, { Status: "Up" }, { Name: 42, Status: "Up" }];
    expect(psStatusByContainer(containers, ps)).toEqual(new Map());
  });

  it("skips rows that don't match any known container", () => {
    const containers = [mkContainer({ id: "c1", name: "myapp-web-1" })];
    const ps = [{ Name: "unrelated-container", Status: "Up" }];
    expect(psStatusByContainer(containers, ps)).toEqual(new Map());
  });
});
