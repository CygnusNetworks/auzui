/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
  },
});
