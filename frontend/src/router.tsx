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

const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([
    problemsRoute,
    hostsRoute,
    latestDataRoute,
    maintenanceRoute,
    hostDetailRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
