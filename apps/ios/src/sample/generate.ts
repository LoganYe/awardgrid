/**
 * Sample mode's data (release plan step 16): invented award offers for any route between the airports AwardGrid
 * recognises (./airports.ts), on any day from today to today + 364, in all four cabins.
 *
 * Every number is made up. The programs are real seats.aero source codes and the carriers real airline codes, with
 * invented miles, taxes, seat counts and flight numbers (release plan D10); the app labels every screen of it as sample
 * data. Nothing here was fetched, and nothing here fetches.
 *
 *   - **Deterministic.** One offer list per (origin, destination, date, cabin), drawn from
 *     mulberry32(hash("origin|destination|date|cabin")), so a search, its details and a reload all see the same
 *     numbers, and so do two devices. `today` only decides which days are covered, never a price.
 *   - **Shaped by distance.** Miles and taxes scale with the great-circle distance; a route under 7,500 statute miles
 *     may fly nonstop, a longer one connects once through the hub that adds the least distance; each leg's duration
 *     comes from its distance (8.6 miles a minute, plus 30 minutes), as fixtures/demo/generate.ts times its legs.
 *   - **Ids that say what they are.** An availability id encodes (origin, destination, date, program) and a trip id
 *     adds the cabin, so `/trips/{id}` can draw the same itineraries again after the app is reopened.
 *   - **No booking links.** Sample options have none: nothing here points at a program's or anyone's website.
 */
import type { Cabin } from "@awardgrid/core/query/schema";
import type { SeatsRegion } from "@awardgrid/core/seatsaero/types";
import { SAMPLE_AIRPORTS, airportInfo, greatCircleMiles, sampleAirport } from "./airports";
import { BASE_MILES, DEMO_PROGRAMS, DYNAMIC_PRONE, type DemoProgram, TAXES, addDays, hashSeed, mulberry32 } from "./shared";

/** The days sample data covers: today and the 364 after it. */
export const SAMPLE_DAYS = 365;
/** Below this many statute miles a route may fly nonstop; at or above it, every itinerary connects once. */
export const NONSTOP_LIMIT_MILES = 7_500;
/** The longest single leg an invented itinerary may fly. */
const MAX_LEG_MILES = 9_000;
/** A connection must be somewhere: each leg at least this long. */
const MIN_LEG_MILES = 150;

export const SAMPLE_CABINS = ["Y", "W", "J", "F"] as const satisfies readonly Cabin[];

/** The first and last day covered on a given day (inclusive), as YYYY-MM-DD. */
export function sampleWindow(today: string): { from: string; to: string } {
  return { from: today, to: addDays(today, SAMPLE_DAYS - 1) };
}

export interface SampleQuery {
  origin: string;
  destination: string;
  /** YYYY-MM-DD, the departure day. */
  date: string;
  cabin: Cabin;
  /** YYYY-MM-DD on the app's clock: only decides whether `date` is covered. */
  today: string;
}

/** One program's invented offer for one cabin on one route and day. */
export interface SampleOffer {
  program: DemoProgram;
  cabin: Cabin;
  miles: number;
  /** Taxes in minor units; null on some offers, so "fees not yet confirmed" is shown too. */
  feesCents: number | null;
  /** The row's currency (the same for every cabin of a program's row); null when not given. */
  currency: "USD" | null;
  /** 0 = not provided, as seats.aero sends it. */
  seats: number;
  direct: boolean;
  /** The connection airport when not direct. */
  hub: string | null;
  /** Operating carriers, two-letter codes: one for a nonstop, the two legs' for a connection. */
  carriers: string[];
  /** A dynamically priced row, served only when the search includes dynamic pricing. */
  dynamic: boolean;
}

/** Carriers each program plausibly books on (real two-letter codes, as text only; flight numbers are invented). */
const CARRIERS: Record<DemoProgram, readonly string[]> = {
  american: ["AA", "BA", "JL", "CX", "QR", "IB", "AY", "QF"],
  alaska: ["AS", "JL", "CX", "QR", "BA", "AA", "FJ"],
  united: ["UA", "NH", "LH", "SQ", "AC", "LX", "OS", "TK"],
  aeroplan: ["AC", "LH", "NH", "UA", "LX", "TK", "SQ", "OS"],
  singapore: ["SQ", "LH", "NH", "UA", "LX", "TK"],
  jetblue: ["B6", "QR", "FI"],
  flyingblue: ["AF", "KL", "DL", "KE", "VS"],
};

