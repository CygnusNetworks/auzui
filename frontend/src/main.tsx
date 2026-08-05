import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { useAuthStore } from "./lib/auth/store";
import { isSessionError } from "./lib/auth/session-errors";
import { I18nProvider } from "./lib/i18n";
import "./index.css";

function handleQueryError(error: unknown) {
  if (isSessionError(error)) {
    useAuthStore.getState().handleSessionExpired();
  }
}

/**
 * A silent Kerberos re-auth (store.handleSessionExpired) swaps the token
 * without unmounting anything, so the queries that failed on the dead session
 * have to be told to try again — otherwise the user stares at error states
 * until the next poll interval.
 */
function watchSilentReauth(client: QueryClient) {
  useAuthStore.subscribe((state, prev) => {
    if (prev.reauthenticating && !state.reauthenticating && state.token) {
      void client.refetchQueries({ type: "active" });
    }
  });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleQueryError }),
  defaultOptions: {
    queries: {
      // Monitoring data: fresh-ish, refetch on focus, no aggressive retries
      // (a slow history.get must never block the whole view — PLAN.md).
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

watchSilentReauth(queryClient);

// Dark mode first: default to dark unless the user chose otherwise.
const storedTheme = localStorage.getItem("auzui-theme");
const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
if (storedTheme === "dark" || (storedTheme === null && !prefersLight)) {
  document.documentElement.classList.add("dark");
}

async function bootstrap() {
  // Public demo build only: install the fetch shim and auto-login before the
  // router's beforeLoad guards run, so a visitor lands straight in the app
  // instead of the login screen. Dynamic import + env guard keeps this whole
  // module (and its mock data) out of the normal production bundle.
  if (import.meta.env.VITE_DEMO === "1") {
    const [{ startDemo }, { DEMO_TOKEN, DEMO_USERNAME }] = await Promise.all([
      import("./demo/start"),
      import("./demo/mockData"),
    ]);
    await startDemo();
    useAuthStore.getState().loginWithSso(DEMO_TOKEN, DEMO_USERNAME);
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <RouterProvider router={router} />
        </I18nProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
