import { useState } from "react";
import { currentTheme, toggleTheme } from "../lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);

  return (
    <button
      type="button"
      title="Theme umschalten"
      aria-label="Theme umschalten"
      onClick={() => setTheme(toggleTheme())}
      className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface-2 text-ink-2 hover:text-ink"
    >
      {theme === "dark" ? "☾" : "☀"}
    </button>
  );
}