/** Where each carrier is based, so a leg is flown by a carrier from one of its two ends' regions where the program has one. */
const CARRIER_HOME: Record<string, SeatsRegion> = {
  AA: "North America",
  AS: "North America",
  UA: "North America",
  AC: "North America",
  B6: "North America",
  DL: "North America",
  BA: "Europe",
  IB: "Europe",
  AY: "Europe",
  LH: "Europe",
  LX: "Europe",
  OS: "Europe",
  TK: "Europe",
  AF: "Europe",
  KL: "Europe",
  VS: "Europe",
  FI: "Europe",
  JL: "Asia",
  CX: "Asia",
  NH: "Asia",
  SQ: "Asia",
  KE: "Asia",
  QR: "Asia",
  QF: "Oceania",
  FJ: "Oceania",
};

/** Carriers that fly from their own hub rather than across their region: local only on a leg that touches it. */
const CARRIER_HUB: Record<string, readonly string[]> = { QR: ["DOH"] };

/** A carrier of the program for a leg: one based at either end when the program has one, else any of its own. */
function carrierFor(rand: Rand, program: DemoProgram, from: string, to: string): string {
  const ends = new Set([airportInfo(from)?.region, airportInfo(to)?.region]);
  const based = (c: string) => (CARRIER_HUB[c] ? CARRIER_HUB[c].includes(from) || CARRIER_HUB[c].includes(to) : ends.has(CARRIER_HOME[c]));
  const local = CARRIERS[program].filter(based);
  return pick(rand, local.length > 0 ? local : CARRIERS[program]);
}

/** Hubs a connection may go through, all airports of the seed. */
const HUBS = ["NRT", "ICN", "HKG", "TPE", "SIN", "BKK", "DXB", "DOH", "IST", "FRA", "MUC", "ZRH", "AMS", "CDG", "LHR", "HEL", "JFK", "ORD", "DFW", "ATL", "LAX", "SFO", "SEA", "YVR", "YYZ", "HNL", "SYD", "AKL"] as const;

/** How likely a day is to have any offer in a cabin, by the route's length. */
function dayChance(cabin: Cabin, miles: number): number {
  switch (cabin) {
    case "Y":
      return 0.75;
    case "W":
      return miles > 1_500 ? 0.35 : 0.12;
    case "J":
      return 0.5;
    case "F":
      return miles > 2_500 ? 0.16 : 0.04;
  }
}

/** Invented award ranges per cabin, any route. */
const MILES_RANGE: Record<Cabin, readonly [number, number]> = {
  Y: [4_500, 60_000],
  W: [8_000, 90_000],
  J: [12_000, 160_000],
  F: [20_000, 220_000],
};
const MAX_SEATS: Record<Cabin, number> = { Y: 9, W: 6, J: 4, F: 2 };

