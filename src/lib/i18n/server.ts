/**
 * Server-only locale helper (reads the `ag_locale` cookie via next/headers).
 * Do not import from client components or from tests — use `parseLocale` from "@awardgrid/core/i18n".
 */
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, parseLocale, translator, type Locale, type Translate } from "@awardgrid/core/i18n";

/** Current UI locale: the `ag_locale` cookie, defaulting to English. */
export async function getLocale(): Promise<Locale> {
  try {
    const store = await cookies();
    return parseLocale(store.get(LOCALE_COOKIE)?.value);
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Convenience: locale + bound translator for server components. */
export async function getT(): Promise<{ locale: Locale; t: Translate }> {
  const locale = await getLocale();
  return { locale, t: translator(locale) };
}
