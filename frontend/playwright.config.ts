import { defineConfig, devices } from "@playwright/test";

/**
 * Screenshot generator run against the demo build (VITE_DEMO=1) — the fully
 * mocked backend in src/demo/ means no real Zabbix/gateway is required.
 * See e2e/screenshots.spec.ts for the actual generator (gated behind
 * SCREENSHOTS=1, not part of the normal test suite).
 */

/**
 * Deliberately NOT Vite's default preview port (4173): the generator writes
 * straight into ../docs/images, so pointing it at the wrong dev server does
 * not fail — it silently commits screenshots of somebody else's app. That
 * happened with a sibling project's server on 4173. Override via
 * AUZUI_E2E_PORT if this one is taken too.
 */
const PORT = Number(process.env.AUZUI_E2E_PORT ?? 43173);
const ORIGIN = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: ORIGIN,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // --strictPort: without it Vite quietly moves to the next free port while
    // `url` below keeps pointing at this one, so whatever already answers
    // there becomes the target.
    command: `VITE_DEMO=1 pnpm exec vite dev --host 127.0.0.1 --strictPort --port ${PORT}`,
    url: ORIGIN,
    // Never adopt a server this config did not start. Reuse would save a few
    // seconds locally and cost a wrong-app screenshot run; Playwright throws
    // instead when something is already listening, which is the useful outcome.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