type Rand = () => number;
const int = (rand: Rand, min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n));
const pick = <T>(rand: Rand, list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;

/** The first `n` of a deterministic Fisher–Yates pass. */
function sample<T>(rand: Rand, list: readonly T[], n: number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

/** Whether `date` is a real calendar day inside the covered window. */
export function sampleCoversDate(date: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || addDays(date, 0) !== date) return false;
  const { from, to } = sampleWindow(today);
  return date >= from && date <= to;
}

/**
 * The traits a program's whole row shares across cabins on a route and day: whether it is dynamically priced and
 * whether its taxes name a currency. Seeded by program, not cabin, so the four cabins of one row agree.
 */
function rowTraits(origin: string, destination: string, date: string, program: DemoProgram): { dynamic: boolean; withCurrency: boolean } {
  const rand = mulberry32(hashSeed(`${origin}|${destination}|${date}|${program}`));
  const dynamic = DYNAMIC_PRONE.includes(program) && rand() < 0.3;
  return { dynamic, withCurrency: rand() < 0.8 };
}

const hubCache = new Map<string, string | null>();

/**
 * The hub that adds the least distance between two covered airports, each leg between 150 and 9,000 miles; null when
 * none fits (two airports a short hop apart). Not the origin or destination, nor an airport of either's own metro.
 */
export function connectionHub(origin: string, destination: string): string | null {
  const a = sampleAirport(origin);
  const b = sampleAirport(destination);
  if (!a || !b) return null;
  const key = `${a}|${b}`;
  const cached = hubCache.get(key);
  if (cached !== undefined) return cached;
  let best: string | null = null;
  let bestTotal = Number.POSITIVE_INFINITY;
  for (const hub of HUBS) {
    if (hub === a || hub === b) continue;
    const first = greatCircleMiles(a, hub)!;
    const second = greatCircleMiles(hub, b)!;
    if (first < MIN_LEG_MILES || second < MIN_LEG_MILES || first > MAX_LEG_MILES || second > MAX_LEG_MILES) continue;
    if (first + second < bestTotal) {
      best = hub;
      bestTotal = first + second;
    }
  }
  hubCache.set(key, best);
  return best;
}

/** How the miles scale with distance: 1 at about 5,700 statute miles, the trip BASE_MILES is priced for. */
function distanceFactor(miles: number): number {
  return (miles + 1_500) / 7_200;
}

/** Invented taxes for a program's offer on a route: its range, scaled by distance (a short hop costs less), in cents. */
function taxes(rand: Rand, program: DemoProgram, miles: number): number {
  const [lo, hi] = TAXES[program];
  const scale = Math.min(1.4, Math.max(0.35, distanceFactor(miles)));
  return Math.max(10, roundTo(int(rand, lo, hi) * scale, 10));
}

/**
 * Every program's invented offer for one cabin on one route and day: none outside the airports AwardGrid recognises,
 * on a day outside today … today + 364, or between a code and itself (or a metro and its own first airport).
 */
export function generateSample({ origin, destination, date, cabin, today }: SampleQuery): SampleOffer[] {
  const a = sampleAirport(origin);
  const b = sampleAirport(destination);
  if (!a || !b || a === b || !sampleCoversDate(date, today)) return [];
  const miles = greatCircleMiles(a, b)!;
  const rand = mulberry32(hashSeed(`${origin}|${destination}|${date}|${cabin}`));
  if (rand() >= dayChance(cabin, miles)) return [];
  const r = rand();
  const count = r < 0.5 ? 1 : r < 0.8 ? 2 : 3;
  const programs = sample(rand, DEMO_PROGRAMS, count);
  const hub = miles >= NONSTOP_LIMIT_MILES || miles > MIN_LEG_MILES * 2 ? connectionHub(a, b) : null;
  return programs.map((program) => {
    const traits = rowTraits(origin, destination, date, program);
    const priceMul = traits.dynamic ? 1.35 + rand() * 0.5 : 0.9 + rand() * 0.25;
    const price = clamp(roundTo(BASE_MILES[program][cabin] * distanceFactor(miles) * priceMul, 500), MILES_RANGE[cabin]);
    const feesCents = rand() < 0.85 ? taxes(rand, program, miles) : null;
    const seats = int(rand, 0, MAX_SEATS[cabin]);
    // A connection only where there is a hub to connect through; a short hop always flies nonstop.
    const direct = hub === null || (miles < NONSTOP_LIMIT_MILES && rand() < 0.65);
    const legs: Array<[string, string]> = direct || hub === null ? [[a, b]] : [[a, hub], [hub, b]];
    const legCarriers = legs.map(([from, to]) => carrierFor(rand, program, from, to));
    return {
      program,
      cabin,
      miles: price,
      feesCents,
      currency: traits.withCurrency ? "USD" : null,
      seats,
      direct,
      hub: direct ? null : hub,
      carriers: legCarriers,
      dynamic: traits.dynamic,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------------------------------------------

const ID_PREFIX = "smp";

/** An availability id: route, day and program, so the row and its itineraries can be drawn again from it alone. */
export function availabilityId(origin: string, destination: string, date: string, program: DemoProgram): string {
  return `${ID_PREFIX}-${origin}-${destination}-${date.replaceAll("-", "")}-${program}`;
}

/** A trip id: the availability id, the cabin and the itinerary's number. */
export function tripId(availability: string, cabin: Cabin, n: number): string {
  return `${availability}-${cabin}-${n}`;
}

/** What an availability id says, when it is one of sample mode's; null for anything else. */
export function readAvailabilityId(id: string): { origin: string; destination: string; date: string; program: DemoProgram } | null {
  const m = /^smp-([A-Z]{3})-([A-Z]{3})-(\d{4})(\d{2})(\d{2})-([a-z]+)$/.exec(id);
  if (!m) return null;
  const program = DEMO_PROGRAMS.find((p) => p === m[6]);
  if (!program) return null;
  return { origin: m[1]!, destination: m[2]!, date: `${m[3]}-${m[4]}-${m[5]}`, program };
}

// ---------------------------------------------------------------------------------------------------------------
// Itineraries
// ---------------------------------------------------------------------------------------------------------------

export interface SampleLeg {
  flightNumber: string;
  from: string;
  to: string;
  miles: number;
  /** Airport-local, with seats.aero's "Z" suffix (not UTC). */
  departsAt: string;
  arrivesAt: string;
  aircraft: string;
}

export interface SampleItinerary {
  id: string;
  cabin: Cabin;
  miles: number;
  feesCents: number;
  currency: "USD" | null;
  seats: number;
  carriers: string[];
  legs: SampleLeg[];
  /** Minutes, flying and connecting. */
  durationMinutes: number;
}

const AIRCRAFT = ["77W", "789", "359", "781", "333", "78J", "32N", "7M8"] as const;

/** Minutes in the air for a leg: 8.6 statute miles a minute, plus 30 for taxi, climb and descent. */
export function legMinutes(miles: number): number {
  return Math.round(miles / 8.6) + 30;
}

/** "Z"-suffixed airport-local time: `minutes` after the departure day's local midnight (negative or past a day rolls the date). */
function localIso(date: string, minutes: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(minutes);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * The itineraries behind one program's offer in one cabin: the first is the offer itself (its miles, seats and
 * nonstop or not), and one or two more vary it. Legs are sequenced on an absolute clock, so a connection never leaves
 * before the leg that feeds it and an eastbound date-line crossing can land earlier in the local day.
 */
export function sampleItineraries(origin: string, destination: string, date: string, offer: SampleOffer): SampleItinerary[] {
  const a = sampleAirport(origin);
  const b = sampleAirport(destination);
  if (!a || !b) return [];
  const id = availabilityId(origin, destination, date, offer.program);
  const rand = mulberry32(hashSeed(`${id}|${offer.cabin}|trips`));
  const total = greatCircleMiles(a, b)!;
  const hub = connectionHub(a, b);
  const count = int(rand, 1, 3);
  const out: SampleItinerary[] = [];
  for (let n = 1; n <= count; n += 1) {
    const direct = n === 1 ? offer.direct : hub === null || (total < NONSTOP_LIMIT_MILES && rand() < 0.4);
    const via = direct ? null : (offer.hub ?? hub);
    const stops = via ? [a, via, b] : [a, b];
    const legCarriers = stops.slice(1).map((to, i) => (n === 1 && offer.carriers[i] ? offer.carriers[i]! : carrierFor(rand, offer.program, stops[i]!, to)));
    const departLocal = int(rand, 7, 22) * 60 + pick(rand, [0, 5, 15, 25, 30, 40, 45, 55]);
    let absolute = departLocal - airportInfo(a)!.utc * 60;
    let duration = 0;
    const legs: SampleLeg[] = [];
    for (let i = 0; i < stops.length - 1; i += 1) {
      const from = stops[i]!;
      const to = stops[i + 1]!;
      const miles = greatCircleMiles(from, to)!;
      const flight = legMinutes(miles);
      const departs = absolute + airportInfo(from)!.utc * 60;
      const arrivesAbsolute = absolute + flight;
      legs.push({
        flightNumber: `${legCarriers[i]}${int(rand, 10, 999)}`,
        from,
        to,
        miles,
        departsAt: localIso(date, departs),
        arrivesAt: localIso(date, arrivesAbsolute + airportInfo(to)!.utc * 60),
        aircraft: pick(rand, AIRCRAFT),
      });
      const layover = i < stops.length - 2 ? int(rand, 75, 180) : 0;
      duration += flight + layover;
      absolute = arrivesAbsolute + layover;
    }
    out.push({
      id: tripId(id, offer.cabin, n),
      cabin: offer.cabin,
      miles: n === 1 ? offer.miles : offer.miles + roundTo(rand() * 15_000, 500),
      feesCents: n === 1 && offer.feesCents !== null ? offer.feesCents : taxes(rand, offer.program, total),
      currency: offer.currency,
      seats: n === 1 ? offer.seats : int(rand, 0, MAX_SEATS[offer.cabin]),
      carriers: [...new Set(legCarriers)],
      legs,
      durationMinutes: duration,
    });
  }
  return out;
}

/** Every airport code sample routes are listed between (the seed's airports; metros are searched as their airports). */
export const SAMPLE_ROUTE_AIRPORTS: readonly string[] = Object.keys(SAMPLE_AIRPORTS);
