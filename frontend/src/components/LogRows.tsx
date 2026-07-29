import { useState } from "react";
import type { LogFilterField, LogMessage } from "@auzui/logs";
import { resolveFacilityName } from "../lib/log-facility";
import { logLevelBadgeClass, logLevelLabel } from "../lib/log-level";
import { formatLogTimestamp } from "../lib/log-timestamp";
import { useT } from "../lib/i18n";

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

type FilterMode = "include" | "exclude";
type OnFilter = (field: LogFilterField, value: string, mode: FilterMode) => void;

/**
 * Hostname/Facility/application_name sind auf Hover mit ＋/－-Buttons
 * versehen, die einen Include- bzw. Exclude-Filter setzen (PLAN.md Abschnitt
 * H, Nutzerwunsch "Filter direkt aus der Logzeile"). `onFilter` ist optional
 * — ohne ihn (z.B. im schlankeren Host-Detail-Panel) werden keine Buttons
 * gerendert.
 */
function FilterableField({
  value,
  field,
  onFilter,
  className,
}: {
  value: string;
  field: LogFilterField;
  onFilter: OnFilter | undefined;
  className: string;
}) {
  const t = useT();
  return (
    <span className="group/f inline-flex items-center gap-0.5">
      <span className={className}>{value}</span>
      {onFilter && (
        <span className="hidden items-center gap-0.5 group-hover/f:inline-flex">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFilter(field, value, "include");
            }}
            title={t("logs.include", value)}
            aria-label={t("logs.include", value)}
            className="rounded px-0.5 text-[11px] leading-none text-ink-muted hover:text-accent"
          >
            ＋
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFilter(field, value, "exclude");
            }}
            title={t("logs.exclude", value)}
            aria-label={t("logs.exclude", value)}
            className="rounded px-0.5 text-[11px] leading-none text-ink-muted hover:text-sev-high"
          >
            －
          </button>
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
}: {
  messages: LogMessage[];
  onFilter?: OnFilter;
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
                    className="truncate font-mono text-[11px] text-ink-2"
                  />
                  {facilityName && (
                    <FilterableField
                      value={facilityName}
                      field="facility"
                      onFilter={onFilter}
                      className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted"
                    />
                  )}
                  {appName && (
                    <FilterableField
                      value={appName}
                      field="application_name"
                      onFilter={onFilter}
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
