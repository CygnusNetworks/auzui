import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./index.css";

const queryClient = new QueryClient({
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
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
