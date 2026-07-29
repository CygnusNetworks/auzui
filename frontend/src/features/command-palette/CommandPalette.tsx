import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import { matchesHostSearch } from "../../lib/hosts";
import { useLogsEnabled } from "../../lib/use-logs";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { useT, type Translate } from "../../lib/i18n";

/** Cap on rendered host rows — the underlying search still covers every host, this just keeps the dropdown scannable. */
const MAX_HOST_RESULTS = 20;

interface NavAction {
  to: string;
  label: string;
  show?: boolean;
}

/** Mirrors AppShell's navLinks — kept here so the palette can search+jump to them ("Aktionen"). */
function useNavActions(t: Translate): NavAction[] {
  const { data: logsEnabled } = useLogsEnabled();
  return [
    { to: "/", label: t("appShell.nav.problems") },
    { to: "/hosts", label: t("appShell.nav.hosts") },
    { to: "/explorer", label: t("appShell.nav.explorer") },
    { to: "/topology", label: t("appShell.nav.topology") },
    { to: "/metrics", label: t("appShell.nav.metrics") },
    { to: "/latest-data", label: t("appShell.nav.latestData") },
    { to: "/logs", label: t("appShell.nav.logs"), show: logsEnabled },
    { to: "/maintenance", label: t("appShell.nav.maintenance") },
  ];
}

/** true if `text` starts with `query` (case-insensitive) — used to rank exact-prefix hits first. */
function isPrefixMatch(text: string, query: string): boolean {
  return text.toLowerCase().startsWith(query);
}

type PaletteItem =
  | { kind: "action"; action: NavAction }
  | { kind: "host"; host: { hostid: string; host: string; name: string } };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const navActions = useNavActions(t);

  // Debounced so a fast typist doesn't re-run the fuzzy filter on every keystroke.
  const debouncedQuery = useDebouncedValue(query, 120);
  const q = debouncedQuery.trim().toLowerCase();

  // All hosts are loaded once (hostid/host/name only) and filtered client-side —
  // more robust than pushing `query` into host.get's `search` param, which Zabbix
  // ANDs across fields (host AND name both need to contain the substring), so a
  // hit on the visible name but not the technical host field silently vanished.
  // A one-off full load also lets us rank + search everything instead of only
  // whatever the server's default ordering put in the first `limit` rows.
  const hostsQuery = useQuery({
    queryKey: ["cmdk-hosts-all"],
    queryFn: () =>
      zabbixApi.hostGet({
        output: ["hostid", "host", "name"],
        sortfield: "name",
      }),
    enabled: open,
    staleTime: 60_000,
  });

  const allHosts = useMemo(() => hostsQuery.data ?? [], [hostsQuery.data]);

  const filteredActions = useMemo(() => {
    const visible = navActions.filter((a) => a.show !== false);
    const matched = q
      ? visible.filter((a) => a.label.toLowerCase().includes(q))
      : visible;
    return [...matched].sort((a, b) => {
      const pa = isPrefixMatch(a.label, q) ? 0 : 1;
      const pb = isPrefixMatch(b.label, q) ? 0 : 1;
      return pa - pb;
    });
  }, [navActions, q]);

  const filteredHosts = useMemo(() => {
    const matched = q ? allHosts.filter((h) => matchesHostSearch(h, q)) : allHosts;
    const ranked = [...matched].sort((a, b) => {
      const pa = isPrefixMatch(a.name || a.host, q) || isPrefixMatch(a.host, q) ? 0 : 1;
      const pb = isPrefixMatch(b.name || b.host, q) || isPrefixMatch(b.host, q) ? 0 : 1;
      return pa - pb;
    });
    return ranked.slice(0, MAX_HOST_RESULTS);
  }, [allHosts, q]);

  const items: PaletteItem[] = useMemo(
    () => [
      ...filteredActions.map((action): PaletteItem => ({ kind: "action", action })),
      ...filteredHosts.map((host): PaletteItem => ({ kind: "host", host })),
    ],
    [filteredActions, filteredHosts],
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [q]);

  function selectItem(item: PaletteItem | undefined) {
    if (!item) return;
    if (item.kind === "action") {
      void navigate({ to: item.action.to });
    } else {
      void navigate({ to: "/", search: (prev) => ({ ...prev, host: item.host.host }) });
    }
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        selectItem(items[selected]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, items, selected, navigate, onClose]);

  if (!open) return null;

  let rowIndex = 0;

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-label={t("commandPalette.aria")}>
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="absolute left-1/2 top-[12vh] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("commandPalette.placeholder")}
          className="w-full border-b border-line-soft bg-transparent px-4 py-3.5 text-[15px] text-ink outline-none"
        />
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {filteredActions.length > 0 && (
            <>
              <div className="px-4 pb-0.5 pt-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                {t("commandPalette.actions")}
              </div>
              {filteredActions.map((action) => {
                const i = rowIndex++;
                return (
                  <button
                    key={action.to}
                    type="button"
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => selectItem(items[i])}
                    className={`flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-[13px] ${
                      i === selected ? "bg-accent-soft" : ""
                    }`}
                  >
                    <span>→</span>
                    <b>{action.label}</b>
                    <span className="ml-auto font-mono text-[10.5px] text-ink-muted">
                      {t("commandPalette.open")}
                    </span>
                  </button>
                );
              })}
            </>
          )}
          <div className="px-4 pb-0.5 pt-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
            {t("commandPalette.hosts")}
          </div>
          {filteredHosts.length === 0 && (
            <div className="px-4 py-3 text-sm text-ink-2">
              {hostsQuery.isLoading ? t("commandPalette.searching") : t("commandPalette.noHosts")}
            </div>
          )}
          {filteredHosts.map((h) => {
            const i = rowIndex++;
            return (
              <button
                key={h.hostid}
                type="button"
                onMouseEnter={() => setSelected(i)}
                onClick={() => selectItem(items[i])}
                className={`flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-[13px] ${
                  i === selected ? "bg-accent-soft" : ""
                }`}
              >
                <span>⌦</span>
                <b>{h.name || h.host}</b>
                {h.name && h.name !== h.host && (
                  <span className="font-mono text-[10px] text-ink-muted">{h.host}</span>
                )}
                <span className="ml-auto font-mono text-[10.5px] text-ink-muted">
                  {t("commandPalette.openProblems")}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-3.5 border-t border-line-soft px-4 py-2 text-[11px] text-ink-muted">
          <span>{t("commandPalette.navigate")}</span>
          <span>{t("commandPalette.open")}</span>
          <span>{t("commandPalette.close")}</span>
        </div>
      </div>
    </div>
  );
}
