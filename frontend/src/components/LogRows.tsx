import { useEffect, useRef, useState } from "react";
import type { LogFilterField, LogMessage } from "@auzui/logs";
import { resolveFacilityName } from "../lib/log-facility";
import { logLevelBadgeClass, logLevelLabel } from "../lib/log-level";
import { formatLogTimestamp } from "../lib/log-timestamp";
import type { LogFilterMode } from "../lib/log-filters";
import { useT, type Translate } from "../lib/i18n";

function applicationName(fields: Record<string, unknown>): string | undefined {
  const v = fields.application_name;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function fullMessage(msg: LogMessage): string | undefined {
  const v = msg.fields.full_message;
  return typeof v === "string" && v.length > 0 && v !== msg.message ? v : undefined;
}

/** Stable identity for React's list key — falls back to a content-derived key for rows the gateway didn't tag (older cached data). */
function rowKey(msg: LogMessage, index: number): string {
  return msg.id ?? `${msg.timestamp}-${msg.source}-${index}`;
}

type OnFilter = (field: LogFilterField, value: string, mode: LogFilterMode) => void;
/** Liefert den aktiven Filtermodus für ein `field:value` (oder undefined). */
type ActiveModeFor = (field: LogFilterField, value: string) => LogFilterMode | undefined;

/**
 * Die beiden beschrifteten Aktions-Buttons „＋ Nur anzeigen" (accent) und
 * „－ Ausblenden" (sev-high). Wird sowohl im Hover-Streifen (Desktop) als auch
 * im Touch-Popover verwendet, damit Beschriftung/Farbe/Tooltip identisch sind.
 * Der jeweils aktive Modus wird gefüllt dargestellt (aria-pressed) — ein Klick
 * darauf entfernt den Filter wieder (Toggle, siehe toggleFilter).
 */
function FilterActionButtons({
  t,
  value,
  activeMode,
  onPick,
  size,
}: {
  t: Translate;
  value: string;
  activeMode: LogFilterMode | undefined;
  onPick: (mode: LogFilterMode) => void;
  size: "compact" | "full";
}) {
  const pad = size === "full" ? "px-2 py-1" : "px-1 py-0.5";
  const incActive = activeMode === "include";
  const excActive = activeMode === "exclude";
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPick("include");
        }}
        title={t("logs.include", value)}
        aria-label={t("logs.include", value)}
        aria-pressed={incActive}
        className={`inline-flex items-center gap-1 rounded font-mono text-[10.5px] leading-none ${pad} ${
          incActive
            ? "bg-accent text-white"
            : "text-accent hover:bg-accent-soft"
        }`}
      >
        <span aria-hidden>＋</span>
        {t("logs.includeAction")}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPick("exclude");
        }}
        title={t("logs.exclude", value)}
        aria-label={t("logs.exclude", value)}
        aria-pressed={excActive}
        className={`inline-flex items-center gap-1 rounded font-mono text-[10.5px] leading-none ${pad} ${
          excActive
            ? "bg-sev-high text-white"
            : "text-sev-high hover:bg-sev-high/15"
        }`}
      >
        <span aria-hidden>－</span>
        {t("logs.excludeAction")}
      </button>
    </>
  );
}

/**
 * Hostname/Facility/application_name sind klickbare Filterwerte (PLAN.md
 * Abschnitt H + PLAN Aufgabe 1). Damit klar ist, dass ＋/－ „einschließen" bzw.
 * „ausblenden" bedeutet:
 *
 * - Auf Hover-Geräten erscheinen neben dem Wert zwei beschriftete Buttons
 *   „＋ Nur anzeigen" (accent) / „－ Ausblenden" (rot) mit Tooltip.
 * - Auf Touch-Geräten (kein Hover) öffnet ein Klick auf den Wert ein kleines
 *   Popover mit denselben Aktionen plus Anzeige des Werts.
 * - Ein bereits gesetzter Filter färbt den Wert selbst grün (include) bzw. rot
 *   (exclude), sodass aktive Filter direkt in der Zeile sichtbar sind.
 *
 * `onFilter` ist optional — ohne ihn (z.B. im schlankeren Host-Detail-Panel)
 * wird der Wert als reiner Text gerendert.
 */
