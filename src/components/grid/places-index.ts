/**
 * Search index over the places seed (`data/places.json`) for the Origins / Destinations chip
 * editors (Phase 6 §3.2, docs/UI_PLAN.md §6.2a).
 *
 * The seed is metro → airports plus zh/en aliases. This module turns it into two things the
 * editor needs and the parser does not:
 *   - `searchPlaces`   type "shanghai", "上海", "PVG" or "SH" and get rows to click
 *   - `groupForEditor` the selected airports as city rows (`SHA  Shanghai  ▸ PVG ✓ SHA ✓`),
 *                      single-airport cities as their own row
 * plus the pure toggles behind those rows and the free-IATA-entry check.
 *
 * Metro resolution rule: an airport belongs to the first seed city that lists it AND lists more
 * than one airport; otherwise it is its own city. That is what keeps `ORD` under `CHI` (the seed
 * has both `CHI: [ORD, MDW]` and a single-airport `ORD` city) and `SHA` under `SHA` (Shanghai
 * doubles as a metro code and Hongqiao's airport code).
 *
 * Nothing here mutates its inputs; `toggle*` return new arrays. Neither toggle enforces the
 * "at least one airport" rule — that is validation, and it lives in chips-model.ts, so the
 * editor can show the empty state with its error instead of silently refusing a click.
 */
import { DEFAULT_PLACES, normalizeAlias, type Places } from "@/lib/query/places";

export type PlaceKind = "metro" | "airport";

export interface PlaceEntry {
  /** Three-letter upper-case code (a metro code or an airport code). */
  code: string;
  kind: PlaceKind;
  /** The city row this airport belongs to. Set on airports only. */
  metro?: string;
  /** Aliases from the seed, Latin spellings first, then Chinese. May be empty (e.g. `PVG`). */
  names: string[];
}

export interface PlacesIndex {
  /** Every code in the seed, metros first, then airports; stable seed order within each group. */
  entries: readonly PlaceEntry[];
  byCode: ReadonlyMap<string, PlaceEntry>;
  /** City row → its airports in seed order. */
  metroAirports: ReadonlyMap<string, readonly string[]>;
  /** Airport → its city row. */
  airportMetro: ReadonlyMap<string, string>;
}

const CODE_RE = /^[A-Z]{3}$/;
const LATIN_RE = /^[a-z0-9 .'-]+$/i;

/** Which seed city owns `code`: a multi-airport city if one lists it, else the code itself. */
function resolveMetro(code: string, cities: Record<string, string[]>): string {
  let single: string | null = null;
  for (const [metro, airports] of Object.entries(cities)) {
    if (!airports.includes(code)) continue;
    if (airports.length > 1) return metro;
    single ??= metro;
  }
  return single ?? code;
}

export function buildPlacesIndex(places: Places = DEFAULT_PLACES): PlacesIndex {
  const cities = places.cities;

  // alias lists per code, Latin spellings before Chinese ones so names[0] reads as a label.
  const latin = new Map<string, string[]>();
  const cjk = new Map<string, string[]>();
  for (const [alias, code] of Object.entries(places.aliases)) {
    const bucket = LATIN_RE.test(alias) ? latin : cjk;
    const list = bucket.get(code) ?? [];
    list.push(alias);
    bucket.set(code, list);
  }
  const namesOf = (code: string): string[] => [...(latin.get(code) ?? []), ...(cjk.get(code) ?? [])];

  // Every code the seed knows: city keys plus every airport listed under one.
  const allCodes: string[] = [];
  for (const [metro, airports] of Object.entries(cities)) {
    if (!allCodes.includes(metro)) allCodes.push(metro);
    for (const a of airports) if (!allCodes.includes(a)) allCodes.push(a);
  }

  const airportMetro = new Map<string, string>();
  for (const code of allCodes) airportMetro.set(code, resolveMetro(code, cities));

  // City rows keep the seed's own airport order (preference order: NRT before HND).
  const metroAirports = new Map<string, string[]>();
  for (const [metro, airports] of Object.entries(cities)) {
    for (const a of airports) {
      if (airportMetro.get(a) !== metro) continue;
      const list = metroAirports.get(metro) ?? [];
      if (!list.includes(a)) list.push(a);
      metroAirports.set(metro, list);
    }
  }
  for (const code of allCodes) {
    const metro = airportMetro.get(code)!;
    if (!metroAirports.has(metro)) metroAirports.set(metro, [metro === code ? code : metro]);
  }

  const metros: PlaceEntry[] = [];
  const airports: PlaceEntry[] = [];
  for (const code of allCodes) {
    const isMetro = (metroAirports.get(code)?.length ?? 0) > 1;
    if (isMetro) {
      metros.push({ code, kind: "metro", names: namesOf(code) });
    } else {
      const metro = airportMetro.get(code)!;
      airports.push({ code, kind: "airport", metro, names: namesOf(code) });
    }
  }
  const entries = [...metros, ...airports];
  const byCode = new Map(entries.map((e) => [e.code, e]));
  return { entries, byCode, metroAirports, airportMetro };
}

/** The bundled seed, indexed once at import. */
export const DEFAULT_PLACES_INDEX: PlacesIndex = buildPlacesIndex();

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Most rows a chip editor list shows at once (spec §3.2). */
export const MAX_SEARCH_RESULTS = 12;

/**
 * Rank, best first: an exact IATA code, a code prefix, an alias prefix, an alias substring, a
 * code substring. Cities outrank airports at equal rank, then codes sort alphabetically.
 * `Infinity` means "no match".
 */
function score(entry: PlaceEntry, lower: string, upper: string, codeShaped: boolean): number {
  if (codeShaped && entry.code === upper) return 0;
  if (codeShaped && entry.code.startsWith(upper)) return 1;
  if (entry.names.some((n) => n.startsWith(lower))) return 2;
  if (entry.names.some((n) => n.includes(lower))) return 3;
  if (codeShaped && entry.code.includes(upper)) return 4;
  return Infinity;
}

/**
 * Case-insensitive search over codes and aliases. An empty query returns nothing (the editor
 * shows the current selection instead of a wall of cities).
 */
export function searchPlaces(query: string, index: PlacesIndex = DEFAULT_PLACES_INDEX, limit = MAX_SEARCH_RESULTS): PlaceEntry[] {
  const trimmed = normalizeAlias(query);
  if (trimmed.length === 0) return [];
  const upper = trimmed.toUpperCase();
  const codeShaped = /^[a-z]+$/i.test(trimmed) && trimmed.length <= 3;
  const ranked: Array<{ entry: PlaceEntry; rank: number }> = [];
  for (const entry of index.entries) {
    const rank = score(entry, trimmed, upper, codeShaped);
    if (rank !== Infinity) ranked.push({ entry, rank });
  }
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.entry.kind === b.entry.kind ? 0 : a.entry.kind === "metro" ? -1 : 1) ||
      a.entry.code.localeCompare(b.entry.code),
  );
  return ranked.slice(0, Math.max(0, limit)).map((r) => r.entry);
}

