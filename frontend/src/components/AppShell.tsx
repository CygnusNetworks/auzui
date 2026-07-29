import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ThemeToggle } from "./ThemeToggle";
import { CommandPalette } from "../features/command-palette/CommandPalette";
import { useAuthStore } from "../lib/auth/store";
import { markSsoSuppressed } from "../lib/auth/sso";
import { BUNDLE_VERSION, useAppConfig } from "../lib/use-app-config";

const navLinkClass =
  "rounded-md px-3 py-1.5 text-[12.5px] text-ink-2 [&.active]:bg-surface [&.active]:font-semibold [&.active]:text-ink [&.active]:shadow-sm";

export function AppShell({ children }: { children: ReactNode }) {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const logout = useAuthStore((s) => s.logout);
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();
  const { data: config } = useAppConfig();
  const version = config?.version || BUNDLE_VERSION;

  // Reactive guard: a query/mutation can clear the token mid-session (401 /
  // expired session, see lib/auth/session-errors.ts) without a navigation —
  // beforeLoad only runs on route transitions, so watch the store directly.
  useEffect(() => {
    if (!token) void navigate({ to: "/login" });
  }, [token, navigate]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="sticky top-0 z-40 flex h-[52px] items-center gap-3.5 border-b border-line bg-surface px-4">
        <span className="font-mono text-base font-bold tracking-tight">
          au<em className="not-italic text-accent">z</em>ui
        </span>
        <nav className="ml-2 flex gap-0.5 rounded-lg bg-surface-3 p-0.5">
          <Link to="/" className={navLinkClass}>
            Problems
          </Link>
          <Link to="/hosts" className={navLinkClass}>
            Hosts
          </Link>
          <Link to="/latest-data" className={navLinkClass}>
            Latest Data
          </Link>
          <Link to="/maintenance" className={navLinkClass}>
            Maintenance
          </Link>
        </nav>
        <div className="flex-1" />
        <span
          className="font-mono text-[10.5px] text-ink-muted"
          title={config?.commit ? `Commit ${config.commit}` : undefined}
        >
          {version}
        </span>
        <button
          type="button"
          onClick={() => setCmdkOpen(true)}
          className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12.5px] text-ink-muted"
        >
          Suchen &amp; Aktionen…{" "}
          <kbd className="rounded border border-line bg-surface-3 px-1.5 font-mono text-[11px] text-ink-2">
            ⌘K
          </kbd>
        </button>
        <ThemeToggle />
        <button
          type="button"
          onClick={() => {
            markSsoSuppressed();
            logout();
          }}
          className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12.5px] text-ink-2"
        >
          Abmelden
        </button>
      </div>
      {children}
      <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
    </div>
  );
}
