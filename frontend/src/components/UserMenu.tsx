import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../lib/auth/store";
import { markSsoSuppressed } from "../lib/auth/sso";
import { applyTheme, currentTheme, type Theme } from "../lib/theme";
import { useLocale, useT, type Locale } from "../lib/i18n";

/**
 * Avatar/initials dropdown for the AppShell top bar (tiqora
 * AccountMenu pattern, trimmed down): shows the signed-in username,
 * a language switcher (Deutsch/English), the existing light/dark
 * theme toggle, and sign-out (incl. markSsoSuppressed so the SSO
 * flow doesn't immediately re-attempt Kerberos login).
 *
 * Rendered both in the desktop bar and inside the mobile (<900px) sheet —
 * `variant` only tweaks the trigger's look, the panel content is identical.
 */
export function UserMenu({ variant = "desktop" }: { variant?: "desktop" | "mobile" }) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const username = useAuthStore((s) => s.username);
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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

  function onLogout() {
    setOpen(false);
    markSsoSuppressed();
    logout();
  }

  function onSelectLocale(next: Locale) {
    setLocale(next);
  }

  function onSelectTheme(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }

  const initials = (username?.[0] ?? "?").toUpperCase();

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("userMenu.trigger")}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-[12.5px] text-ink-2"
      >
        <span className="grid h-5 w-5 place-items-center rounded-full bg-accent-soft text-[10.5px] font-semibold text-accent">
          {initials}
        </span>
        {variant === "mobile" && <span>{username}</span>}
      </button>

      {open && (
        <div
          className={
            variant === "mobile"
              ? "mt-1.5 w-full rounded-md border border-line bg-surface-2 p-2 shadow-lg"
              : "absolute right-0 top-full z-50 mt-1.5 w-56 rounded-md border border-line bg-surface p-2 shadow-lg"
          }
        >
          <div className="truncate border-b border-line-soft px-1.5 pb-2 text-[12.5px] font-semibold text-ink">
            {username}
          </div>

          <div className="px-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
            {t("userMenu.language")}
          </div>
          <div className="mt-1 flex gap-1 px-1.5">
            <button
              type="button"
              onClick={() => onSelectLocale("de")}
              className={`flex-1 rounded-md border px-2 py-1 text-[12px] ${
                locale === "de"
                  ? "border-accent/50 bg-accent-soft font-semibold text-accent"
                  : "border-line text-ink-2"
              }`}
            >
              {t("userMenu.languageDe")}
            </button>
            <button
              type="button"
              onClick={() => onSelectLocale("en")}
              className={`flex-1 rounded-md border px-2 py-1 text-[12px] ${
                locale === "en"
                  ? "border-accent/50 bg-accent-soft font-semibold text-accent"
                  : "border-line text-ink-2"
              }`}
            >
              {t("userMenu.languageEn")}
            </button>
          </div>

          <div className="px-1.5 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
            {t("userMenu.theme")}
          </div>
          <div className="mt-1 flex gap-1 px-1.5">
            <button
              type="button"
              onClick={() => onSelectTheme("light")}
              className={`flex-1 rounded-md border px-2 py-1 text-[12px] ${
                theme === "light"
                  ? "border-accent/50 bg-accent-soft font-semibold text-accent"
                  : "border-line text-ink-2"
              }`}
            >
              ☀ {t("userMenu.themeLight")}
            </button>
            <button
              type="button"
              onClick={() => onSelectTheme("dark")}
              className={`flex-1 rounded-md border px-2 py-1 text-[12px] ${
                theme === "dark"
                  ? "border-accent/50 bg-accent-soft font-semibold text-accent"
                  : "border-line text-ink-2"
              }`}
            >
              ☾ {t("userMenu.themeDark")}
            </button>
          </div>

          <div className="mt-2.5 border-t border-line-soft pt-2">
            <button
              type="button"
              onClick={onLogout}
              className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-1 text-left text-[12.5px] text-ink-2"
            >
              {t("userMenu.logout")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
