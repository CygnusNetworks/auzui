import { useState } from "react";
import { currentTheme, toggleTheme } from "../lib/theme";
import { useT } from "../lib/i18n";

export function ThemeToggle() {
  const t = useT();
  const [theme, setTheme] = useState(currentTheme);

  return (
    <button
      type="button"
      title={t("userMenu.toggleTheme")}
      aria-label={t("userMenu.toggleTheme")}
      onClick={() => setTheme(toggleTheme())}
      className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface-2 text-ink-2 hover:text-ink"
    >
      {theme === "dark" ? "☾" : "☀"}
    </button>
  );
}
