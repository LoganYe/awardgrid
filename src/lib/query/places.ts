/**
 * Places seed (data/places.json): metro → airports plus zh/en aliases (kickoff §4.2).
 *
 * Responsibilities:
 *   - validate the seed with zod at load time (a broken edit fails loudly, not with a blank grid)
 *   - expandPlace(code): metro or airport → airports (seed order = preference order)
 *   - resolveAlias(text): one alias / raw code → metro or airport code
 *   - findPlaceMentions(text): every alias / raw code in free text, in order, with offsets
 *   - splitPlaces(text): origins vs destinations using "to"/"from" markers
 *
 * Raw IATA rule (documented, tested): a bare 3-letter code is recognised ONLY when written in
 * upper case ("SEA"), so the English word "sea" (or "can", "den", "las", …) is never an airport.
 * Lower-case input must use a city name or alias; the chip UI is the fallback.
 */
import { z } from "zod";
import seed from "../../../data/places.json";

const CODE = z.string().regex(/^[A-Z]{3}$/);

export const PlacesSeed = z.object({
  cities: z.record(CODE, z.array(CODE).min(1)),
  aliases: z.record(z.string().min(1), CODE),
});
export type PlacesSeed = z.infer<typeof PlacesSeed>;

export interface Places {
  cities: Record<string, string[]>;
  /** normalised alias (lower-case, trimmed) → code */
  aliases: Record<string, string>;
  /** every metro key and every airport listed under a metro */
  knownCodes: Set<string>;
}

export function normalizeAlias(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Validate a raw seed object and index it. Exported so tests / the CLI can load an alternate seed. */
export function buildPlaces(raw: unknown): Places {
  const parsed = PlacesSeed.parse(raw);
  const aliases: Record<string, string> = {};
  for (const [alias, code] of Object.entries(parsed.aliases)) {
    aliases[normalizeAlias(alias)] = code;
  }
  const knownCodes = new Set<string>();
  for (const [metro, airports] of Object.entries(parsed.cities)) {
    knownCodes.add(metro);
    for (const a of airports) knownCodes.add(a);
  }
  for (const code of Object.values(parsed.aliases)) knownCodes.add(code);
  return { cities: parsed.cities, aliases, knownCodes };
}

/** The bundled seed, validated once at import. */
export const DEFAULT_PLACES: Places = buildPlaces(seed);

/**
 * Metro or airport code → airports. Unknown codes that look like IATA are passed through as a
 * single airport (the LLM may emit airports outside the seed; the grid still works).
 * Note: "SHA" is both the Shanghai metro and Hongqiao airport in the seed, so it expands to the
 * metro (PVG, SHA) — matches the kickoff's "上海 → PVG+SHA" and is what users usually mean.
 */
export function expandPlace(code: string, places: Places = DEFAULT_PLACES): string[] {
  const upper = code.toUpperCase();
  const city = places.cities[upper];
  if (city) return [...city];
  if (/^[A-Z]{3}$/.test(upper)) return [upper];
  return [];
}

/**
 * Resolve one place token to a metro/airport code.
 * Aliases are case-insensitive; raw codes only when upper-case (see file header).
 */
export function resolveAlias(text: string, places: Places = DEFAULT_PLACES): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const alias = places.aliases[normalizeAlias(trimmed)];
  if (alias) return alias;
  if (/^[A-Z]{3}$/.test(trimmed) && places.knownCodes.has(trimmed)) return trimmed;
  return null;
}

export interface PlaceMention {
  /** metro or airport code the mention resolved to */
  code: string;
  /** the exact substring matched */
  matched: string;
  start: number;
  /** exclusive */
  end: number;
}

