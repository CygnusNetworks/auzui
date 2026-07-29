import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ThemeToggle } from "./ThemeToggle";
import { CommandPalette } from "../features/command-palette/CommandPalette";
import { useAuthStore } from "../lib/auth/store";
import { markSsoSuppressed } from "../lib/auth/sso";
import { useLogsEnabled } from "../lib/use-logs";
import { BUNDLE_VERSION, useAppConfig } from "../lib/use-app-config";

const navLinkClass =
  "rounded-md px-3 py-1.5 text-[12.5px] text-ink-2 [&.active]:bg-surface [&.active]:font-semibold [&.active]:text-ink [&.active]:shadow-sm";

const sheetLinkClass =
  "block py-2.5 text-[13px] text-ink-2 [&.active]:font-semibold [&.active]:text-ink";

interface NavLinkDef {
  to: string;
  label: string;
  show?: boolean;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const logout = useAuthStore((s) => s.logout);
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();
  const { data: config } = useAppConfig();
  const version = config?.version || BUNDLE_VERSION;
  const { data: logsEnabled } = useLogsEnabled();
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Close the mobile nav sheet on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const navLinks: NavLinkDef[] = [
    { to: "/", label: "Problems" },
    { to: "/hosts", label: "Hosts" },
    { to: "/explorer", label: "Explorer" },
    { to: "/topology", label: "Topologie" },
    { to: "/metrics", label: "Metrics" },
    { to: "/latest-data", label: "Latest Data" },
    { to: "/logs", label: "Logs", show: logsEnabled },
    { to: "/maintenance", label: "Maintenance" },
  ];

  return (
    <div className="min-h-screen bg-bg text-ink">
      <div ref={menuRef} className="sticky top-0 z-40 flex h-[52px] items-center gap-3.5 border-b border-line bg-surface px-4">
        <span className="font-mono text-base font-bold tracking-tight">
          au<em className="not-italic text-accent">z</em>ui
        </span>
        <nav className="ml-2 hidden gap-0.5 rounded-lg bg-surface-3 p-0.5 min-[900px]:flex">
          {navLinks.map(
            (link) =>
              link.show !== false && (
                <Link key={link.to} to={link.to} className={navLinkClass}>
                  {link.label}
                </Link>
              ),
          )}
        </nav>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="ml-2 flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12.5px] text-ink-2 min-[900px]:hidden"
        >
          ☰ Menü
        </button>
        <div className="flex-1" />
        <span
          className="hidden font-mono text-[10.5px] text-ink-muted min-[900px]:inline"
          title={config?.commit ? `Commit ${config.commit}` : undefined}
        >
          {version}
        </span>
        <button
          type="button"
          onClick={() => setCmdkOpen(true)}
          className="hidden items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12.5px] text-ink-muted min-[900px]:flex"
        >
          Suchen &amp; Aktionen…{" "}
          <kbd className="rounded border border-line bg-surface-3 px-1.5 font-mono text-[11px] text-ink-2">
            ⌘K
          </kbd>
        </button>
        <button
          type="button"
          onClick={() => setCmdkOpen(true)}
          aria-label="Suchen & Aktionen"
          className="flex items-center rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[13px] text-ink-muted min-[900px]:hidden"
        >
          🔍
        </button>
        <ThemeToggle />
        <button
          type="button"
          onClick={() => {
            markSsoSuppressed();
            logout();
          }}
          className="hidden rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12.5px] text-ink-2 min-[900px]:block"
        >
          Abmelden
        </button>

        {menuOpen && (
          <div className="absolute left-0 right-0 top-full z-40 border-b border-line bg-surface px-4 py-2 shadow-lg min-[900px]:hidden">
            {navLinks.map(
              (link) =>
                link.show !== false && (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={sheetLinkClass}
                    onClick={() => setMenuOpen(false)}
                  >
                    {link.label}
                  </Link>
                ),
            )}
            <div className="mt-1.5 flex items-center justify-between border-t border-line-soft pt-2.5">
              <span
                className="font-mono text-[10.5px] text-ink-muted"
                title={config?.commit ? `Commit ${config.commit}` : undefined}
              >
                {version}
              </span>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  markSsoSuppressed();
                  logout();
                }}
                className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12.5px] text-ink-2"
              >
                Abmelden
              </button>
            </div>
          </div>
        )}
      </div>
      {children}
      <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
    </div>
  );
}
