import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./routes/LoginPage";
import { validateProblemsSearch } from "./features/problems/search-params";
import { validateLatestDataSearch } from "./features/latest-data/search-params";
import { validateHostDetailSearch } from "./features/host-detail/search-params";
import { validateExplorerSearch } from "./features/explorer/search-params";
import { validateTopologySearch } from "./features/topology/search-params";
import { validateMetricsSearch } from "./features/metrics/search-params";
import { validateLogsSearch } from "./features/logs/search-params";
import { validateWebScenariosSearch } from "./features/web-scenarios/search-params";
import { validateDockerSearch } from "./features/docker/search-params";
import { useAuthStore } from "./lib/auth/store";

/**
 * Every page is a lazy chunk: the app's own code outweighs all of node_modules
 * put together, and nobody opens all eleven pages in one session — loading
 * uplot with the Problems list, or the topology canvas with the Docker view,
 * only slows the first paint down. `defaultPreload: "intent"` below fetches a
 * route's chunk as soon as the pointer touches its nav link, so the split
 * costs no perceptible latency on the actual click.
 *
 * `validateSearch` stays eager on purpose — the router needs it to match a URL
 * before it can decide which chunk to load, and those modules are tiny.
 */
const rootRoute = createRootRoute({
  component: Outlet,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  // Not lazy: it is the entry point for anyone without a session, so its chunk
  // would be on the critical path anyway.
  component: LoginPage,
  beforeLoad: () => {
    if (useAuthStore.getState().token) {
      throw redirect({ to: "/" });
    }
  },
});

/** Layout route: everything behind this requires a session token. */
const appLayoutRoute = createRoute({
  id: "_app",
  getParentRoute: () => rootRoute,
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  beforeLoad: () => {
    if (!useAuthStore.getState().token) {
      throw redirect({ to: "/login" });
    }
  },
});

const problemsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./features/problems/ProblemsPage"), "ProblemsPage"),
  validateSearch: validateProblemsSearch,
});

const hostsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/hosts",
  component: lazyRouteComponent(() => import("./features/hosts/HostsPage"), "HostsPage"),
});

const latestDataRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/latest-data",
  component: lazyRouteComponent(() => import("./features/latest-data/LatestDataPage"), "LatestDataPage"),
  validateSearch: validateLatestDataSearch,
});

const maintenanceRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/maintenance",
  component: lazyRouteComponent(() => import("./features/maintenance/MaintenancePage"), "MaintenancePage"),
});

const hostDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/hosts/$hostId",
  component: lazyRouteComponent(() => import("./features/host-detail/HostDetailPage"), "HostDetailPage"),
  validateSearch: validateHostDetailSearch,
});

const explorerRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/explorer",
  component: lazyRouteComponent(() => import("./features/explorer/ExplorerPage"), "ExplorerPage"),
  validateSearch: validateExplorerSearch,
});

const topologyRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/topology",
  component: lazyRouteComponent(() => import("./features/topology/TopologyPage"), "TopologyPage"),
  validateSearch: validateTopologySearch,
});

const metricsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/metrics",
  component: lazyRouteComponent(() => import("./features/metrics/MetricsPage"), "MetricsPage"),
  validateSearch: validateMetricsSearch,
});

const logsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/logs",
  component: lazyRouteComponent(() => import("./features/logs/LogsPage"), "LogsPage"),
  validateSearch: validateLogsSearch,
});

const webScenariosRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/web-scenarios",
  component: lazyRouteComponent(() => import("./features/web-scenarios/WebScenariosPage"), "WebScenariosPage"),
  validateSearch: validateWebScenariosSearch,
});

const dockerRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/docker",
  component: lazyRouteComponent(() => import("./features/docker/DockerPage"), "DockerPage"),
  validateSearch: validateDockerSearch,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([
    problemsRoute,
    hostsRoute,
    latestDataRoute,
    maintenanceRoute,
    hostDetailRoute,
    explorerRoute,
    topologyRoute,
    metricsRoute,
    logsRoute,
    webScenariosRoute,
    dockerRoute,
  ]),
]);

// basepath follows Vite's `base` so the app also works when served from a
// sub-path (e.g. the GitHub Pages demo under /auzui/demo/).
export const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
  // Hovering (or touch-starting) a link fetches that route's chunk before the
  // click lands — what makes the code split above invisible in normal use.
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
