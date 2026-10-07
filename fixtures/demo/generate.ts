/**
 * Deterministic generator for the DEMO dataset in fixtures/demo/ (Phase 6 spec §7).
 *
 * Every value here is INVENTED. Nothing was fetched from seats.aero or any airline; the
 * miles, taxes, seats, flight numbers and timestamps are plausible-looking noise from a seeded
 * PRNG (mulberry32, no Math.random) so the files are byte-identical on every run. The shapes
 * follow the official Partner API reference exactly (see src/lib/seatsaero/types.ts) so the app
 * cannot tell the difference — that is the whole point: the screenshot suite, `pnpm dev`, and
 * manual walks run against `pnpm demo` (scripts/mock-seatsaero.ts with DEMO=1) offline.
 *
 * Canonical query: HKG, PVG, SHA, NRT, HND, ICN → SEA, 30 consecutive days from the anchor
 * 2026-10-01, cabins J and F only. The mock shifts dates so the first day == today.
 *
 *   pnpm exec tsx fixtures/demo/generate.ts        # rewrites availability.json, trips.json, routes.json
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SOURCE_NAMES } from "@awardgrid/core/seatsaero/types";
// The helpers sample mode shares with this corridor (mulberry32, the day arithmetic, the programs, their invented prices
// and taxes) live with the app's sample data now, and are imported back from there; the files stay byte-identical.
import { BASE_MILES, DEMO_PROGRAMS, DYNAMIC_PRONE, type DemoProgram, TAXES, addDays, mulberry32 } from "../../apps/ios/src/sample/shared";

export { DEMO_PROGRAMS, addDays, mulberry32, type DemoProgram };

export const DEMO_ORIGINS = ["HKG", "PVG", "SHA", "NRT", "HND", "ICN", "GMP"] as const;
export const DEMO_DEST = "SEA";
export const DEMO_ANCHOR = "2026-10-01";
export const DEMO_DAYS = 30;
/** No program monitors this pair: no availability rows, absent from every /routes list. */
export const DEMO_UNMONITORED_ORIGIN = "ICN";
/** Freshness bounds in minutes before "now" (the mock turns these into UpdatedAt at serve time). */
export const DEMO_FRESHNESS_MIN_MINUTES = 20;
export const DEMO_FRESHNESS_MAX_MINUTES = 3 * 24 * 60;
export const DEMO_GENERATED_BY = "fixtures/demo/generate.ts";

/** Carriers a program plausibly books Asia → Seattle on (two-letter codes as text only). */
const CARRIERS: Record<DemoProgram, string[]> = {
  american: ["JL", "CX", "AA"],
  alaska: ["JL", "CX", "AS"],
  united: ["UA", "NH", "OZ"],
  aeroplan: ["AC", "NH", "OZ"],
  singapore: ["SQ"],
  jetblue: ["JL"],
  flyingblue: ["KE", "DL"],
};
/* Base prices (BASE_MILES, J and F here), dynamic-prone programs and taxes are in apps/ios/src/sample/shared.ts. */
/** Clamped to J 55k–120k / F 70k–160k below. */
const MILES_RANGE = { J: [55_000, 120_000], F: [70_000, 160_000] } as const;
const REGION: Record<string, string> = { HKG: "Asia", PVG: "Asia", SHA: "Asia", NRT: "Asia", HND: "Asia", ICN: "Asia", GMP: "Asia", SEA: "North America" };
/** Great-circle-ish distances in miles, for realism only. */
const DISTANCE: Record<string, number> = { HKG: 6483, PVG: 5710, SHA: 5714, NRT: 4776, HND: 4792, ICN: 5217, GMP: 5231 };
/**
 * Great-circle statute miles from each connecting hub to SEA. Needed because the itinerary is
 * sequenced on an absolute clock now: a leg's duration comes from its distance, so a geography-
 * blind distance produces a geography-blind clock. Drawing an intermediate leg from a flat
 * 500-1800 mile range made HKG -> SFO a two-hour flight, and once the arrival is no longer
 * clamped that shows up as a segment departing the day before the itinerary does.
 */
