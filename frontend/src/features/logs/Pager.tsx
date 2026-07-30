import { useT } from "../../lib/i18n";

/**
 * Schmale Kopfzeile über der Logliste (PLAN Aufgabe 3): "N Treffer · Seite X
 * von Y · 50 pro Seite" + Seiten-Buttons (« ‹ 2 [3] 4 › »). Im Live-Modus auf
 * Seite > 1 zusätzlich der Hinweis, dass Live pausiert ist.
 */
export function Pager({
  total,
  page,
  pageSize,
  live,
  onPage,
}: {
  total: number;
  page: number;
  pageSize: number;
  live: boolean;
  onPage: (page: number) => void;
}) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(page, pages);
  const windowPages = pageWindow(clamped, pages);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-3.5 py-1.5 font-mono text-[10.5px] text-ink-muted">
      <span>{t("logs.hitsCount", total)}</span>
      <span>·</span>
      <span>{t("logs.pageInfo", clamped, pages, pageSize)}</span>
      {live && clamped > 1 && <span className="text-sev-warn">· {t("logs.livePaused")}</span>}
      <div className="ml-auto flex items-center gap-0.5">
        <PageButton label="«" title={t("logs.firstPage")} disabled={clamped <= 1} onClick={() => onPage(1)} />
        <PageButton
          label="‹"
          title={t("logs.prevPage")}
          disabled={clamped <= 1}
          onClick={() => onPage(clamped - 1)}
        />
        {windowPages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === clamped}
            className={`min-w-[22px] rounded px-1.5 py-0.5 ${
              p === clamped
                ? "bg-accent-soft text-accent"
                : "text-ink-2 hover:bg-surface-2"
            }`}
          >
            {p}
          </button>
        ))}
        <PageButton
          label="›"
          title={t("logs.nextPage")}
          disabled={clamped >= pages}
          onClick={() => onPage(clamped + 1)}
        />
        <PageButton
          label="»"
          title={t("logs.lastPage")}
          disabled={clamped >= pages}
          onClick={() => onPage(pages)}
        />
      </div>
    </div>
  );
}

function PageButton({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded px-1.5 py-0.5 text-ink-2 hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {label}
    </button>
  );
}

/** Up to 5 page numbers centered on the current page. */
function pageWindow(page: number, pages: number): number[] {
  const size = Math.min(5, pages);
  let start = Math.max(1, page - 2);
  const end = Math.min(pages, start + size - 1);
  start = Math.max(1, end - size + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
