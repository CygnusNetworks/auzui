import { useEffect, useState } from "react";

/** Generic debounce for text inputs (Freitext-Suche etc.) — shared by LogsPanel, MetricsPage, LogsPage. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
