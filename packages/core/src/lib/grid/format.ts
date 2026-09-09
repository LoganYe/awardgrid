/**
 * Display formatting for the grid cell and the cell drawer (Phase 6 §3.4).
 *
 * Numbers go through Intl in the viewer's locale; tabular alignment is CSS
 * (`font-variant-numeric: tabular-nums` on `html`), so nothing here pads. Program names are
 * text only (kickoff §0.2 #4): `programShortName` is the one-word name a 112 px cell can hold,
 * `SOURCE_NAMES` (via `programDisplayName`) stays the long form for drawers and exports.
 */
import type { Cabin } from "../query/schema";
import type { Translate } from "../i18n";
import type { Lang } from "./freshness";
import type { SeatsSource } from "../seatsaero/types";

export type FormatLocale = Lang;

/** BCP-47 tag for Intl from the UI locale. */
export function intlLocale(locale: FormatLocale): string {
  return locale === "zh" ? "zh-CN" : "en-US";
}

/** 60000 → "60,000" (grouping in the viewer's locale; both UI locales group by thousands). */
export function formatMiles(miles: number, locale: FormatLocale = "en"): string {
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(miles);
}

/**
 * Text shown when fees are unknown: "?" (docs/UI_PLAN.md §1 "unknowns say ?, never blank"). Not a
 * dash — the no-availability cell is the one quiet en dash, and the two must never look alike.
 */
export const FEES_UNKNOWN = "?";

/**
 * "$5.60" for USD; "56.00 EUR" for any other currency (the ISO code, never a symbol the viewer
 * may misread); "?" when fees are unknown. A null currency with known fees follows the recorded
 * Phase 0 assumption (DECISIONS.md "TotalTaxes unit"): seats.aero omits TaxesCurrency for USD.
 */
export function formatFees(feesCents: number | null, currency: string | null, locale: FormatLocale = "en"): string {
  if (feesCents === null) return FEES_UNKNOWN;
  const amount = new Intl.NumberFormat(intlLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    feesCents / 100,
  );
  const code = currency === null || currency === "" ? "USD" : currency.toUpperCase();
  return code === "USD" ? `$${amount}` : `${amount} ${code}`;
}

const SEAT_WORDS: Record<FormatLocale, { one: string; many: string }> = {
  en: { one: "seat", many: "seats" },
  zh: { one: "个座位", many: "个座位" },
};

/**
 * "2 seats" / "1 seat" / "seats unknown" (0 = the program does not disclose seat counts).
 * The unknown wording comes from the dictionary through `t`; the count wording is a plural
 * rule per locale (en has one, zh does not).
 */
export function formatSeats(seats: number, locale: FormatLocale, t: Translate): string {
  if (!Number.isFinite(seats) || seats <= 0) return t("grid.cell.seats_unknown");
  const words = SEAT_WORDS[locale];
  const n = new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(seats);
  return `${n} ${seats === 1 ? words.one : words.many}`;
}

/**
 * One- or two-word program names for the 112 px cell (text only, no marks or colors). The
 * long names stay in SOURCE_NAMES for the drawer, CSV and digests.
 */
export const PROGRAM_SHORT_NAMES: Readonly<Record<SeatsSource, string>> = {
  eurobonus: "EuroBonus",
  virginatlantic: "Virgin Atlantic",
  aeromexico: "Aeromexico",
  american: "American",
  delta: "Delta",
  etihad: "Etihad",
  united: "United",
  emirates: "Emirates",
  aeroplan: "Aeroplan",
  alaska: "Alaska",
  velocity: "Velocity",
  qantas: "Qantas",
  connectmiles: "ConnectMiles",
  azul: "Azul",
  smiles: "Smiles",
  flyingblue: "Flying Blue",
  jetblue: "JetBlue",
  qatar: "Qatar",
  turkish: "Turkish",
  singapore: "Singapore",
  ethiopian: "Ethiopian",
  saudia: "Saudia",
  finnair: "Finnair",
  lufthansa: "Lufthansa",
  frontier: "Frontier",
  spirit: "Spirit",
};

/** Short program name for a seats.aero source code; unknown codes fall back to the code itself. */
export function programShortName(source: string): string {
  return (PROGRAM_SHORT_NAMES as Record<string, string>)[source] ?? source;
}

/** The one-letter cabin tag shown before the miles when both cabins are in the grid. */
export function cabinTag(cabin: Cabin): "J" | "F" | "W" | "Y" {
  return cabin;
}

/** Localized cabin name from the dictionary ("Business" / "商务舱"). */
export function cabinName(cabin: Cabin, t: Translate): string {
  return t(`grid.cabin.${cabin}`);
}

/**
 * Grid date label: "Oct 15" in every locale-appropriate short form (spec §8 "grid dates
 * ISO-ish"). Dates are calendar days, so they are formatted in UTC and never shift.
 */
export function formatGridDate(isoDate: string, locale: FormatLocale = "en"): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

/** Row-header label: "Wed Oct 15" / "10月15日周三". */
export function formatRowDate(isoDate: string, locale: FormatLocale = "en"): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

/** Spoken date for aria labels and drawers: "October 15" / "10月15日". */
export function formatLongDate(isoDate: string, locale: FormatLocale = "en"): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "long", day: "numeric", timeZone: "UTC" }).format(d);
}
