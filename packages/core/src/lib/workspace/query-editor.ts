/**
 * The query editor's rules (UI/UX v1 plan 02 T06; docs/03 §2; acceptance A10, A11).
 *
 * The editor only ever edits a `QueryDraft`; nothing here sends anything. `resolveDraft` turns a draft into the
 * QueryObject a search runs: fixed dates are calendar days checked on the calendar (not by Date.parse, which rolls
 * 30 February into March), relative days are counted on an explicit UTC clock starting today and including it, and
 * the result goes through the original schema, so the 92-day cap and every other rule stay core's.
 *
 * Place options come from the bundled places seed: a metro is offered with its airports spelled out ("Tokyo · NRT,
 * HND"), and each airport on its own. An airport is named by its own alias where the seed has one (Narita, 浦东),
 * else by its metro (JFK → New York).
 */
import { parseDeterministic } from "../query/deterministic";
import { DEFAULT_PLACES, type Places, normalizeAlias } from "../query/places";
import { type Cabin, DEFAULT_CABINS, DEFAULT_MIN_CABIN_PCT, MAX_SPAN_DAYS, QueryObject } from "../query/schema";
import { SOURCE_NAMES, type SeatsSource } from "../seatsaero/types";
import { isRealDate } from "./semantics";
import type { DateRule, ISODate, QueryDraft } from "./types";

export type { DateRule, QueryDraft } from "./types";
/** Core's span cap, re-exported so a screen never writes its own copy (spec §12). */
export { MAX_SPAN_DAYS } from "../query/schema";

export type DraftErrorCode =
  | "invalid_calendar_date"
  | "end_before_start"
  | "span_exceeds_core_limit"
  | "invalid_relative_days"
  | "required"
  | "same_as_origin"
  | "ends_in_past"
  | "invalid_miles"
  | "unchosen_text";

/** A draft that cannot run. The message is the code, so a caller can match either. */
export class DraftError extends Error {
  readonly code: DraftErrorCode;
  constructor(code: DraftErrorCode) {
    super(code);
    this.name = "DraftError";
    this.code = code;
  }
}

const DAY_MS = 86_400_000;

/** Midnight UTC of a calendar date. setUTCFullYear, not Date.UTC, which reads years 0–99 as 1900–1999. */
function utcDay(date: ISODate): number {
  const d = new Date(0);
  d.setUTCFullYear(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return d.getTime();
}

/** How many calendar days a range covers, both ends included. */
export function spanDays(from: ISODate, to: ISODate): number {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS) + 1;
}