/** "hong kong" → "Hong Kong". Aliases are stored normalised, so the editor title-cases them. */
function titleCase(alias: string): string {
  return alias.replace(/(^|[\s'-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * The name to show beside a code: a Chinese alias in the zh UI, a title-cased Latin alias in
 * the en UI, and the code itself when the seed has no alias for it (e.g. `PVG`).
 */
export function placeLabel(entry: PlaceEntry | undefined, locale: "en" | "zh"): string {
  if (!entry) return "";
  const cjk = entry.names.find((n) => /[㐀-䶿一-鿿]/.test(n));
  const latin = entry.names.find((n) => LATIN_RE.test(n));
  const picked = locale === "zh" ? (cjk ?? latin) : (latin ?? cjk);
  if (picked === undefined) return entry.code;
  return LATIN_RE.test(picked) ? titleCase(picked) : picked;
}

// ---------------------------------------------------------------------------
// Editor rows
// ---------------------------------------------------------------------------

export interface EditorAirport {
  code: string;
  selected: boolean;
}

export interface EditorRow {
  /** The city row's code (`SHA`, `TYO`, or the airport code for a single-airport city). */
  metro: string;
  /** Every airport of the city, in seed order, each flagged with its selection. */
  airports: EditorAirport[];
  /** "all" when every airport of the city is selected, "some" otherwise. */
  state: "all" | "some";
  /** True when the code is not in the seed at all (free IATA entry). */
  unknown: boolean;
}

/**
 * The selected airports as city rows, in the order the cities first appear in `selectedAirports`
 * (the query's preference order). Every airport of a selected city is listed, selected or not,
 * so the editor can offer `+ HND` in place. Codes outside the seed become their own row.
 */
export function groupForEditor(selectedAirports: readonly string[], index: PlacesIndex = DEFAULT_PLACES_INDEX): EditorRow[] {
  const selected = new Set(selectedAirports);
  const rows: EditorRow[] = [];
  const seen = new Set<string>();
  for (const code of selectedAirports) {
    const known = index.byCode.has(code);
    const metro = index.airportMetro.get(code) ?? code;
    if (seen.has(metro)) continue;
    seen.add(metro);
    const members = index.metroAirports.get(metro) ?? [code];
    const airports = members.map((a) => ({ code: a, selected: selected.has(a) }));
    rows.push({
      metro,
      airports,
      state: airports.every((a) => a.selected) ? "all" : "some",
      unknown: !known,
    });
  }
  return rows;
}

/**
 * Group toggle: every airport of the city selected → remove them all; otherwise add the missing
 * ones after the codes already there (seed order preserved).
 */
export function toggleMetro(selected: readonly string[], metro: string, index: PlacesIndex = DEFAULT_PLACES_INDEX): string[] {
  const members = index.metroAirports.get(metro) ?? [metro];
  const all = members.every((a) => selected.includes(a));
  if (all) return selected.filter((code) => !members.includes(code));
  return [...selected, ...members.filter((a) => !selected.includes(a))];
}

/** Per-airport toggle: present → removed; absent → appended. */
export function toggleAirport(selected: readonly string[], code: string, _index: PlacesIndex = DEFAULT_PLACES_INDEX): string[] {
  return selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code];
}

// ---------------------------------------------------------------------------
// Free IATA entry
// ---------------------------------------------------------------------------

export interface FreeEntryResult {
  /** The upper-cased code, or null when the input is not three letters. */
  code: string | null;
  /** "format" when the input is not three letters; null when it is usable. */
  error: "format" | null;
  /** True for a well-formed code the seed does not know: allowed, but flagged. */
  unknown: boolean;
  /** True when the code is already in `selected`. */
  duplicate: boolean;
}

/**
 * Free IATA entry: three letters, upper-cased. Unknown codes are allowed (seats.aero covers
 * airports the seed does not) but come back flagged so the editor can say "not in the places
 * list" beside the row.
 */
export function validateFreeEntry(
  input: string,
  selected: readonly string[] = [],
  index: PlacesIndex = DEFAULT_PLACES_INDEX,
): FreeEntryResult {
  const code = input.trim().toUpperCase();
  if (!CODE_RE.test(code)) return { code: null, error: "format", unknown: false, duplicate: false };
  return { code, error: null, unknown: !index.byCode.has(code), duplicate: selected.includes(code) };
}
