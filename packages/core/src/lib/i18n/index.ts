/**
 * Minimal i18n (kickoff §8: English UI with a zh-CN toggle).
 *
 * Pure module — safe in server components, client components and tests.
 *   - `t(locale, key, vars?)`      translate with `{name}` interpolation
 *   - `parseLocale(value)`         normalise a cookie / header / DB value to a Locale
 *   - `getLocale()`                server-only helper → import from "./server"
 *   - `useT()` / `useLocale()`     client hook + provider → import from "./client"
 *
 * Other engineers: append keys to BOTH dictionaries (see dictionaries/en.ts header).
 */
import { en } from "./dictionaries/en";
import { zh } from "./dictionaries/zh";

export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Cookie that persists the UI language (set by the toggle; readable server-side). */
export const LOCALE_COOKIE = "ag_locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type I18nKey = keyof typeof en;
export type Dictionary = Record<I18nKey, string>;
export type TranslateVars = Record<string, string | number>;
export type Translate = (key: I18nKey, vars?: TranslateVars) => string;

export const dictionaries: Record<Locale, Dictionary> = { en, zh };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** "zh", "zh-CN", "zh-Hans-TW" → "zh"; anything else → default. */
export function parseLocale(value: string | null | undefined): Locale {
  if (!value) return DEFAULT_LOCALE;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : DEFAULT_LOCALE;
}

/** BCP-47 tag for `<html lang>`. */
export function htmlLang(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en";
}

export function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const v = vars[name];
    return v === undefined ? match : String(v);
  });
}

/** Translate `key` for `locale`; falls back to English, then to the key itself. */
export function t(locale: Locale, key: I18nKey, vars?: TranslateVars): string {
  const template = dictionaries[locale]?.[key] ?? en[key] ?? key;
  return interpolate(template, vars);
}

/** Bind a locale once: `const tr = translator("zh"); tr("nav.grid")`. */
export function translator(locale: Locale): Translate {
  return (key, vars) => t(locale, key, vars);
}

/** True when `key` exists in the English dictionary (useful for mapping API error codes). */
export function hasKey(key: string): key is I18nKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

/** Map an API `{error: code}` to a translated message, defaulting to error.unknown. */
export function errorText(locale: Locale, code: string | undefined | null, vars?: TranslateVars): string {
  const key = `error.${code ?? ""}`;
  return t(locale, hasKey(key) ? key : "error.unknown", vars);
}
