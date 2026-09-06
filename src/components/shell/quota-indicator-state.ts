/**
 * Pure logic behind the top-bar quota indicator (Phase 6 spec §4.7): the three states and
 * their thresholds, the `312 / 1,000` figure, and the localized reset time. No React, no DOM,
 * no server imports — shared by the client component and by GET /api/usage so the server's
 * `state` field and the indicator's color can never disagree.
 */

export type QuotaState = "ok" | "warn" | "exceeded";

/** Amber starts at this fraction of the provider's hard limit (0.8 × 1,000 = 800 calls). */
export const WARN_FRACTION = 0.8;

/**
 * `exceeded` at or past the soft limit awardgrid stops at (950 by default), `warn` at or past
 * 80 % of the hard limit (800), `ok` below. Garbage (NaN, negatives) reads as `ok` with 0 used.
 */
export function stateFor(used: number, soft: number, limit: number): QuotaState {
  const u = Number.isFinite(used) ? Math.max(0, used) : 0;
  if (Number.isFinite(soft) && soft > 0 && u >= soft) return "exceeded";
  if (Number.isFinite(limit) && limit > 0 && u >= Math.ceil(limit * WARN_FRACTION)) return "warn";
  return "ok";
}

/** Number of calls at which `stateFor` first answers `warn` for this hard limit. */
export function warnThreshold(limit: number): number {
  return Number.isFinite(limit) && limit > 0 ? Math.ceil(limit * WARN_FRACTION) : Number.POSITIVE_INFINITY;
}

function numberFormat(locale: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale);
  } catch {
    return new Intl.NumberFormat("en");
  }
}

/** Grouped integer in the given locale: 1000 → "1,000". */
export function formatCount(n: number, locale: string): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  return numberFormat(locale).format(v);
}

/** Compact integer for narrow screens: 1000 → "1k", 1200 → "1.2k", 950 → "950". */
export function formatCompact(n: number, locale: string): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  if (v < 1000) return formatCount(v, locale);
  const k = v / 1000;
  const rounded = Math.round(k * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}k`;
}

export interface FormatOptions {
  /** `312/1k` instead of `312 / 1,000` (mobile top bar). */
  compact?: boolean;
}

/**
 * The indicator's figure without its "today" suffix (that word comes from the dictionary):
 * `312 / 1,000` or, compact, `312/1k`. Grouping follows the locale via Intl.
 */
export function format(used: number, limit: number, locale: string, opts: FormatOptions = {}): string {
  return opts.compact
    ? `${formatCompact(used, locale)}/${formatCompact(limit, locale)}`
    : `${formatCount(used, locale)} / ${formatCount(limit, locale)}`;
}

function dayKey(d: Date, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(d);
}

export interface ResetLabelOptions {
  /** IANA zone to render in; defaults to the runtime's zone (the browser's). Tests pin it. */
  timeZone?: string;
}

/**
 * Localized wall-clock reset time: `08:00` when the reset falls on the same local day as
 * `now`, otherwise the day is included (`Oct 2, 08:00` / `10月2日 08:00`) so "resets at 08:00"
 * can never point at a time that already passed today. 24-hour clock in every locale (the bar
 * has no room for "AM"). Unparseable input yields "".
 */
export function resetLabel(iso: string, locale: string, now: Date = new Date(), opts: ResetLabelOptions = {}): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const timeZone = opts.timeZone;
  const sameDay = dayKey(d, "en-US", timeZone) === dayKey(now, "en-US", timeZone);
  const base: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone };
  const options: Intl.DateTimeFormatOptions = sameDay ? base : { ...base, month: "short", day: "numeric" };
  try {
    return new Intl.DateTimeFormat(locale, options).format(d);
  } catch {
    return new Intl.DateTimeFormat("en", options).format(d);
  }
}

/** Dollars as a localized currency string: 0.42 → "$0.42" (en) / "US$0.42" (zh). */
export function formatUsd(usd: number, locale: string): string {
  const v = Number.isFinite(usd) ? Math.max(0, usd) : 0;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(v);
  } catch {
    return new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(v);
  }
}