const HUB_DISTANCE_TO_SEA: Record<string, number> = { NRT: 4776, ICN: 5217, TPE: 5943, YVR: 127, SFO: 679 };
const TZ_HOURS: Record<string, number> = { HKG: 8, PVG: 8, SHA: 8, NRT: 9, HND: 9, ICN: 9, GMP: 9, SEA: -7, TPE: 8, YVR: -7, SFO: -7 };
const COORDS: Record<string, { Lat: number; Lon: number }> = {
  HKG: { Lat: 22.308, Lon: 113.918 },
  PVG: { Lat: 31.143, Lon: 121.805 },
  SHA: { Lat: 31.198, Lon: 121.336 },
  NRT: { Lat: 35.772, Lon: 140.393 },
  HND: { Lat: 35.549, Lon: 139.78 },
  ICN: { Lat: 37.469, Lon: 126.451 },
  GMP: { Lat: 37.558, Lon: 126.791 },
  SEA: { Lat: 47.449, Lon: -122.309 },
};
const HUBS = ["NRT", "ICN", "TPE", "YVR", "SFO"] as const;
const CITY: Record<string, string> = { HKG: "HKG", PVG: "SHA", SHA: "SHA", NRT: "TYO", HND: "TYO", ICN: "SEL", GMP: "SEL", TPE: "TPE", YVR: "YVR", SFO: "SFO" };
const AIRCRAFT = ["77W", "789", "359", "781", "333", "78J"] as const;
const FARE_CLASS = { J: "I", F: "O" } as const;

type Rand = () => number;

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function ksuidLike(rand: Rand): string {
  let s = "2";
  for (let i = 0; i < 26; i += 1) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}
