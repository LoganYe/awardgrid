/**
 * Accessible name for one grid cell (Phase 6 §3.4):
 *
 *   "SEA to NRT, October 15, business, 60,000 miles, $5.60 fees, 2 seats, Alaska, seen 2 hours ago."
 *   "SEA 到 NRT，10月15日，商务舱，60,000 里程，税费 $5.60，2 个座位，Alaska，2 小时前查看。"
 *
 * The sentence comes from the dictionary (`grid.cell.aria`) so the wording lives in one place
 * for both languages; this module fills the slots and produces the variants: stale adds
 * ", stale" after the age, unknown freshness replaces the age clause with "freshness unknown",
 * unknown fees drop their clause, the seats clause is "1 seat" / "2 seats" / "seats unknown". The other cell states
 * keep the route/date/cabin head and end with the state text.
 */
import type { Cabin } from "@/lib/query/schema";
import type { Translate, I18nKey } from "@/lib/i18n";
import { hasKey } from "@/lib/i18n";
import { formatAgeLong, tier, type Lang } from "@/lib/grid/freshness";
import { cabinName, formatFees, formatLongDate, formatMiles, formatSeats, programShortName } from "@/lib/grid/format";
import type { GridCell } from "@/lib/grid/types";

export interface CellAriaOptions {
  /** Cabins the grid shows; named in the label when the cell has no row of its own. */
  cabins?: readonly Cabin[];
  /** Overrides `cell.reason` for a not-fetched cell (an i18n key). */
  reason?: string;
}

/** Clause separators per language (full-width punctuation in zh, spec §1.3). */
const PUNCT: Record<Lang, { sep: string; end: string }> = {
  en: { sep: ", ", end: "." },
  zh: { sep: "，", end: "。" },
};

const SENTINEL_FEES = "\uE000";
const SENTINEL_SEATS = "\uE001";
const SENTINEL_AGE = "\uE002";

/** Remove the whole comma-delimited clause that contains `mark` (and its leading separator). */
function dropClause(label: string, mark: string): string {
  return label.replace(new RegExp(`(?:[,，]\\s*)?[^,，.。]*${mark}[^,，.。]*`), "");
}

/** Replace the clause containing `mark` with `text` (separators and the leading space stay). */
function replaceClause(label: string, mark: string, text: string): string {
  return label.replace(new RegExp(`(\\s*)[^,，.。]*${mark}[^,，.。]*`), (_m, ws: string) => `${ws}${text}`);
}

function stripEnd(label: string, lang: Lang): string {
  const { end } = PUNCT[lang];
  return label.endsWith(end) ? label.slice(0, -end.length) : label;
}

/** "{origin} to {dest}, {date}, {cabin}" — the part of the dictionary sentence before the data. */
function head(cell: GridCell, cabins: readonly Cabin[], lang: Lang, t: Translate): string {
  const template = t("grid.cell.aria");
  const cut = template.indexOf("{cabin}");
  const prefix = cut >= 0 ? template.slice(0, cut + "{cabin}".length) : "{origin} to {dest}, {date}, {cabin}";
  const cabin = cabins
    .map((c) => (lang === "zh" ? cabinName(c, t) : cabinName(c, t).toLocaleLowerCase("en")))
    .join(lang === "zh" ? "和" : " and ");
  const filled = prefix
    .replace("{origin}", cell.origin)
    .replace("{dest}", cell.dest)
    .replace("{date}", formatLongDate(cell.date, lang))
    .replace("{cabin}", cabin);
  // No cabin to name: drop the (now empty) trailing clause.
  return cabin === "" ? filled.replace(/[,，]\s*$/, "") : filled;
}

function stateKey(cell: GridCell, opts: CellAriaOptions): I18nKey {
  switch (cell.status) {
    case "none":
      return "grid.cell.no_availability";
    case "unmonitored":
      return "grid.cell.not_monitored";
    case "not_fetched": {
      const reason = opts.reason ?? cell.reason;
      return reason !== undefined && hasKey(reason) ? reason : "grid.cell.not_fetched";
    }
    case "loading":
      return "grid.cell.loading";
    default:
      return "grid.cell.no_availability";
  }
}

/**
 * The cell's `aria-label`. `now` is the clock the ages are measured against (inject in tests).
 * Available and filtered cells describe `cell.best`; every other state names the state.
 */
export function cellAriaLabel(
  cell: GridCell,
  locale: Lang,
  t: Translate,
  now: string | number | Date,
  opts: CellAriaOptions = {},
): string {
  const { sep, end } = PUNCT[locale];
  const best = cell.best;
  if ((cell.status === "ok" || cell.status === "filtered") && best) {
    const tr = tier(best.computed_last_seen, now);
    const age = formatAgeLong(best.computed_last_seen, now, locale);
    let label = t("grid.cell.aria", {
      origin: cell.origin,
      dest: cell.dest,
      date: formatLongDate(cell.date, locale),
      cabin: locale === "zh" ? cabinName(best.cabin, t) : cabinName(best.cabin, t).toLocaleLowerCase("en"),
      miles: formatMiles(best.miles, locale),
      fees: best.fees_cents === null ? SENTINEL_FEES : formatFees(best.fees_cents, best.currency, locale),
      seats: SENTINEL_SEATS,
      program: programShortName(best.program),
      age: age ?? SENTINEL_AGE,
    });
    if (best.fees_cents === null) label = dropClause(label, SENTINEL_FEES);
    // The dictionary slot is "{seats} seats"; the plural/unknown wording comes from formatSeats.
    label = replaceClause(label, SENTINEL_SEATS, formatSeats(best.seats_left, locale, t));
    if (age === null) label = replaceClause(label, SENTINEL_AGE, t("grid.cell.aria_unknown"));
    const tail: string[] = [];
    if (tr === "stale") tail.push(t("grid.cell.aria_stale"));
    if (cell.status === "filtered") tail.push(t("grid.cell.filtered"));
    if (tail.length === 0) return label;
    return `${stripEnd(label, locale)}${sep}${tail.join(sep)}${end}`;
  }
  const cabins = opts.cabins ?? [];
  return `${head(cell, cabins, locale, t)}${sep}${t(stateKey(cell, opts))}${end}`;
}
