import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LogFilterSet, LogSource } from "@auzui/logs";
import { useT } from "../../lib/i18n";
import type { CurrentFilters } from "./filter-set-mapping";
import { currentToPayload, payloadsEqual } from "./filter-set-mapping";

/**
 * Werkzeugleisten-Steuerung für gespeicherte Filter-Sets (PLAN Aufgabe 1):
 * Dropdown "Filter-Set: <Name> ▾" mit Sektionen "Meine Sets" / "Geteilt
 * (Team)", Speichern-Dialog und — bei aktivem, geändertem Set — dezente
 * Aktionen "Set aktualisieren" (nur Autor) / "als neues Set speichern".
 */
export function FilterSetControls({
  source,
  filterSets,
  activeSetId,
  current,
  username,
  onApply,
  onClearActive,
  onActivate,
}: {
  source: LogSource;
  filterSets: LogFilterSet[];
  activeSetId: string | undefined;
  current: CurrentFilters;
  username: string | null;
  /** Load a set's filters into the URL + level. */
  onApply: (set: LogFilterSet) => void;
  /** Drop the active-set marker (filters stay). */
  onClearActive: () => void;
  /** Mark a (freshly created/updated) set as active. */
  onActivate: (setId: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const activeSet = filterSets.find((s) => s.id === activeSetId);
  const mine = filterSets.filter((s) => s.owner === username);
  const shared = filterSets.filter((s) => s.owner !== username && s.shared);

  const currentPayload = useMemo(() => currentToPayload(current), [current]);
  const isModified = activeSet ? !payloadsEqual(activeSet.filters, currentPayload) : false;
  const isOwner = activeSet ? activeSet.owner === username : false;

  useEffect(() => {
    if (!menuOpen) return;
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [menuOpen]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["log-filter-sets"] });

  const createMut = useMutation({
    mutationFn: (input: { name: string; shared: boolean }) =>
      source.createFilterSet({ name: input.name, shared: input.shared, filters: currentPayload }),
    onSuccess: async (set) => {
      await invalidate();
      onActivate(set.id);
      setDialogOpen(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: () =>
      source.updateFilterSet(activeSet!.id, {
        name: activeSet!.name,
        shared: activeSet!.shared,
        filters: currentPayload,
      }),
    onSuccess: () => invalidate(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => source.deleteFilterSet(id),
    onSuccess: async (_data, id) => {
      await invalidate();
      if (id === activeSetId) onClearActive();
    },
  });

  return (
    <div ref={wrapRef} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink hover:bg-surface-3"
      >
        <span className="text-ink-muted">{t("logs.filterSet")}:</span>
        <span className="font-semibold">{activeSet ? activeSet.name : t("logs.noSet")}</span>
        <span aria-hidden className="text-ink-muted">
          ▾
        </span>
      </button>

      {activeSet && isModified && (
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted">
          <span className="italic">{t("logs.modified")}</span>
          {isOwner && (
            <button
              type="button"
              onClick={() => updateMut.mutate()}
              disabled={updateMut.isPending}
              className="rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px] hover:bg-surface-2 disabled:opacity-50"
            >
              {t("logs.updateSet")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px] hover:bg-surface-2"
          >
            {t("logs.saveAsNew")}
          </button>
        </span>
      )}

      {menuOpen && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 w-72 rounded-md border border-line bg-surface py-1 shadow-md"
        >
          <MenuSection label={t("logs.mySets")}>
            {mine.length === 0 && <MenuEmpty label={t("logs.noSets")} />}
            {mine.map((s) => (
              <SetRow
                key={s.id}
                set={s}
                active={s.id === activeSetId}
                deletable
                onPick={() => {
                  onApply(s);
                  setMenuOpen(false);
                }}
                onDelete={() => deleteMut.mutate(s.id)}
              />
            ))}
          </MenuSection>
          {shared.length > 0 && (
            <MenuSection label={t("logs.sharedSets")}>
              {shared.map((s) => (
                <SetRow
                  key={s.id}
                  set={s}
                  active={s.id === activeSetId}
                  showOwner
                  onPick={() => {
                    onApply(s);
                    setMenuOpen(false);
                  }}
                />
              ))}
            </MenuSection>
          )}
          <div className="mt-1 border-t border-line-soft pt-1">
            <button
              type="button"
              onClick={() => {
                setDialogOpen(true);
                setMenuOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-accent hover:bg-surface-2"
            >
              {t("logs.saveAsSet")}
            </button>
          </div>
        </div>
      )}

      {dialogOpen && (
        <SaveDialog
          onCancel={() => setDialogOpen(false)}
          onSave={(name, shared) => createMut.mutate({ name, shared })}
          pending={createMut.isPending}
          error={createMut.isError}
        />
      )}
    </div>
  );
}

function MenuSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

function MenuEmpty({ label }: { label: string }) {
  return <div className="px-3 py-1.5 text-[12px] text-ink-muted">{label}</div>;
}

function SetRow({
  set,
  active,
  deletable = false,
  showOwner = false,
  onPick,
  onDelete,
}: {
  set: LogFilterSet;
  active: boolean;
  deletable?: boolean;
  showOwner?: boolean;
  onPick: () => void;
  onDelete?: () => void;
}) {
  const t = useT();
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 hover:bg-surface-2 ${
        active ? "bg-surface-2" : ""
      }`}
    >
      <button type="button" onClick={onPick} className="flex-1 truncate text-left text-[12px]">
        <span className={active ? "font-semibold text-ink" : "text-ink-2"}>{set.name}</span>
        {showOwner && (
          <span className="ml-1.5 font-mono text-[10px] text-ink-muted">{set.owner}</span>
        )}
      </button>
      {deletable && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("logs.deleteSet", set.name)}
          className="text-ink-muted hover:text-sev-high"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function SaveDialog({
  onCancel,
  onSave,
  pending,
  error,
}: {
  onCancel: () => void;
  onSave: (name: string, shared: boolean) => void;
  pending: boolean;
  error: boolean;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      onMouseDown={onCancel}
    >
      <div
        className="w-80 rounded-lg border border-line bg-surface p-4 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-[14px] font-bold">{t("logs.saveDialogTitle")}</h2>
        <label className="mb-1 block text-[11.5px] text-ink-2">{t("logs.nameLabel")}</label>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("logs.namePlaceholder")}
          className="mb-3 w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink"
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onSave(name.trim(), shared);
          }}
        />
        <label className="mb-3 flex items-center gap-2 text-[12px] text-ink-2">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          {t("logs.shareWithTeam")}
        </label>
        {error && <div className="mb-2 text-[11.5px] text-sev-high">{t("logs.saveError")}</div>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line px-3 py-1 text-[12px] text-ink-2 hover:bg-surface-2"
          >
            {t("logs.cancel")}
          </button>
          <button
            type="button"
            disabled={!name.trim() || pending}
            onClick={() => onSave(name.trim(), shared)}
            className="rounded-md bg-accent px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {t("logs.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
