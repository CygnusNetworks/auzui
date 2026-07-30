import { handleGateway, handleJsonRpc } from "./handlers";

/**
 * Installs a `globalThis.fetch` shim for the public demo build (VITE_DEMO=1)
 * so every call to `/api_jsonrpc.php` (Zabbix JSON-RPC) or `/api/*` (the
 * optional gateway) is served from the in-memory mock data — no backend, no
 * service worker. Anything else (fonts, the app's own JS bundle, etc.) is
 * passed straight through to the real fetch.
 *
 * Must run BEFORE React mounts (see main.tsx). Adds a small simulated
 * latency so loading states are visible, and drops a dismissible banner so
 * visitors know it's sample data.
 */
export async function startDemo(): Promise<void> {
  const realFetch = globalThis.fetch.bind(globalThis);
  const LATENCY_MS = 120;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url, location.origin);

    if (url.pathname === "/api_jsonrpc.php") {
      await delay(LATENCY_MS);
      return handleJsonRpc(request);
    }
    if (url.pathname.startsWith("/api/")) {
      await delay(LATENCY_MS);
      return handleGateway(request, url.pathname);
    }
    return realFetch(input, init);
  }) as typeof fetch;

  addBanner();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addBanner(): void {
  const bar = document.createElement("div");
  bar.setAttribute("role", "note");
  bar.style.cssText =
    "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;" +
    "display:flex;gap:12px;align-items:center;max-width:calc(100vw - 24px);" +
    "background:#0e7490;color:#fff;padding:8px 14px;border-radius:999px;" +
    "font:500 13px/1.3 system-ui,-apple-system,'Segoe UI',sans-serif;" +
    "box-shadow:0 8px 24px -8px rgba(0,0,0,.5)";
  bar.innerHTML =
    '<span>\u{1F6C8} Demo &mdash; sample data, no backend. Nothing you do is saved.</span>' +
    '<button aria-label="Dismiss" style="all:unset;cursor:pointer;font-weight:700;padding:0 4px">×</button>';
  bar.querySelector("button")?.addEventListener("click", () => bar.remove());
  document.body.appendChild(bar);
}
