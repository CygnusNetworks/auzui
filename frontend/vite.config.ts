import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { configDefaults } from "vitest/config";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Zabbix JSON-RPC and the auzui-gateway during development.
      "/api_jsonrpc.php": {
        target: process.env.AUZUI_DEV_ZABBIX_URL ?? "https://zabbix-api.example.com",
        changeOrigin: true,
      },
      "/api": {
        target: process.env.AUZUI_DEV_GATEWAY_URL ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Playwright specs (e2e/) are a separate runner (playwright.config.ts), not vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
