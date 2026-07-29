import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { de } from "../locales/de";
import { en } from "../locales/en";

export type Locale = "de" | "en";

export const LOCALE_STORAGE_KEY = "auzui-locale";

const catalogs = { de, en } satisfies Record<Locale, unknown>;

/** Flattens the (nested) message catalog type into "a.b.c" dotted keys. */
type DotKeys<T, Prefix extends string = ""> = T extends (...args: never[]) => string
  ? Prefix
  : T extends string
    ? Prefix
    : {
        [K in keyof T & string]: DotKeys<T[K], Prefix extends "" ? K : `${Prefix}.${K}`>;
      }[keyof T & string];

export type MessageKey = DotKeys<typeof de>;

type ValueAt<T, K extends string> = K extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? ValueAt<T[Head], Rest>
    : never
  : K extends keyof T
    ? T[K]
    : never;

/** Given a message key, resolves to its parameter tuple (or [] for plain strings). */
export type MessageParams<K extends MessageKey> = ValueAt<typeof de, K> extends (
  ...args: infer A
) => string
  ? A
  : [];

function detectDefaultLocale(): Locale {
  try {
    const nav = typeof navigator !== "undefined" ? navigator.language : "en";
    return nav?.toLowerCase().startsWith("de") ? "de" : "en";
  } catch {
    return "en";
  }
}

function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === "de" || stored === "en" ? stored : null;
  } catch {
    return null;
  }
}

function resolveMessage(locale: Locale, key: string): unknown {
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = catalogs[locale];
  for (const part of parts) {
    node = node?.[part];
  }
  if (node === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    node = catalogs.en as any;
    for (const part of parts) {
      node = node?.[part];
    }
  }
  return node;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  /** Overrides locale persistence/detection — mainly for tests that need a deterministic locale. */
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale ?? readStoredLocale() ?? detectDefaultLocale(),
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // ignore (private browsing / storage disabled)
    }
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLocale(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useLocale must be used within an I18nProvider");
  return ctx;
}

/**
 * Non-hook variant for use outside React (e.g. the zustand auth store),
 * where messages must be produced synchronously in response to an event.
 * Reads the persisted locale directly — not reactive to a language switch
 * that happens later, which is fine for one-shot error strings.
 */
export function tSync<K extends MessageKey>(key: K, ...params: MessageParams<K>): string {
  const locale = readStoredLocale() ?? detectDefaultLocale();
  const message = resolveMessage(locale, key);
  if (typeof message === "function") {
    return (message as (...a: unknown[]) => string)(...params);
  }
  if (typeof message === "string") return message;
  return String(key);
}

export type Translate = <K extends MessageKey>(key: K, ...params: MessageParams<K>) => string;

/**
 * useT() returns a `t(key, ...params)` function bound to the currently active
 * locale. Plain string messages take no params; function messages (e.g.
 * `(count: number) => string`) take whatever params they declare.
 */
export function useT(): Translate {
  const { locale } = useLocale();
  return useCallback(
    ((key, ...params) => {
      const message = resolveMessage(locale, key);
      if (typeof message === "function") {
        return (message as (...a: unknown[]) => string)(...params);
      }
      if (typeof message === "string") return message;
      return String(key);
    }) as Translate,
    [locale],
  );
}