interface Candidate extends PlaceMention {
  priority: number;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Latin aliases need word boundaries ("seattle" must not fire inside "seattlewa"); CJK ones do not. */
function isLatin(alias: string): boolean {
  return /^[a-z0-9 .'-]+$/i.test(alias);
}

interface CompiledAlias {
  alias: string;
  code: string;
  re: RegExp;
}

const compiledCache = new WeakMap<Places, CompiledAlias[]>();

function compileAliases(places: Places): CompiledAlias[] {
  const cached = compiledCache.get(places);
  if (cached) return cached;
  const out: CompiledAlias[] = [];
  for (const [alias, code] of Object.entries(places.aliases)) {
    const body = escapeRe(alias).replace(/ /g, "\\s+");
    const re = isLatin(alias)
      ? new RegExp(`(?<![A-Za-z])${body}(?![A-Za-z])`, "gi")
      : new RegExp(body, "g");
    out.push({ alias, code, re });
  }
  // longest first so "san francisco" beats "san", "新加坡" beats nothing shorter, etc.
  out.sort((a, b) => b.alias.length - a.alias.length);
  compiledCache.set(places, out);
  return out;
}

const RAW_CODE_RE = /(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])/g;

/**
 * Every place mention in `text`, left to right, non-overlapping (longest match wins).
 * Offsets are JS string indices into `text` (so callers can slice the gaps between mentions).
 */
export function findPlaceMentions(text: string, places: Places = DEFAULT_PLACES): PlaceMention[] {
  const candidates: Candidate[] = [];
  for (const { re, code, alias } of compileAliases(places)) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      candidates.push({ code, matched: m[0], start: m.index, end: m.index + m[0].length, priority: alias.length });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  RAW_CODE_RE.lastIndex = 0;
  for (let m = RAW_CODE_RE.exec(text); m !== null; m = RAW_CODE_RE.exec(text)) {
    if (places.knownCodes.has(m[0])) {
      candidates.push({ code: m[0], matched: m[0], start: m.index, end: m.index + 3, priority: 3 });
    }
  }
  // Greedy left-to-right, longest-first overlap resolution.
  candidates.sort((a, b) => a.start - b.start || b.priority - a.priority);
  const out: PlaceMention[] = [];
  let cursor = -1;
  for (const c of candidates) {
    if (c.start < cursor) continue;
    out.push({ code: c.code, matched: c.matched, start: c.start, end: c.end });
    cursor = c.end;
  }
  return out;
}

/**
 * Direction markers. "to"-markers switch the bucket to destinations, "from"-markers back to
 * origins. The dash/arrow family only counts when it is the *whole* gap between two mentions
 * ("HKG - SEA"), so "Oct 1 - Oct 15" and "2026-10-01" never split places.
 */
const TO_WORD_RE = /(?<![A-Za-z])to(?![A-Za-z])|飞往|前往|飞去|到达|到|至|飞|去|往/gi;
const FROM_WORD_RE = /(?<![A-Za-z])from(?![A-Za-z])|从|從|由/gi;
const ARROW_GAP_RE = /^[\s,，、]*(?:→|->|-|—|–|~)[\s,，、]*$/;

type Bucket = "origins" | "destinations";

function lastMarker(gap: string): Bucket | null {
  let bucket: Bucket | null = null;
  let best = -1;
  TO_WORD_RE.lastIndex = 0;
  for (let m = TO_WORD_RE.exec(gap); m !== null; m = TO_WORD_RE.exec(gap)) {
    if (m.index > best) {
      best = m.index;
      bucket = "destinations";
    }
  }
  FROM_WORD_RE.lastIndex = 0;
  for (let m = FROM_WORD_RE.exec(gap); m !== null; m = FROM_WORD_RE.exec(gap)) {
    if (m.index > best) {
      best = m.index;
      bucket = "origins";
    }
  }
  if (bucket === null && ARROW_GAP_RE.test(gap)) bucket = "destinations";
  return bucket;
}

/** True when the prefix before the first mention ends with a to/from marker (only punctuation/space between). */
function prefixMarker(prefix: string): Bucket | null {
  const m = /(?:(?<![A-Za-z])to|飞往|前往|飞去|到|至|飞|去|往|→|->)[\s,，、]*$/i.exec(prefix);
  if (m) return "destinations";
  const f = /(?:(?<![A-Za-z])from|从|從|由)[\s,，、]*$/i.exec(prefix);
  if (f) return "origins";
  return null;
}

export interface SplitPlaces {
  mentions: PlaceMention[];
  origins: PlaceMention[];
  destinations: PlaceMention[];
}

/**
 * Bucket mentions into origins/destinations.
 * Rule (kickoff §4.2 + task): text before the "to"-marker = origins, after = destinations;
 * "from X" flips back to origins so "to SEA from HKG" also works; "去西雅图" with nothing before
 * it yields origins = [] (caller reports them as missing).
 */
export function splitPlaces(text: string, places: Places = DEFAULT_PLACES): SplitPlaces {
  const mentions = findPlaceMentions(text, places);
  const origins: PlaceMention[] = [];
  const destinations: PlaceMention[] = [];
  if (mentions.length === 0) return { mentions, origins, destinations };

  const first = mentions[0]!;
  let bucket: Bucket = prefixMarker(text.slice(0, first.start)) ?? "origins";
  for (let i = 0; i < mentions.length; i++) {
    const m = mentions[i]!;
    if (i > 0) {
      const prev = mentions[i - 1]!;
      const gap = text.slice(prev.end, m.start);
      bucket = lastMarker(gap) ?? bucket;
    }
    (bucket === "origins" ? origins : destinations).push(m);
  }
  return { mentions, origins, destinations };
}

/** Expand a list of mentions to airports, deduplicated, order preserved. */
export function expandMentions(mentions: PlaceMention[], places: Places = DEFAULT_PLACES): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of mentions) {
    for (const a of expandPlace(m.code, places)) {
      if (!seen.has(a)) {
        seen.add(a);
        out.push(a);
      }
    }
  }
  return out;
}
