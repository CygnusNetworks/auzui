import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./routes/LoginPage";
import { ComingSoon } from "./routes/ComingSoon";
import { ProblemsPage } from "./features/problems/ProblemsPage";
import { validateProblemsSearch } from "./features/problems/search-params";
import { MaintenancePage } from "./features/maintenance/MaintenancePage";
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
  component: () => <ComingSoon title="Hosts" />,
});

const latestDataRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/latest-data",
  component: () => <ComingSoon title="Latest Data" />,
});

const maintenanceRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/maintenance",
  component: MaintenancePage,
});

const hostDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/hosts/$hostId",
  component: () => <ComingSoon title="Host Deep-Dive" />,
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
