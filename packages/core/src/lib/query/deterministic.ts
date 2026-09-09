/**
 * Deterministic NL → partial QueryObject (kickoff §4.2: "deterministic first, LLM second").
 *
 * Everything here is regex + the places seed; no clock, no network. Fields it cannot produce are
 * listed in `missing` so parse.ts can decide whether the LLM (or the UI) fills them.
 */
import { SEATS_SOURCES, type SeatsSource } from "../seatsaero/types";
import { notice, noticesToText, type Notice } from "../notices";
import { parseDates } from "./dates";
import { detectLanguage } from "./language";
import { DEFAULT_PLACES, expandMentions, splitPlaces, type Places } from "./places";
import { type Cabin, DEFAULT_CABINS, MAX_SPAN_DAYS, type QueryObjectInput, type SortBy } from "./schema";

export type Provenance = "deterministic" | "llm" | "default";
export type MissingField = "origins" | "destinations" | "date_from" | "date_to";

export interface DeterministicResult {
  partial: Partial<QueryObjectInput>;
  missing: MissingField[];
  provenance: Record<string, Provenance>;
  /** Human-readable notes in English (e.g. the 92-day cap was applied) — `notices` rendered. */
  warnings: string[];
  /** The same notes as {code, vars}, for translation in the UI. */
  notices: Notice[];
}

export interface DeterministicOptions {
  /** ISO date, injected — never Date.now() */
  today: string;
  places?: Places;
}

// ---------------------------------------------------------------------------------------------
// Programs. Only names we can back with SEATS_SOURCES; anything else (国航, Cathay, …) is omitted.
// Patterns are matched on the ORIGINAL text; the matched spans are then blanked before place
// scanning so "新加坡航空" does not also read as the city Singapore.
// ---------------------------------------------------------------------------------------------

const PROGRAM_PATTERNS: ReadonlyArray<readonly [SeatsSource, RegExp]> = [
  ["aeroplan", /aeroplan|air\s*canada|加航|加拿大航空/gi],
  ["united", /(?<![a-z])united(?![a-z])|mileage\s*plus|美联航|美聯航|联合航空|聯合航空/gi],
  ["american", /(?<![A-Za-z])AA(?![A-Za-z])|aadvantage|american\s+airlines|(?<![a-z])american(?!\s+express)(?![a-z])|美国航空|美國航空|美航/gi],
  ["alaska", /alaska|mileage\s*plan|atmos\s*rewards|阿拉斯加/gi],
  ["delta", /(?<![a-z])delta(?![a-z])|skymiles|达美|達美/gi],
  ["flyingblue", /flying\s*blue|air\s*france|(?<![a-z])klm(?![a-z])|法航|荷航|法荷航/gi],
  ["virginatlantic", /virgin\s*atlantic|flying\s*club|维珍航空|維珍航空|维珍|維珍/gi],
  ["velocity", /virgin\s*australia|(?<![a-z])velocity(?![a-z])/gi],
  ["qantas", /qantas|澳航|澳洲航空/gi],
  ["singapore", /krisflyer|singapore\s+airlines|新航|新加坡航空/gi],
  ["emirates", /emirates|skywards|阿联酋航空|阿聯酋航空|阿联酋|阿聯酋/gi],
  ["etihad", /etihad|阿提哈德/gi],
  ["qatar", /qatar|privilege\s*club|卡塔尔航空|卡達航空|卡航/gi],
  ["turkish", /turkish|miles\s*&\s*smiles|miles\s*and\s*smiles|土航|土耳其航空/gi],
  ["lufthansa", /lufthansa|miles\s*&\s*more|miles\s*and\s*more|汉莎|漢莎/gi],
  ["finnair", /finnair|芬航|芬兰航空|芬蘭航空/gi],
  ["eurobonus", /eurobonus|(?<![A-Za-z])SAS(?![A-Za-z])|北欧航空|北歐航空/g],
  ["jetblue", /jetblue|trueblue|捷蓝|捷藍/gi],
  ["aeromexico", /aeromexico|club\s*premier|墨西哥航空/gi],
  ["azul", /(?<![a-z])azul(?![a-z])|tudoazul/gi],
  ["smiles", /(?<![a-z])gol(?![a-z])/gi],
  ["connectmiles", /connectmiles|(?<![a-z])copa(?![a-z])/gi],
  ["ethiopian", /ethiopian|shebamiles/gi],
  ["saudia", /saudia|alfursan/gi],
  ["frontier", /frontier/gi],
  ["spirit", /(?<![a-z])spirit(?![a-z])/gi],
];

