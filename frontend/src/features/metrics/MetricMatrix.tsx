import { useEffect, useRef, useState } from "react";
import { resolveSeriesColor } from "../../lib/series-colors";
import { useT } from "../../lib/i18n";
import { useHostSuggestions } from "./use-metrics";
import type { MatrixRow, MetricMatrix as MetricMatrixData } from "./matrix";

/** Re-render on the ThemeToggle's `.dark` class flip so resolved series colors follow the theme. */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((n) => n + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return version;
}

/**
 * Host-Spalten-Matrix (Vorschlag C). Zeilen = eindeutige Metriken, Spalten =
 * Hosts. Zelle = Toggle (role="checkbox"); aktiv = in der Serienfarbe gefüllt.
 * Fehlt die Metrik auf einem Host → gestrichelte, disabled Zelle. Zeilenkopf
 * toggelt die ganze Metrik, Spaltenkopf den ganzen Host.
 */
export function MetricMatrix({
  matrix,
  selectedIds,
  colorIndexById,
  onToggleCell,
  onToggleRow,
  onToggleColumn,
  onAddHost,
  addHostBusy,
}: {
  matrix: MetricMatrixData;
  selectedIds: Set<string>;
  colorIndexById: Map<string, number>;
  onToggleCell: (itemid: string) => void;
  onToggleRow: (row: MatrixRow) => void;
  onToggleColumn: (columnIndex: number) => void;
  onAddHost: (hostid: string) => void;
  addHostBusy: boolean;
}) {
  const t = useT();
  useThemeVersion(); // resolveSeriesColor reads CSS vars; re-run on theme change

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line-soft">
            <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-mono text-[10.5px] font-normal uppercase tracking-wider text-ink-muted">
              {t("metrics.matrix.metric")}
            </th>
            {matrix.columns.map((col, colIndex) => (
              <th key={col.hostid} className="px-2 py-2 text-center align-bottom">
                <button
                  type="button"
                  onClick={() => onToggleColumn(colIndex)}
                  title={t("metrics.matrix.toggleColumn", col.name)}
                  className="max-w-[120px] truncate font-mono text-[10.5px] font-semibold text-ink-2 hover:text-accent"
                >
                  {col.name}
                </button>
              </th>
            ))}
            <th className="px-2 py-2 text-center align-bottom">
              <AddHostColumn onAddHost={onAddHost} busy={addHostBusy} />
            </th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.key} className="border-b border-line-soft last:border-0 hover:bg-surface-2/60">
              <td className="sticky left-0 z-10 max-w-[320px] bg-surface px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => onToggleRow(row)}
                  title={t("metrics.matrix.toggleRow", row.name)}
                  className="flex w-full flex-col items-start text-left hover:text-accent"
                >
                  <span className="truncate font-medium text-ink" title={row.name}>
                    {row.name}
                  </span>
                  <span className="truncate font-mono text-[10px] text-ink-muted" title={row.key_}>
                    {row.key_}
                    {row.units ? ` · ${row.units}` : ""}
                  </span>
                </button>
              </td>
              {row.cells.map((cell, colIndex) => {
                const col = matrix.columns[colIndex]!;
                if (cell.itemid === null) {
                  return (
                    <td key={col.hostid} className="px-2 py-1.5 text-center">
                      <span
                        aria-disabled="true"
                        title={t("metrics.matrix.notPresent")}
                        className="inline-block h-5 w-5 rounded border border-dashed border-line-soft opacity-50"
                      />
                    </td>
                  );
                }
                const active = selectedIds.has(cell.itemid);
                const color = active ? resolveSeriesColor(colorIndexById.get(cell.itemid) ?? 0) : undefined;
                return (
                  <td key={col.hostid} className="px-2 py-1.5 text-center">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      aria-label={t("metrics.matrix.toggleCell", row.name, col.name)}
                      onClick={() => onToggleCell(cell.itemid!)}
                      className={`inline-block h-5 w-5 rounded border transition-colors ${
                        active ? "border-transparent" : "border-line bg-surface-2 hover:border-accent/60"
                      }`}
                      style={active ? { backgroundColor: color } : undefined}
                    />
                  </td>
                );
              })}
              <td className="px-2 py-1.5" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "＋ Host…"-Spalte: kleines Suchpopover, das eine zusätzliche Host-Spalte ergänzt. */
function AddHostColumn({ onAddHost, busy }: { onAddHost: (hostid: string) => void; busy: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const suggestQuery = useHostSuggestions(open ? query : "");

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const hosts = suggestQuery.data ?? [];

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="whitespace-nowrap rounded-md border border-dashed border-line px-2 py-1 font-mono text-[10.5px] text-ink-2 hover:border-accent/60 disabled:opacity-50"
      >
        {busy ? "…" : t("metrics.matrix.addHost")}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-line bg-surface p-1.5 text-left shadow-lg">
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("metrics.matrix.addHostPlaceholder")}
            className="mb-1 w-full rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11.5px] text-ink outline-none focus:border-accent/60"
          />
          <div className="max-h-56 overflow-y-auto">
            {hosts.length === 0 ? (
              <div className="px-2 py-1.5 text-[11.5px] text-ink-2">{t("metrics.autocomplete.noResults")}</div>
            ) : (
              hosts.map((h) => (
                <button
                  key={h.hostid}
                  type="button"
                  onClick={() => {
                    onAddHost(h.hostid);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-ink-2 hover:bg-surface-2"
                >
                  <span className="truncate">{h.name || h.host}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
