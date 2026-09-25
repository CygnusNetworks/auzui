import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { useAuthStore } from "./lib/auth/store";
import { queryClient } from "./lib/query-client";
import { I18nProvider } from "./lib/i18n";
import { initTheme } from "./lib/theme";
import "./index.css";

initTheme();

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
