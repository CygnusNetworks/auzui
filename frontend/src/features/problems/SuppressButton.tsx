import { useEffect, useRef, useState } from "react";
import { useT } from "../../lib/i18n";

const HOUR = 3600;

/**
 * Split button for "Suppress": the main button suppresses indefinitely, the
 * caret opens a duration menu (1 h / 8 h / 24 h / indefinite). `onSuppress`
 * receives the suppress_until unix timestamp (0 = indefinite) — shared by the
 * detail panel and the bulk selection bar.
 */
export function SuppressButton({
  pending,
  onSuppress,
}: {
  pending: boolean;
  onSuppress: (suppressUntil: number) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function pick(durationSeconds: number) {
    setOpen(false);
    onSuppress(durationSeconds === 0 ? 0 : Math.floor(Date.now() / 1000) + durationSeconds);
  }

  const options: { label: string; seconds: number }[] = [
    { label: t("problems.suppressMenu.hour1"), seconds: HOUR },
    { label: t("problems.suppressMenu.hour8"), seconds: 8 * HOUR },
    { label: t("problems.suppressMenu.hour24"), seconds: 24 * HOUR },
    { label: t("problems.suppressMenu.indefinite"), seconds: 0 },
  ];

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        disabled={pending}
        onClick={() => pick(0)}
        className="whitespace-nowrap rounded-l-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 disabled:opacity-40"
      >
        {t("problems.detailPanel.suppress")}
      </button>
      <button
        type="button"
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("problems.suppressMenu.menuAria")}
        onClick={() => setOpen((v) => !v)}
        className="rounded-r-md border border-l-0 border-line bg-surface-2 px-1.5 py-1 text-xs text-ink-2 disabled:opacity-40"
      >
        ▾
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 min-w-[130px] rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          {options.map((opt) => (
            <button
              key={opt.seconds}
              type="button"
              role="menuitem"
              onClick={() => pick(opt.seconds)}
              className="block w-full rounded px-2.5 py-1 text-left text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