function FilterableField({
  value,
  field,
  onFilter,
  activeModeFor,
  className,
}: {
  value: string;
  field: LogFilterField;
  onFilter: OnFilter | undefined;
  activeModeFor: ActiveModeFor | undefined;
  className: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const activeMode = activeModeFor?.(field, value);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  if (!onFilter) {
    return <span className={className}>{value}</span>;
  }

  const activeCls =
    activeMode === "include"
      ? "!bg-accent-soft !text-accent px-1 ring-1 ring-inset ring-accent/40"
      : activeMode === "exclude"
        ? "!bg-sev-high/15 !text-sev-high px-1 ring-1 ring-inset ring-sev-high/40"
        : "";

  function pick(mode: LogFilterMode) {
    setOpen(false);
    onFilter?.(field, value, mode);
  }

  return (
    <span ref={wrapRef} className="group/f relative inline-flex items-center gap-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title={activeMode ? undefined : t("logs.filterActions", value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`cursor-pointer rounded ${className} ${activeCls}`}
      >
        {value}
      </button>
      {/* Desktop: beschrifteter Aktions-Streifen nur auf Hover-Geräten. */}
      <span className="hidden items-center gap-1 [@media(hover:hover)]:group-hover/f:inline-flex">
        <FilterActionButtons t={t} value={value} activeMode={activeMode} onPick={pick} size="compact" />
      </span>
      {/* Touch/Klick: Popover mit Wert-Anzeige + Aktionen. */}
      {open && (
        <span
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 flex flex-col gap-1 rounded-md border border-line bg-surface p-1.5 shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="max-w-[220px] truncate px-1 pb-0.5 font-mono text-[10px] text-ink-muted">
            {value}
          </span>
          <span className="flex items-center gap-1">
            <FilterActionButtons t={t} value={value} activeMode={activeMode} onPick={pick} size="full" />
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * Dichte Log-Zeilenliste mit Expand (Zeit · Level · Application · Message,
 * Klick öffnet Fulltext + Fields) — extrahiert aus
 * features/host-detail/LogsPanel.tsx (PLAN.md Abschnitt H), damit der
 * Stream-Browser (/logs) und das Host-Panel dieselbe Zeilendarstellung
 * teilen.
 *
 * Die Message-Zeile wird NICHT mehr einzeilig abgeschnitten (Nutzerbeschwerde:
 * "Logzeile wird nicht komplett dargestellt") — im Ruhezustand ein
 * `line-clamp-2`-Vorschau-Block, expandiert der volle Text plus ggf.
 * `fields.full_message` in einem eigenen Block.
 *
 * Der Zeilen-Wrapper ist bewusst ein `<div role="button">` statt ein
 * `<button>`: die Include/Exclude-Icons sind echte, eigenständig klickbare
 * `<button>`s (stopPropagation gegen das Expand/Collapse) — verschachtelte
 * `<button>`-Elemente sind ungültiges HTML und lassen Klicks unvorhersehbar
 * bubblen.
 *
 * Jede Zeile trägt `animate-log-row-in` (siehe index.css): eine reine
 * CSS-Mount-Animation, die nur beim ersten Rendern eines DOM-Knotens
 * abspielt — solange die Keys stabil sind (msg.id statt Array-Index), bleibt
 * eine bereits angezeigte Zeile beim Live-Nachladen unangetastet und nur
 * echte Neuzugänge blenden sanft ein, kein Flackern der ganzen Liste.
 */
export function LogRows({
  messages,
  onFilter,
  activeModeFor,
}: {
  messages: LogMessage[];
  onFilter?: OnFilter;
  /** Markiert Werte, auf die bereits ein Include/Exclude gesetzt ist. */
  activeModeFor?: ActiveModeFor;
}) {
  const [expanded, setExpanded] = useState<string | undefined>(undefined);

  return (
    <div className="divide-y divide-line-soft">
      {messages.map((msg, i) => {
        const key = rowKey(msg, i);
        const isOpen = expanded === key;
        const appName = applicationName(msg.fields);
        const facilityName = resolveFacilityName(msg.facilityNum, msg.facility);
        const full = fullMessage(msg);
        return (
          <div key={key} className="animate-log-row-in">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setExpanded(isOpen ? undefined : key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded(isOpen ? undefined : key);
                }
              }}
              className="grid w-full cursor-pointer grid-cols-[130px_64px_1fr] items-start gap-2 px-3.5 py-1.5 text-left text-[12px] hover:bg-surface-2"
            >
              <span className="pt-0.5 font-mono text-[11px] text-ink-muted">
                {formatLogTimestamp(msg.timestamp)}
              </span>
              <span
                className={`inline-flex h-fit items-center justify-center rounded border px-1 py-px font-mono text-[9.5px] font-semibold uppercase ${logLevelBadgeClass(msg.level)}`}
              >
                {logLevelLabel(msg.level)}
              </span>
              <span className="min-w-0">
                <span className="mb-0.5 flex flex-wrap items-center gap-1.5">
                  <FilterableField
                    value={msg.source}
                    field="source"
                    onFilter={onFilter}
                    activeModeFor={activeModeFor}
                    className="truncate font-mono text-[11px] text-ink-2"
                  />
                  {facilityName && (
                    <FilterableField
                      value={facilityName}
                      field="facility"
                      onFilter={onFilter}
                      activeModeFor={activeModeFor}
                      className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted"
                    />
                  )}
                  {appName && (
                    <FilterableField
                      value={appName}
                      field="application_name"
                      onFilter={onFilter}
                      activeModeFor={activeModeFor}
                      className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted"
                    />
                  )}
                </span>
                <span
                  className={`block whitespace-pre-wrap break-words font-mono text-[11.5px] text-ink ${
                    isOpen ? "" : "line-clamp-2"
                  }`}
                >
                  {msg.message}
                </span>
              </span>
            </div>
            {isOpen && (
              <div className="border-t border-line-soft bg-surface-2 px-3.5 py-2.5 text-[12px]">
                <div className="mb-2 whitespace-pre-wrap break-words font-mono text-[11.5px]">
                  {msg.message}
                </div>
                {full && (
                  <div className="mb-2">
                    <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                      full_message
                    </div>
                    <div className="whitespace-pre-wrap break-words rounded border border-line-soft bg-surface p-2 font-mono text-[11.5px]">
                      {full}
                    </div>
                  </div>
                )}
                {Object.keys(msg.fields).length > 0 && (
                  <div className="grid grid-cols-[minmax(0,160px)_1fr] gap-x-3 gap-y-1 font-mono text-[11px] text-ink-2">
                    {Object.entries(msg.fields).map(([key, value]) => (
                      <span key={key} className="contents">
                        <span className="truncate text-ink-muted">{key}</span>
                        <span className="truncate">{String(value)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