function isoDay(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The calendar days a date rule covers, or the rule it breaks. */
export function resolveDates(rule: DateRule, today: ISODate): { from: ISODate; to: ISODate } {
  if (rule.kind === "fixed") {
    if (!isRealDate(rule.from) || !isRealDate(rule.to)) throw new DraftError("invalid_calendar_date");
    if (rule.to < rule.from) throw new DraftError("end_before_start");
    if (spanDays(rule.from, rule.to) > MAX_SPAN_DAYS) throw new DraftError("span_exceeds_core_limit");
    return { from: rule.from, to: rule.to };
  }
  if (!isRealDate(today)) throw new DraftError("invalid_calendar_date");
  if (!Number.isSafeInteger(rule.days) || rule.days < 1) throw new DraftError("invalid_relative_days");
  if (rule.days > MAX_SPAN_DAYS) throw new DraftError("span_exceeds_core_limit");
  const start = utcDay(today);
  return { from: today, to: isoDay(start + (rule.days - 1) * DAY_MS) };
}

/** The QueryObject a draft runs as. Throws DraftError for a date rule, and the schema's own error for anything else. */
export function resolveDraft(draft: QueryDraft, today: ISODate): QueryObject {
  const { from, to } = resolveDates(draft.dates, today);
  const resolved = { ...draft.query, date_from: from, date_to: to };
  for (const day of [resolved.date_from, resolved.date_to]) {
    if (!isRealDate(day)) throw new DraftError("invalid_calendar_date");
  }
  return QueryObject.parse(resolved);
}

/** A draft that edits an existing query: its dates as the fixed range it ran with. */
export function draftFromQuery(query: QueryObject): QueryDraft {
  return { query, dates: { kind: "fixed", from: query.date_from, to: query.date_to } };
}

export type DraftField = "origins" | "destinations" | "dates" | "cabins" | "max_miles";

export interface DraftFieldError {
  field: DraftField;
  code: DraftErrorCode;
}

/**
 * Every broken field, in the editor's field order (docs/04 S02), so the first one can take focus. The rules are
 * core's (schema, span cap, calendar) plus two that only an editor can break: a range that has already ended, and
 * a route whose every pair is one airport to itself. A query core ran is never refused for anything else.
 */
export function validateDraft(draft: QueryDraft, today: ISODate): DraftFieldError[] {
  const errors: DraftFieldError[] = [];
  const { origins, destinations, cabins, max_miles } = draft.query;
  if (origins.length === 0) errors.push({ field: "origins", code: "required" });
  if (destinations.length === 0) errors.push({ field: "destinations", code: "required" });
  else if (origins.length > 0 && origins.every((o) => destinations.every((d) => d === o))) {
    errors.push({ field: "destinations", code: "same_as_origin" });
  }
  try {
    const { to } = resolveDates(draft.dates, today);
    if (isRealDate(today) && to < today) errors.push({ field: "dates", code: "ends_in_past" });
  } catch (err) {
    errors.push({ field: "dates", code: err instanceof DraftError ? err.code : "invalid_calendar_date" });
  }
  if (cabins.length === 0) errors.push({ field: "cabins", code: "required" });
  if (max_miles !== undefined && (!Number.isSafeInteger(max_miles) || max_miles <= 0)) errors.push({ field: "max_miles", code: "invalid_miles" });
  return errors;
}

/** An empty list and no list both mean "all" for programs (find.ts, identity.ts), so they compare equal. */
const sortedUnique = (values: readonly string[] | null | undefined) => (values && values.length > 0 ? [...new Set(values)].sort() : null);

/** Whether two drafts would run the same search: airport and cabin order and repeats do not count; the typed text does not either. */
export function sameDraft(a: QueryDraft, b: QueryDraft): boolean {
  const key = (d: QueryDraft) =>
    JSON.stringify({
      origins: sortedUnique(d.query.origins),
      destinations: sortedUnique(d.query.destinations),
      cabins: sortedUnique(d.query.cabins),
      programs: sortedUnique(d.query.programs),
      direct_only: d.query.direct_only,
      include_filtered: d.query.include_filtered,
      min_cabin_pct: d.query.min_cabin_pct,
      max_miles: d.query.max_miles ?? null,
      sort_by: d.query.sort_by,
      dates: d.dates.kind === "fixed" ? ["fixed", d.dates.from, d.dates.to] : ["relative", d.dates.days, d.dates.clock],
    });
  return key(a) === key(b);
}

// ---- places ------------------------------------------------------------------------------------------------

export type EditorLanguage = "en" | "zh";

export interface PlaceOption {
  /** The code the person picks: a metro (TYO) or an airport (NRT). */
  code: string;
  kind: "metro" | "airport";
  /** The airports it adds to the query, in the seed's order of preference. */
  airports: string[];
  /** A city name in the requested language; the code itself when the seed names none. */
  name: string;
}

const CJK = /[㐀-鿿]/;

interface PlaceIndex {
  names: Map<string, { en: string | null; zh: string | null }>;
  /** For a metro whose code is also one of its airports (SHA): the airport's own names, when the seed has them. */
  sharedAirportNames: Map<string, { en: string | null; zh: string | null }>;
  metroOf: Map<string, string>;
  codes: string[];
}

const indexes = new WeakMap<Places, PlaceIndex>();

function titleCase(s: string): string {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

function indexOf(places: Places): PlaceIndex {
  const cached = indexes.get(places);
  if (cached) return cached;
  const names = new Map<string, { en: string | null; zh: string | null }>();
  const sharedAirportNames = new Map<string, { en: string | null; zh: string | null }>();
  // Seed order: the first English alias and the first Chinese alias for a code are its names. For a code that is
  // both a metro and one of its airports (SHA: 上海, shanghai, 虹桥, 虹橋, hongqiao), the aliases after the metro's
  // English name are the airport's own.
  for (const [alias, code] of Object.entries(places.aliases)) {
    const entry = names.get(code) ?? { en: null, zh: null };
    const city = places.cities[code];
    const shared = city !== undefined && city.length > 1 && city.includes(code);
    const cjk = CJK.test(alias);
    const english = !cjk && !/^[a-z]{3}$/.test(alias);
    if (shared && entry.en !== null) {
      const airport = sharedAirportNames.get(code) ?? { en: null, zh: null };
      if (cjk) airport.zh ??= alias;
      else if (english) airport.en ??= titleCase(alias);
      sharedAirportNames.set(code, airport);
    }
    if (cjk) entry.zh ??= alias;
    else if (english) entry.en ??= titleCase(alias);
    names.set(code, entry);
  }
  const metroOf = new Map<string, string>();
  for (const [metro, airports] of Object.entries(places.cities)) for (const a of airports) if (a !== metro) metroOf.set(a, metro);
  const codes = [...places.knownCodes].sort();
  const index = { names, sharedAirportNames, metroOf, codes };
  indexes.set(places, index);
  return index;
}

/**
 * A place's name in the language asked: its own, else its metro's, else the code. `as: "airport"` names a code that
 * is also a metro (SHA) as the airport (Hongqiao) where the seed says so; chips name airports, so they ask for that.
 */
export function placeName(code: string, lang: EditorLanguage, places: Places = DEFAULT_PLACES, as: "place" | "airport" = "place"): string {
  const index = indexOf(places);
  if (as === "airport") {
    const airport = index.sharedAirportNames.get(code)?.[lang];
    if (airport) return airport;
  }
  const own = index.names.get(code)?.[lang];
  if (own) return own;
  const metro = index.metroOf.get(code);
  const metroName = metro ? index.names.get(metro)?.[lang] : null;
  return metroName ?? code;
}

/**
 * Options for what the person typed: codes by prefix, names (either language) by prefix or by contained word.
 * Metros come first with their airports spelled out, then each of their airports; at most `limit` options.
 * Typing never sends anything.
 */
export function placeOptions(input: string, lang: EditorLanguage, places: Places = DEFAULT_PLACES, limit = 8): PlaceOption[] {
  const needle = normalizeAlias(input);
  if (needle === "") return [];
  const index = indexOf(places);
  const matched = new Set<string>();
  const upper = needle.toUpperCase();
  for (const code of index.codes) if (code.startsWith(upper)) matched.add(code);
  for (const [alias, code] of Object.entries(places.aliases)) {
    if (alias.startsWith(needle) || (needle.length >= 2 && alias.split(" ").some((w) => w.startsWith(needle)))) matched.add(code);
  }
  const options: PlaceOption[] = [];
  const has = (kind: PlaceOption["kind"], code: string) => options.some((o) => o.kind === kind && o.code === code);
  const addMetro = (code: string, city: string[]) => {
    if (!has("metro", code)) options.push({ code, kind: "metro", airports: [...city], name: placeName(code, lang, places) });
  };
  const addAirport = (code: string) => {
    if (!has("airport", code)) options.push({ code, kind: "airport", airports: [code], name: placeName(code, lang, places, "airport") });
  };
  const ordered = [...matched].sort((a, b) => Number(b.toLowerCase() === needle) - Number(a.toLowerCase() === needle) || a.localeCompare(b));
  for (const code of ordered) {
    const city = places.cities[code];
    if (city && !(city.length === 1 && city[0] === code)) {
      // A metro, then each of its airports — including one that shares the metro's code (SHA, BKK), which is
      // offered on its own too, so a single airport can be chosen.
      addMetro(code, city);
      for (const airport of city) addAirport(airport);
    } else addAirport(code);
  }
  return options.slice(0, limit);
}

// ---- cabins ------------------------------------------------------------------------------------------------

const CABIN_NAMES: Record<Cabin, Record<EditorLanguage, string>> = {
  J: { en: "Business", zh: "商务舱" },
  F: { en: "First", zh: "头等舱" },
  W: { en: "Premium economy", zh: "超经舱" },
  Y: { en: "Economy", zh: "经济舱" },
};

export function cabinName(cabin: Cabin, lang: EditorLanguage): string {
  return CABIN_NAMES[cabin][lang];
}

const CABIN_ORDER: readonly Cabin[] = ["Y", "W", "J", "F"];

type Describable = Pick<QueryObject, "origins" | "destinations" | "date_from" | "date_to" | "cabins"> &
  Partial<Pick<QueryObject, "direct_only" | "programs" | "max_miles">>;

/**
 * A plain sentence for a structured query, used as its `raw_text` when the editor built it: the text a query carries
 * must describe that query, not the words typed before its fields were edited. It says everything the deterministic
 * parser can read back — airports, the date rule ("next 30 days" stays a rolling window), cabins, nonstop, programs,
 * a mileage cap. Whether it does read back exactly is `textReproducesQuery`'s job: the mixed-cabin threshold and
 * dynamic pricing have no words, and a lone airport that shares its city's code (SHA) reads back as the city.
 */
export function describeQuery(query: Describable, dates?: DateRule): string {
  const cabins = CABIN_ORDER.filter((c) => query.cabins.includes(c)).map((c) => CABIN_NAMES[c].en.toLowerCase());
  const when = dates?.kind === "relative_days" ? `next ${dates.days} days` : `${query.date_from} to ${query.date_to}`;
  const parts = [`${query.origins.join(", ")} to ${query.destinations.join(", ")}`, when, cabins.join(" and ")];
  if (query.direct_only) parts.push("nonstop");
  const programs = (query.programs ?? []).filter((p): p is SeatsSource => p in SOURCE_NAMES);
  if (programs.length > 0) parts.push(`on ${programs.map((p) => SOURCE_NAMES[p]).join(" and ")}`);
  if (query.max_miles !== undefined && query.max_miles !== null) parts.push(`under ${query.max_miles} miles`);
  return parts.join(", ");
}

/**
 * Whether reading `text` again, as it would have been read on `madeOn`, gives this query: same airports, dates,
 * cabins, nonstop, programs, mileage cap, mixed-cabin threshold and dynamic pricing. Read with the deterministic
 * parser only (no LLM, nothing sent). The Search screen uses it to decide whether its text box can stand for the
 * search on screen — for Run and for a text watch — or whether the structured query has to be used instead.
 */
export function textReproducesQuery(text: string, query: QueryObject, madeOn: ISODate, places: Places = DEFAULT_PLACES): boolean {
  if (!isRealDate(madeOn) || text.trim() === "") return false;
  let read;
  try {
    read = parseDeterministic(text, { today: madeOn, places });
  } catch {
    return false;
  }
  if (read.missing.length > 0) return false;
  const p = read.partial;
  const same = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined) => JSON.stringify(sortedUnique(a)) === JSON.stringify(sortedUnique(b));
  return (
    same(p.origins, query.origins) &&
    same(p.destinations, query.destinations) &&
    p.date_from === query.date_from &&
    p.date_to === query.date_to &&
    same(p.cabins ?? DEFAULT_CABINS, query.cabins) &&
    (p.direct_only ?? false) === query.direct_only &&
    same(p.programs, query.programs) &&
    (p.max_miles ?? null) === (query.max_miles ?? null) &&
    (p.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT) === query.min_cabin_pct &&
    (p.include_filtered ?? false) === query.include_filtered
  );
}