function pick<T>(rand: Rand, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)]!;
}
function int(rand: Rand, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}
function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}
function clamp(n: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(hi, Math.max(lo, n));
}
/** Deterministic partial shuffle: the first n of a Fisher–Yates pass. */
function sample<T>(rand: Rand, list: readonly T[], n: number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}
/** "Z"-suffixed AIRPORT LOCAL time, as the Concepts page describes for trips. */
function localIso(date: string, minutesFromMidnight: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(minutesFromMidnight);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
/** Freshness spread: half fresh, a quarter aging, the rest stale up to three days. */
function minutesAgo(rand: Rand): number {
  const r = rand();
  if (r < 0.5) return int(rand, DEMO_FRESHNESS_MIN_MINUTES, 119);
  if (r < 0.75) return int(rand, 120, 359);
  if (r < 0.93) return int(rand, 360, 1439);
  return int(rand, 1440, DEMO_FRESHNESS_MAX_MINUTES);
}

export interface DemoRoute {
  ID: string;
  OriginAirport: string;
  OriginRegion: string;
  DestinationAirport: string;
  DestinationRegion: string;
  NumDaysOut: number;
  Distance: number;
  Source: string;
}
export interface DemoAvailability {
  ID: string;
  RouteID: string;
  Route: DemoRoute;
  Date: string;
  ParsedDate: string;
  YAvailable: boolean;
  WAvailable: boolean;
  JAvailable: boolean;
  FAvailable: boolean;
  YMileageCost: string;
  WMileageCost: string;
  JMileageCost: string;
  FMileageCost: string;
  YRemainingSeats: number;
  WRemainingSeats: number;
  JRemainingSeats: number;
  FRemainingSeats: number;
  YAirlines: string;
  WAirlines: string;
  JAirlines: string;
  FAirlines: string;
  YDirect: boolean;
  WDirect: boolean;
  JDirect: boolean;
  FDirect: boolean;
  Source: string;
  CreatedAt: string;
  UpdatedAt: string;
  AvailabilityTrips: null;
  /**
   * Observed (undocumented) tax fields the normalizer reads for the cell's fees line
   * (`src/lib/seatsaero/types.ts`). Present on most rows; absent on a few so the "?" (fees
   * unknown) state stays exercised.
   */
  JTotalTaxes?: number;
  FTotalTaxes?: number;
  TaxesCurrency?: string;
  TaxesCurrencySymbol?: string;
  /** Demo-only: minutes before "now" that this row was last seen. The mock rewrites UpdatedAt from it. */
  _demo_updated_minutes_ago: number;
  /** Demo-only: dynamic-priced row, served only when include_filtered=true. */
  _demo_dynamic?: true;
}
export interface DemoSegment {
  ID: string;
  RouteID: string;
  AvailabilityID: string;
  AvailabilityTripID: string;
  FlightNumber: string;
  Distance: number;
  FareClass: string;
  AircraftName: string;
  AircraftCode: string;
  OriginAirport: string;
  DestinationAirport: string;
  DepartsAt: string;
  ArrivesAt: string;
  CreatedAt: string;
  UpdatedAt: string;
  Source: string;
  Order: number;
}
export interface DemoTrip {
  ID: string;
  RouteID: string;
  AvailabilityID: string;
  AvailabilitySegments: DemoSegment[];
  TotalDuration: number;
  Stops: number;
  Carriers: string;
  RemainingSeats: number;
  MileageCost: number;
  TotalTaxes: number;
  TaxesCurrency: string;
  TaxesCurrencySymbol: string;
  AllianceCost: number;
  FlightNumbers: string;
  DepartsAt: string;
  Cabin: "business" | "first";
  ArrivesAt: string;
  CreatedAt: string;
  UpdatedAt: string;
  Source: string;
}
export interface DemoTripsResponse {
  data: DemoTrip[];
  origin_coordinates: { Lat: number; Lon: number };
  destination_coordinates: { Lat: number; Lon: number };
  booking_links: { label: string; link: string; primary: boolean }[];
}
export interface DemoAvailabilityFile {
  _synthetic: true;
  _anchor: string;
  _generated_by: string;
  _query: { origins: string[]; destination: string; date_from: string; date_to: string; cabins: string[]; programs: string[]; unmonitored: string[] };
  data: DemoAvailability[];
}
export interface DemoDataset {
  availability: DemoAvailabilityFile;
  trips: Record<string, DemoTripsResponse>;
  routes: Record<string, DemoRoute[]>;
}

/** Pretend the dataset was fetched at noon UTC on the anchor day; UpdatedAt is relative to it. */
const ANCHOR_FETCHED_AT_MS = Date.parse(`${DEMO_ANCHOR}T12:00:00Z`);

export function generateDemo(seed = 20261001): DemoDataset {
  const rand = mulberry32(seed);
  // Taxes come from a second stream so adding them left every other value byte-identical.
  const taxRand = mulberry32(seed ^ 0x9e3779b9);
  const routes: Record<string, DemoRoute[]> = {};
  const routeByKey = new Map<string, DemoRoute>();
  for (const program of DEMO_PROGRAMS) {
    routes[program] = [];
    for (const origin of DEMO_ORIGINS) {
      if (origin === DEMO_UNMONITORED_ORIGIN) continue;
      const route: DemoRoute = {
        ID: ksuidLike(rand),
        OriginAirport: origin,
        OriginRegion: REGION[origin]!,
        DestinationAirport: DEMO_DEST,
        DestinationRegion: REGION[DEMO_DEST]!,
        NumDaysOut: 330,
        Distance: DISTANCE[origin]!,
        Source: program,
      };
      routes[program].push(route);
      routeByKey.set(`${program}:${origin}`, route);
    }
  }

  const data: DemoAvailability[] = [];
  for (const origin of DEMO_ORIGINS) {
    if (origin === DEMO_UNMONITORED_ORIGIN) continue;
    for (let day = 0; day < DEMO_DAYS; day += 1) {
      const date = addDays(DEMO_ANCHOR, day);
      // Pair-day availability: J on ~45% of pair-days, F on ~15% (independent draws).
      const jDay = rand() < 0.45;
      const fDay = rand() < 0.15;
      if (!jDay && !fDay) continue; // "No availability": fetched, empty
      // 1–3 programs carry a row on this pair-day (50 / 30 / 20 %).
      const r = rand();
      const programCount = r < 0.5 ? 1 : r < 0.8 ? 2 : 3;
      const programs = sample(rand, DEMO_PROGRAMS, programCount);
      programs.forEach((program, i) => {
        // The first program carries every available cabin; the others a non-empty subset.
        let j = jDay && (i === 0 || rand() < 0.7);
        let f = fDay && (i === 0 || rand() < 0.5);
        if (!j && !f) {
          if (jDay) j = true;
          else f = true;
        }
        const dynamic = DYNAMIC_PRONE.includes(program) && rand() < 0.3;
        const priceMul = dynamic ? 1.35 + rand() * 0.5 : 0.9 + rand() * 0.25;
        const carriers = CARRIERS[program];
        const jAirlines = [...new Set([pick(rand, carriers), pick(rand, carriers)])].sort().join(", ");
        const fAirlines = pick(rand, carriers);
        const jMiles = clamp(roundTo(BASE_MILES[program].J * priceMul, 500), MILES_RANGE.J);
        const fMiles = clamp(roundTo(BASE_MILES[program].F * priceMul, 500), MILES_RANGE.F);
        const jSeats = int(rand, 0, 4); // 0 = unknown
        const fSeats = int(rand, 0, 2);
        const ago = minutesAgo(rand);
        const route = routeByKey.get(`${program}:${origin}`)!;
        const row: DemoAvailability = {
          ID: ksuidLike(rand),
          RouteID: route.ID,
          Route: { ...route },
          Date: date,
          ParsedDate: `${date}T00:00:00Z`,
          YAvailable: false,
          WAvailable: false,
          JAvailable: j,
          FAvailable: f,
          YMileageCost: "0",
          WMileageCost: "0",
          JMileageCost: j ? String(jMiles) : "0",
          FMileageCost: f ? String(fMiles) : "0",
          YRemainingSeats: 0,
          WRemainingSeats: 0,
          JRemainingSeats: j ? jSeats : 0,
          FRemainingSeats: f ? fSeats : 0,
          YAirlines: "",
          WAirlines: "",
          JAirlines: j ? jAirlines : "",
          FAirlines: f ? fAirlines : "",
          YDirect: false,
          WDirect: false,
          JDirect: j ? rand() < 0.6 : false,
          FDirect: f ? rand() < 0.5 : false,
          Source: program,
          CreatedAt: new Date(ANCHOR_FETCHED_AT_MS - int(rand, 30, 90) * 86_400_000).toISOString(),
          UpdatedAt: new Date(ANCHOR_FETCHED_AT_MS - ago * 60_000).toISOString(),
          AvailabilityTrips: null,
          _demo_updated_minutes_ago: ago,
        };
        // Taxes on ~85 % of rows (the rest keep the "fees unknown" state); currency omitted for
        // USD on some, as observed upstream (DECISIONS.md "TotalTaxes unit").
        if (taxRand() < 0.85) {
          const [taxLo, taxHi] = TAXES[program];
          if (j) row.JTotalTaxes = roundTo(int(taxRand, taxLo, taxHi), 10);
          if (f) row.FTotalTaxes = roundTo(int(taxRand, taxLo, taxHi), 10);
          const withCurrency = taxRand() < 0.7;
          row.TaxesCurrency = withCurrency ? "USD" : "";
          row.TaxesCurrencySymbol = withCurrency ? "$" : "";
        }
        if (dynamic) row._demo_dynamic = true;
        data.push(row);
      });
    }
  }
  // Pin the extremes so the freshness spread always covers 20 min .. 3 days exactly.
  const first = data[0]!;
  const last = data[data.length - 1]!;
  first._demo_updated_minutes_ago = DEMO_FRESHNESS_MIN_MINUTES;
  first.UpdatedAt = new Date(ANCHOR_FETCHED_AT_MS - DEMO_FRESHNESS_MIN_MINUTES * 60_000).toISOString();
  last._demo_updated_minutes_ago = DEMO_FRESHNESS_MAX_MINUTES;
  last.UpdatedAt = new Date(ANCHOR_FETCHED_AT_MS - DEMO_FRESHNESS_MAX_MINUTES * 60_000).toISOString();

  const trips: Record<string, DemoTripsResponse> = {};
  for (const row of data) trips[row.ID] = generateTrips(rand, row);

  return {
    availability: {
      _synthetic: true,
      _anchor: DEMO_ANCHOR,
      _generated_by: DEMO_GENERATED_BY,
      _query: {
        origins: [...DEMO_ORIGINS],
        destination: DEMO_DEST,
        date_from: DEMO_ANCHOR,
        date_to: addDays(DEMO_ANCHOR, DEMO_DAYS - 1),
        cabins: ["J", "F"],
        programs: [...DEMO_PROGRAMS],
        unmonitored: [`${DEMO_UNMONITORED_ORIGIN}-${DEMO_DEST}`],
      },
      data,
    },
    trips,
    routes,
  };
}

function generateTrips(rand: Rand, row: DemoAvailability): DemoTripsResponse {
  const program = row.Source as DemoProgram;
  const origin = row.Route.OriginAirport;
  const cabins: ("J" | "F")[] = [];
  if (row.JAvailable) cabins.push("J");
  if (row.FAvailable) cabins.push("F");
  const count = int(rand, 2, 3);
  const out: DemoTrip[] = [];
  for (let i = 0; i < count; i += 1) {
    const cabin = cabins[i % cabins.length]!;
    const direct = i === 0 ? row[`${cabin}Direct`] : rand() < 0.4;
    const airlines = (cabin === "J" ? row.JAirlines : row.FAirlines).split(",").map((s) => s.trim()).filter(Boolean);
    const miles = Number(cabin === "J" ? row.JMileageCost : row.FMileageCost) + (i === 0 ? 0 : roundTo(rand() * 15_000, 500));
    const seats = i === 0 ? row[`${cabin}RemainingSeats`] : int(rand, 0, 4);
    const tripId = ksuidLike(rand);
    const depart = int(rand, 9, 18) * 60 + pick(rand, [0, 5, 15, 25, 30, 40, 45, 55]);
    const legs: { from: string; to: string; carrier: string }[] = [];
    if (direct) legs.push({ from: origin, to: DEMO_DEST, carrier: pick(rand, airlines) });
    else {
      // A connection is somewhere on the way, not a backtrack: the hub must be at least 300 miles
      // closer to SEA than the origin is. Without that, NRT -> TPE -> SEA gets picked (TPE is
      // further from SEA than NRT), the first leg's distance floors at the 300-mile minimum, and
      // the drawer prints a 2,000-mile flight as a four-minute one. Every origin keeps at least
      // two candidates; the assertion below is what says so.
      const reachable = HUBS.filter((h) => CITY[h] !== CITY[origin] && HUB_DISTANCE_TO_SEA[h]! < DISTANCE[origin]! - 300);
      if (reachable.length === 0) throw new Error(`no hub closer to ${DEMO_DEST} than ${origin}`);
      const hub = pick(rand, reachable);
      const second = airlines.length > 1 ? airlines[1]! : airlines[0]!;
      legs.push({ from: origin, to: hub, carrier: airlines[0]! }, { from: hub, to: DEMO_DEST, carrier: second });
    }
    const segments: DemoSegment[] = [];
    /**
     * The itinerary is sequenced on an ABSOLUTE clock and each leg's `DepartsAt` / `ArrivesAt` is
     * derived from it, rather than carrying one local clock across time zones.
     *
     * Carrying a local clock forced a clamp — the arrival was `max(cursor + 1, …)`, because
     * crossing the date line eastbound lands EARLIER in the local day than it departed and a
     * connection must never depart before the leg that fed it. That clamp is where every
     * committed cell-drawer capture got its one-minute transpacific leg: "NH914 ICN 13:06 →
     * SEA 13:07". The sequencing constraint is real; expressing it in local time is what was
     * wrong. On an absolute clock the constraint holds by construction and the local arrival is
     * free to be earlier in the day — which is what actually happens on that route.
     *
     * `localIso` takes a signed minute offset from the row date's midnight and rolls the date
     * itself, so an arrival before midnight or after it needs no special case here. The
     * renderer already dates each leg side independently (#30, flights-list.tsx), which is why
     * the generator can tell the truth now.
     */
    let absCursor = depart - TZ_HOURS[origin]! * 60;
    let totalFlight = 0;
    let tzFrom = TZ_HOURS[origin]!;
    for (const [order, leg] of legs.entries()) {
      // Distances that add up. A non-stop is the origin's own figure; a connection splits it, so
      // origin -> hub is what the direct distance has left over after hub -> SEA. The +-6 % jitter
      // keeps the dataset from looking computed while staying geographically honest.
      const distance =
        leg.to === DEMO_DEST && leg.from === origin
          ? DISTANCE[origin]!
          : leg.to === DEMO_DEST
            ? Math.round(HUB_DISTANCE_TO_SEA[leg.from]! * (0.94 + rand() * 0.12))
            : Math.round(Math.max(300, DISTANCE[origin]! - HUB_DISTANCE_TO_SEA[leg.to]!) * (0.94 + rand() * 0.12));
      // 8.6 miles a minute in the air, plus 30 for taxi, climb and descent. The constant was 15,
      // which made the 127-mile YVR -> SEA hop a 29-minute flight — the same class of
      // implausibility as the one-minute leg above, just less obvious. 30 puts it at 45.
      const flightMin = Math.round(distance / 8.6) + 30;
      const tzTo = TZ_HOURS[leg.to]!;
      const departLocal = absCursor + tzFrom * 60;
      const absArrive = absCursor + flightMin;
      const arriveLocal = absArrive + tzTo * 60;
      const flightNumber = `${leg.carrier}${int(rand, 10, 999)}`;
      segments.push({
        ID: ksuidLike(rand),
        RouteID: row.RouteID,
        AvailabilityID: row.ID,
        AvailabilityTripID: tripId,
        FlightNumber: flightNumber,
        Distance: distance,
        FareClass: FARE_CLASS[cabin],
        AircraftName: pick(rand, AIRCRAFT),
        AircraftCode: "",
        OriginAirport: leg.from,
        DestinationAirport: leg.to,
        DepartsAt: localIso(row.Date, departLocal),
        ArrivesAt: localIso(row.Date, arriveLocal),
        CreatedAt: row.CreatedAt,
        UpdatedAt: row.UpdatedAt,
        Source: program,
        Order: order,
      });
      segments[order]!.AircraftCode = segments[order]!.AircraftName;
      totalFlight += flightMin;
      tzFrom = tzTo;
      // The layover is elapsed time, so it is added on the absolute clock; TotalDuration is
      // flight plus layover, which is what it was before and is zone-free either way.
      const layover = order < legs.length - 1 ? int(rand, 90, 180) : 0;
      absCursor = absArrive + layover;
      totalFlight += layover;
    }
    const withCurrency = rand() < 0.7;
    const [taxLo, taxHi] = TAXES[program];
    out.push({
      ID: tripId,
      RouteID: row.RouteID,
      AvailabilityID: row.ID,
      AvailabilitySegments: segments,
      TotalDuration: totalFlight,
      Stops: legs.length - 1,
      Carriers: [...new Set(legs.map((l) => l.carrier))].join(", "),
      RemainingSeats: seats,
      MileageCost: miles,
      TotalTaxes: roundTo(int(rand, taxLo, taxHi), 10),
      TaxesCurrency: withCurrency ? "USD" : "",
      TaxesCurrencySymbol: withCurrency ? "$" : "",
      AllianceCost: Math.round(miles * (1 + rand() * 0.3)),
      FlightNumbers: segments.map((s) => s.FlightNumber).join(", "),
      DepartsAt: segments[0]!.DepartsAt,
      Cabin: cabin === "J" ? "business" : "first",
      ArrivesAt: segments[segments.length - 1]!.ArrivesAt,
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt,
      Source: program,
    });
  }
  const other = pick(rand, DEMO_PROGRAMS.filter((p) => p !== program));
  const link = (p: DemoProgram) => `https://example.com/demo-booking/${p}?from=${origin}&to=${DEMO_DEST}&date=${row.Date}`;
  return {
    data: out,
    origin_coordinates: COORDS[origin]!,
    destination_coordinates: COORDS[DEMO_DEST]!,
    booking_links: [
      { label: `Book via ${SOURCE_NAMES[program]}`, link: link(program), primary: true },
      { label: `Book via ${SOURCE_NAMES[other]}`, link: link(other), primary: false },
    ],
  };
}

export const DEMO_DIR = dirname(fileURLToPath(import.meta.url));
export const DEMO_FILES = {
  availability: join(DEMO_DIR, "availability.json"),
  trips: join(DEMO_DIR, "trips.json"),
  routes: join(DEMO_DIR, "routes.json"),
} as const;

/** The three files exactly as `generate.ts` writes them (stable key order, 2-space indent, trailing newline). */
export function renderDemoFiles(dataset: DemoDataset = generateDemo()): Record<keyof typeof DEMO_FILES, string> {
  return {
    availability: `${JSON.stringify(dataset.availability, null, 2)}\n`,
    trips: `${JSON.stringify(dataset.trips, null, 2)}\n`,
    routes: `${JSON.stringify(dataset.routes, null, 2)}\n`,
  };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const dataset = generateDemo();
  const files = renderDemoFiles(dataset);
  for (const key of Object.keys(DEMO_FILES) as (keyof typeof DEMO_FILES)[]) writeFileSync(DEMO_FILES[key], files[key]);
  const rows = dataset.availability.data;
  const dynamic = rows.filter((r) => r._demo_dynamic).length;
  process.stdout.write(`wrote ${rows.length} availabilities (${dynamic} dynamic), ${Object.keys(dataset.trips).length} trips payloads, ${Object.keys(dataset.routes).length} route lists to ${DEMO_DIR}\n`);
}
