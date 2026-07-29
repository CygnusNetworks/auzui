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

// Dark mode first: default to dark unless the user chose otherwise.
const storedTheme = localStorage.getItem("auzui-theme");
const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
if (storedTheme === "dark" || (storedTheme === null && !prefersLight)) {
  document.documentElement.classList.add("dark");
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
