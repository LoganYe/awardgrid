"use client";

/**
 * Client side of i18n: a context provider fed by the root layout with the server-resolved
 * locale, plus `useLocale()` / `useT()` hooks. Translation itself is the pure `t()` from
 * "./", so server and client render identical strings (no hydration mismatch).
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, t, type I18nKey, type Locale, type Translate, type TranslateVars } from "./";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** The locale the root layout resolved from the cookie. */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/**
 * Bound translator. Pass an explicit `locale` to override the context (rarely needed).
 *   const tr = useT(); tr("nav.grid"); tr("grid.quota", { used: 12, limit: 950 })
 */
export function useT(locale?: Locale): Translate {
  const ctx = useContext(LocaleContext);
  const active = locale ?? ctx;
  return useMemo<Translate>(
    () => (key: I18nKey, vars?: TranslateVars) => t(active, key, vars),
    [active],
  );
}
