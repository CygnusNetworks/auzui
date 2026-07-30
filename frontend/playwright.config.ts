import { defineConfig, devices } from "@playwright/test";

/**
 * Screenshot generator run against the demo build (VITE_DEMO=1) — the fully
 * mocked backend in src/demo/ means no real Zabbix/gateway is required.
 * See e2e/screenshots.spec.ts for the actual generator (gated behind
 * SCREENSHOTS=1, not part of the normal test suite).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "VITE_DEMO=1 pnpm exec vite dev --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
