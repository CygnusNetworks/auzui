import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./routes/LoginPage";
import { ProblemsPage } from "./features/problems/ProblemsPage";
import { validateProblemsSearch } from "./features/problems/search-params";
import { MaintenancePage } from "./features/maintenance/MaintenancePage";
import { HostsPage } from "./features/hosts/HostsPage";
import { LatestDataPage } from "./features/latest-data/LatestDataPage";
import { validateLatestDataSearch } from "./features/latest-data/search-params";
import { HostDetailPage } from "./features/host-detail/HostDetailPage";
import { validateHostDetailSearch } from "./features/host-detail/search-params";
import { ExplorerPage } from "./features/explorer/ExplorerPage";
import { validateExplorerSearch } from "./features/explorer/search-params";
import { TopologyPage } from "./features/topology/TopologyPage";
import { validateTopologySearch } from "./features/topology/search-params";
import { MetricsPage } from "./features/metrics/MetricsPage";
import { validateMetricsSearch } from "./features/metrics/search-params";
import { LogsPage } from "./features/logs/LogsPage";
import { validateLogsSearch } from "./features/logs/search-params";
import { WebScenariosPage } from "./features/web-scenarios/WebScenariosPage";
import { validateWebScenariosSearch } from "./features/web-scenarios/search-params";
import { DockerPage } from "./features/docker/DockerPage";
import { validateDockerSearch } from "./features/docker/search-params";
import { useAuthStore } from "./lib/auth/store";

const rootRoute = createRootRoute({
  component: Outlet,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
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
  component: ProblemsPage,
  validateSearch: validateProblemsSearch,
});

const hostsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/hosts",
  component: HostsPage,
});

const latestDataRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/latest-data",
  component: LatestDataPage,
  validateSearch: validateLatestDataSearch,
});

const maintenanceRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/maintenance",
  component: MaintenancePage,
});

const hostDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/hosts/$hostId",
  component: HostDetailPage,
  validateSearch: validateHostDetailSearch,
});

const explorerRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/explorer",
  component: ExplorerPage,
  validateSearch: validateExplorerSearch,
});

const topologyRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/topology",
  component: TopologyPage,
  validateSearch: validateTopologySearch,
});

const metricsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/metrics",
  component: MetricsPage,
  validateSearch: validateMetricsSearch,
});

const logsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/logs",
  component: LogsPage,
  validateSearch: validateLogsSearch,
});

const webScenariosRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/web-scenarios",
  component: WebScenariosPage,
  validateSearch: validateWebScenariosSearch,
});

const dockerRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/docker",
  component: DockerPage,
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
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