interface ProgramScan {
  programs: SeatsSource[];
  /** text with program mentions replaced by spaces (same length → offsets preserved) */
  masked: string;
}

function scanPrograms(text: string): ProgramScan {
  const found: { code: SeatsSource; at: number }[] = [];
  let masked = text;
  for (const [code, re] of PROGRAM_PATTERNS) {
    if (!SEATS_SOURCES.includes(code)) continue; // belt and braces: never emit an unknown source
    re.lastIndex = 0;
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      found.push({ code, at: m.index });
      masked = masked.slice(0, m.index) + " ".repeat(m[0].length) + masked.slice(m.index + m[0].length);
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  found.sort((a, b) => a.at - b.at);
  const programs: SeatsSource[] = [];
  for (const f of found) if (!programs.includes(f.code)) programs.push(f.code);
  return { programs, masked };
}

// ---------------------------------------------------------------------------------------------
// Cabins
// ---------------------------------------------------------------------------------------------

/**
 * Word patterns are case-insensitive; the standalone letter (F/J/W/Y) must be upper-case and
 * not part of a word, so "f" in "flights for" never becomes first class.
 */
const CABIN_WORDS: ReadonlyArray<readonly [Cabin, RegExp]> = [
  ["W", /超经|超經|超級經濟|超级经济|豪华经济|豪華經濟|premium\s*economy|(?<![a-z])premium(?![a-z])/i],
  ["F", /头等|頭等|first\s*class|(?<![a-z])first(?![a-z])/i],
  ["J", /商务|商務|公务舱|公務艙|business/i],
  ["Y", /经济|經濟|economy|(?<![a-z])coach(?![a-z])/i],
];
const PREMIUM_ECONOMY_RE = /premium\s*economy|超级经济|超級經濟|豪华经济|豪華經濟/gi;

/** Canonical order Y,W,J,F so "商务或头等" and "first or business" both yield ["J","F"]. */
const CABIN_ORDER: Cabin[] = ["Y", "W", "J", "F"];

export function parseCabins(text: string): Cabin[] {
  const found = new Set<Cabin>();
  let rest = text;
  for (const [cabin, re] of CABIN_WORDS) {
    if (re.test(rest)) {
      found.add(cabin);
      // Consume "premium economy" so it does not also read as economy.
      if (cabin === "W") rest = rest.replace(PREMIUM_ECONOMY_RE, " ");
    }
  }
  for (const cabin of CABIN_ORDER) {
    if (new RegExp(`(?<![A-Za-z])${cabin}(?![A-Za-z])`).test(rest)) found.add(cabin);
  }
  return CABIN_ORDER.filter((c) => found.has(c));
}

// ---------------------------------------------------------------------------------------------
// max_miles
// ---------------------------------------------------------------------------------------------

const AMOUNT = "(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*(万|萬|k|K)?\\s*(?:miles?|里程|英里|points?|pts|里|分|mi)?";
const BEFORE = new RegExp(
  `(?:under|below|max(?:imum)?|at\\s+most|up\\s+to|<=|<|less\\s+than|no\\s+more\\s+than|不超过|不超過|最多|低于|低於|少于|少於)\\s*${AMOUNT}`,
  "i",
);
const AFTER = new RegExp(`${AMOUNT}\\s*(?:以内|以內|以下|之内|之內|内|內|or\\s+less|or\\s+under|max)`, "i");

function toMiles(numStr: string, unit: string | undefined, hasUnitWord: boolean): number | null {
  const n = Number(numStr.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (unit === "万" || unit === "萬") return Math.round(n * 10_000);
  if (unit === "k" || unit === "K") return Math.round(n * 1_000);
  // A bare number is only miles when it is at least 1,000 or a unit word followed it ("under 3 stops" is not).
  if (!hasUnitWord && n < 1000) return null;
  return Math.round(n);
}

export function parseMaxMiles(text: string): number | null {
  for (const re of [BEFORE, AFTER]) {
    const m = re.exec(text);
    if (!m || m[1] === undefined) continue;
    const hasUnitWord = /miles?|里程|英里|points?|pts|里|分|mi\b/i.test(m[0].slice(m[0].indexOf(m[1]) + m[1].length));
    const v = toMiles(m[1], m[2], hasUnitWord);
    if (v !== null && v > 0) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// sort_by / direct_only
// ---------------------------------------------------------------------------------------------

export function parseSortBy(text: string): SortBy | null {
  if (/税费最低|稅費最低|税最低|稅最低|手续费最低|手續費最低|费用最低|lowest\s+(?:fees?|tax(?:es)?|surcharges?)|cheapest\s+(?:fees?|tax(?:es)?)|least\s+(?:fees?|tax(?:es)?)/i.test(text)) return "fees_asc";
  if (/座位最多|位子最多|most\s+seats|max(?:imum)?\s+seats/i.test(text)) return "seats_desc";
  if (/最早|earliest|soonest/i.test(text)) return "date_asc";
  if (/最便宜|最低里程|最少里程|里程最少|里程最低|cheapest|lowest\s+(?:miles|points)|fewest\s+(?:miles|points)/i.test(text)) return "miles_asc";
  return null;
}

export function parseDirectOnly(text: string): boolean {
  return /直飞|直飛|直航|nonstop|non-stop|non\s+stop|(?<![a-z])direct(?![a-z])/i.test(text);
}

// ---------------------------------------------------------------------------------------------

export function parseDeterministic(text: string, opts: DeterministicOptions): DeterministicResult {
  const places = opts.places ?? DEFAULT_PLACES;
  const provenance: Record<string, Provenance> = {};
  const partial: Partial<QueryObjectInput> = { raw_text: text };
  const missing: MissingField[] = [];
  const notices: Notice[] = [];

  const { programs, masked } = scanPrograms(text);
  if (programs.length > 0) {
    partial.programs = programs;
    provenance.programs = "deterministic";
  }

  const split = splitPlaces(masked, places);
  const origins = expandMentions(split.origins, places);
  const destinations = expandMentions(split.destinations, places);
  if (origins.length > 0) {
    partial.origins = origins;
    provenance.origins = "deterministic";
  } else missing.push("origins");
  if (destinations.length > 0) {
    partial.destinations = destinations;
    provenance.destinations = "deterministic";
  } else missing.push("destinations");

  const dates = parseDates(masked, opts.today);
  if (dates) {
    partial.date_from = dates.date_from;
    partial.date_to = dates.date_to;
    provenance.date_from = "deterministic";
    provenance.date_to = "deterministic";
    if (dates.warning) notices.push(dates.warning);
    if (dates.capped) {
      notices.push(notice("parse.range_truncated", { days: MAX_SPAN_DAYS, date_from: dates.date_from, date_to: dates.date_to }));
    }
  } else missing.push("date_from", "date_to");

  const cabins = parseCabins(masked);
  if (cabins.length > 0) {
    partial.cabins = cabins;
    provenance.cabins = "deterministic";
  } else {
    partial.cabins = [...DEFAULT_CABINS];
    provenance.cabins = "default";
  }

  partial.direct_only = parseDirectOnly(masked);
  provenance.direct_only = partial.direct_only ? "deterministic" : "default";

  const maxMiles = parseMaxMiles(masked);
  if (maxMiles !== null) {
    partial.max_miles = maxMiles;
    provenance.max_miles = "deterministic";
  }

  const sortBy = parseSortBy(masked);
  partial.sort_by = sortBy ?? "miles_asc";
  provenance.sort_by = sortBy ? "deterministic" : "default";

  partial.language = detectLanguage(text);
  provenance.language = "deterministic";
  provenance.raw_text = "deterministic";

  return { partial, missing, provenance, warnings: noticesToText(notices), notices };
}
