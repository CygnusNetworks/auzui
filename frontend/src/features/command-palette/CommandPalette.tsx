import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const hostsQuery = useQuery({
    queryKey: ["cmdk-hosts", query],
    queryFn: () =>
      zabbixApi.hostGet({
        output: ["hostid", "host", "name"],
        search: query ? { host: query, name: query } : undefined,
        searchWildcardsEnabled: true,
        limit: 8,
      }),
    enabled: open,
    staleTime: 30_000,
  });

  const hosts = hostsQuery.data ?? [];

  useEffect(() => {
    if (open) {
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, hosts.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        const host = hosts[selected];
        if (host) {
          void navigate({ to: "/", search: (prev) => ({ ...prev, host: host.host }) });
          onClose();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, hosts, selected, navigate, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-label="Command Palette">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="absolute left-1/2 top-[12vh] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Host suchen…"
          className="w-full border-b border-line-soft bg-transparent px-4 py-3.5 text-[15px] text-ink outline-none"
        />
        <div className="max-h-[50vh] overflow-y-auto py-1">
          <div className="px-4 pb-0.5 pt-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
            Hosts
          </div>
          {hosts.length === 0 && (
            <div className="px-4 py-3 text-sm text-ink-2">
              {hostsQuery.isLoading ? "Suche…" : "Keine Hosts gefunden"}
            </div>
          )}
          {hosts.map((h, i) => (
            <button
              key={h.hostid}
              type="button"
              onMouseEnter={() => setSelected(i)}
              onClick={() => {
                void navigate({ to: "/", search: (prev) => ({ ...prev, host: h.host }) });
                onClose();
              }}
              className={`flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-[13px] ${
                i === selected ? "bg-accent-soft" : ""
              }`}
            >
              <span>⌦</span>
              <b>{h.name || h.host}</b>
              {h.name && h.name !== h.host && (
                <span className="font-mono text-[10px] text-ink-muted">{h.host}</span>
              )}
              <span className="ml-auto font-mono text-[10.5px] text-ink-muted">↵ Probleme</span>
            </button>
          ))}
        </div>
        <div className="flex gap-3.5 border-t border-line-soft px-4 py-2 text-[11px] text-ink-muted">
          <span>↑↓ navigieren</span>
          <span>↵ öffnen</span>
          <span>esc schließen</span>
        </div>
      </div>
    </div>
  );
}
