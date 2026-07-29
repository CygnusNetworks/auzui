import { useEffect, useRef, useState } from "react";

export interface Presence<T> {
  item: T;
  leaving: boolean;
}

/**
 * Keeps items that just dropped out of `items` around for one exit-animation
 * frame (marked `leaving: true`) before actually removing them — so a row
 * can fade/collapse out instead of vanishing instantly, e.g. a problem that
 * leaves the "nur unbestätigte" filter right after being acknowledged.
 * Preserves the relative order of surviving + leaving items to avoid
 * layout jumps; genuinely new items are appended at the end.
 */
export function useAnimatedPresence<T>(
  items: T[],
  keyOf: (item: T) => string,
  exitDurationMs = 260,
): Presence<T>[] {
  const [presence, setPresence] = useState<Map<string, Presence<T>>>(
    () => new Map(items.map((item) => [keyOf(item), { item, leaving: false }])),
  );
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setPresence((prev) => {
      const currentKeys = new Set(items.map(keyOf));
      const itemByKey = new Map(items.map((item) => [keyOf(item), item]));
      const next = new Map<string, Presence<T>>();

      // Walk the previous order first so surviving + leaving rows keep their
      // position; genuinely new items get appended below.
      for (const [key, entry] of prev) {
        if (currentKeys.has(key)) {
          const timer = timers.current.get(key);
          if (timer) {
            clearTimeout(timer);
            timers.current.delete(key);
          }
          next.set(key, { item: itemByKey.get(key)!, leaving: false });
          continue;
        }
        if (!timers.current.has(key)) {
          const timer = setTimeout(() => {
            setPresence((p) => {
              const copy = new Map(p);
              copy.delete(key);
              return copy;
            });
            timers.current.delete(key);
          }, exitDurationMs);
          timers.current.set(key, timer);
        }
        next.set(key, { item: entry.item, leaving: true });
      }

      for (const item of items) {
        const key = keyOf(item);
        if (!next.has(key)) next.set(key, { item, leaving: false });
      }

      return next;
    });
  }, [items, exitDurationMs]);

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      for (const t of activeTimers.values()) clearTimeout(t);
      activeTimers.clear();
    };
  }, []);

  return [...presence.values()];
}
