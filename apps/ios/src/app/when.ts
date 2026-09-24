/**
 * A short date and time on this device's clock, for when something was made or saved (T12, T13): "Oct 18, 09:12" /
 * "10月18日 09:12". An unreadable instant is shown as it is, never guessed.
 */
import { type Locale, langTag } from "./locale";

export function shortDateTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(langTag(locale), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
