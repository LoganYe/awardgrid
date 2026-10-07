/**
 * A trip plan put into words (release plan step 18): which places it reads as and their airports, its dates with the
 * year and how many days they span, its cabins, and the conditions beyond those. Pure functions of a QueryObject and
 * the places seed, so the plan the screen shows is the search a connected account would run, said plainly.
 *
 * Airports are shown as core's places seed groups them: a metro the parser expanded ("Tokyo" → NRT, HND) comes back as
 * that metro with its airports; any other airport is named on its own (Narita, or its metro's name when it has none).
 */
import { DEFAULT_PLACES, type Places } from "@awardgrid/core/query/places";
import type { Cabin, QueryObject } from "@awardgrid/core/query/schema";
import { formatMiles, programLabel, rangeLabel } from "@awardgrid/core/workspace/present";
import { cabinName, placeName, spanDays } from "@awardgrid/core/workspace/query-editor";
import type { Locale } from "../../app/locale";
import { PLAN } from "./plan-copy";

export interface PlanPlace {
  /** A metro code (TYO) or an airport code (SEA). */
  code: string;
  /** Its name in the screen's language; the code itself when the seed names none. */
  name: string;
  /** The airports it stands for in the plan, in the seed's order of preference. */
  airports: string[];
}

/**
 * The airports of one side of a plan, grouped back into the places they came from: a metro whose every airport is in
 * the list is one place with those airports; any other airport is a place of its own. Order follows the list.
 */
export function planPlaces(airports: readonly string[], locale: Locale, places: Places = DEFAULT_PLACES): PlanPlace[] {
  const listed = new Set(airports);
  const used = new Set<string>();
  const out: PlanPlace[] = [];
  for (const airport of airports) {
    if (used.has(airport)) continue;
    const metro = Object.entries(places.cities).find(
      ([, members]) => members.length > 1 && members.includes(airport) && members.every((m) => listed.has(m) && !used.has(m)),
    );
    if (metro) {
      const [code, members] = metro;
      for (const m of members) used.add(m);
      out.push({ code, name: placeName(code, locale, places), airports: [...members] });
    } else {
      used.add(airport);
      out.push({ code: airport, name: placeName(airport, locale, places, "airport"), airports: [airport] });
    }
  }
  return out;
}

/** "Tokyo · NRT, HND" / "东京 · NRT、HND"; "Seattle · SEA"; a code the seed does not name, on its own. */
export function planPlaceText(place: PlanPlace, locale: Locale): string {
  const codes = place.airports.join(locale === "zh" ? "、" : ", ");
  return place.name === place.code && place.airports.length === 1 ? codes : `${place.name} · ${codes}`;
}

/** The plan's dates with their year: "Nov 1 – 30, 2026" / "2026年11月1–30日"; a range across years names both. */
export function planDates(from: string, to: string, locale: Locale): string {
  const range = rangeLabel(from, to, locale);
  if (from.slice(0, 4) !== to.slice(0, 4)) return range;
  const year = from.slice(0, 4);
  return locale === "zh" ? `${year}年${range}` : `${range}, ${year}`;
}

/** "Nov 1 – 30, 2026 · 30 days". */
export function planDatesLine(query: Pick<QueryObject, "date_from" | "date_to">, locale: Locale): string {
  return `${planDates(query.date_from, query.date_to, locale)} · ${PLAN[locale].dayCount(spanDays(query.date_from, query.date_to))}`;
}

/** Business first, as the editor and the query summary list them. */
export function planCabins(cabins: readonly Cabin[], locale: Locale): string {
  return (["J", "F", "W", "Y"] as const satisfies readonly Cabin[])
    .filter((c) => cabins.includes(c))
    .map((c) => cabinName(c, locale))
    .join(locale === "zh" ? "、" : ", ");
}

/** What else the text asked for: nonstop, the programs, a mileage cap. Empty when it asked for none of them. */
export function planConditions(query: Pick<QueryObject, "direct_only" | "programs" | "max_miles">, locale: Locale): string[] {
  const p = PLAN[locale];
  const out: string[] = [];
  if (query.direct_only) out.push(p.nonstop);
  if (query.programs && query.programs.length > 0) out.push(p.programs(query.programs.map(programLabel).join(locale === "zh" ? "、" : ", ")));
  if (query.max_miles !== undefined && query.max_miles !== null) out.push(p.maxMiles(formatMiles(query.max_miles)));
  return out;
}

/** Whether the plan's dates have passed on `today` (YYYY-MM-DD, this device's calendar day): all, some, or none. */
export function planPast(query: Pick<QueryObject, "date_from" | "date_to">, today: string): "all" | "some" | null {
  if (query.date_to < today) return "all";
  if (query.date_from < today) return "some";
  return null;
}

/** A plan in one line, for the names of its actions: "HKG → SEA, Nov 1 – 30, 2026". */
export function planName(query: Pick<QueryObject, "origins" | "destinations" | "date_from" | "date_to">, locale: Locale): string {
  const sep = locale === "zh" ? "、" : ", ";
  return `${query.origins.join(sep)} → ${query.destinations.join(sep)}${locale === "zh" ? "，" : ", "}${planDates(query.date_from, query.date_to, locale)}`;
}
