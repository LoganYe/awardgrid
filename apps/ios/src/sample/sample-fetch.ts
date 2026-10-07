/**
 * Sample mode's transport (release plan step 16): a `fetch` that answers the four seats.aero partner endpoints the
 * app uses — Cached Search, Bulk Availability, Get Routes and Get Trips — from ./generate.ts, in memory, in the shapes
 * the official reference documents (core seatsaero/types.ts), so the app's own planner, quota, cache, normaliser and
 * screens run unchanged on sample data. Anything else is a 404.
 *
 * It applies the filters scripts/mock-seatsaero.ts applies: origins and destinations, one program or several, the
 * date range, the cabins (any of them available, and nonstop when asked), dynamic pricing only when the search
 * includes it, and take/skip paging. Nothing leaves the device: it never calls the native HTTP adapter, the WebView's
 * fetch or anything else, and it is loaded only in sample mode (its own chunk, imported by ./boot.ts).
 *
 * Rows carry no source update time (no UpdatedAt): the app says "Sample data" where a source time would be.
 */
import { CABIN_LETTER_TO_NAME, CABIN_NAME_TO_LETTER, type CabinName } from "@awardgrid/core/seatsaero/types";
import type { Cabin } from "@awardgrid/core/query/schema";
import { SAMPLE_AIRPORTS, airportInfo, greatCircleMiles, sampleAirport } from "./airports";
import {
  SAMPLE_CABINS,
  SAMPLE_DAYS,
  SAMPLE_ROUTE_AIRPORTS,
  type SampleOffer,
  availabilityId,
  generateSample,
  readAvailabilityId,
  sampleItineraries,
  sampleWindow,
} from "./generate";
import { DEMO_PROGRAMS, type DemoProgram, addDays } from "./shared";
import { localDate } from "../app/local-date";

export const SEATS_PARTNER_API = "https://seats.aero/partnerapi/";

/** One seats.aero Availability: a program's offers on one route and day, every cabin's fields present. */
export interface SampleAvailability {
  ID: string;
  RouteID: string;
  Route: {
    ID: string;
    OriginAirport: string;
    OriginRegion: string;
    DestinationAirport: string;
    DestinationRegion: string;
    NumDaysOut: number;
    Distance: number;
    Source: string;
  };
  Date: string;
  ParsedDate: string;
  Source: string;
  TaxesCurrency: string;
  TaxesCurrencySymbol: string;
  [cabinField: string]: unknown;
}

interface Row {
  availability: SampleAvailability;
  /** Served only when the search includes dynamic pricing. */
  dynamic: boolean;
  /** The cabins with an offer, and whether each flies nonstop. */
  cabins: Partial<Record<Cabin, { direct: boolean }>>;
}

function routeOf(origin: string, destination: string, program: string) {
  return {
    ID: `smp-${origin}-${destination}-${program}`,
    OriginAirport: origin,
    OriginRegion: airportInfo(origin)!.region,
    DestinationAirport: destination,
    DestinationRegion: airportInfo(destination)!.region,
    NumDaysOut: SAMPLE_DAYS - 1,
    Distance: greatCircleMiles(origin, destination)!,
    Source: program,
  };
}

/** Every program's row on one route and day: each cabin's offer folded into one Availability per program. */
export function sampleRows(origin: string, destination: string, date: string, today: string): Row[] {
  const byProgram = new Map<DemoProgram, SampleOffer[]>();
  for (const cabin of SAMPLE_CABINS) {
    for (const offer of generateSample({ origin, destination, date, cabin, today })) {
      byProgram.set(offer.program, [...(byProgram.get(offer.program) ?? []), offer]);
    }
  }
  const rows: Row[] = [];
  // In the programs' fixed order, so the same search lists its rows the same way every time.
  for (const program of DEMO_PROGRAMS) {
    const offers = byProgram.get(program);
    if (!offers) continue;
    const route = routeOf(origin, destination, program);
    const currency = offers[0]!.currency;
    const availability: SampleAvailability = {
      ID: availabilityId(origin, destination, date, program),
      RouteID: route.ID,
      Route: route,
      Date: date,
      ParsedDate: `${date}T00:00:00Z`,
      Source: program,
      TaxesCurrency: currency ?? "",
      TaxesCurrencySymbol: currency ? "$" : "",
    };
    const cabins: Row["cabins"] = {};
    for (const cabin of SAMPLE_CABINS) {
      const offer = offers.find((o) => o.cabin === cabin);
      availability[`${cabin}Available`] = offer !== undefined;
      availability[`${cabin}MileageCost`] = offer ? String(offer.miles) : "0";
      availability[`${cabin}RemainingSeats`] = offer?.seats ?? 0;
      availability[`${cabin}Airlines`] = offer ? offer.carriers.join(", ") : "";
      availability[`${cabin}Direct`] = offer?.direct ?? false;
      availability[`${cabin}TotalTaxes`] = offer?.feesCents ?? null;
      if (offer) cabins[cabin] = { direct: offer.direct };
    }
    rows.push({ availability, dynamic: offers[0]!.dynamic, cabins });
  }
  return rows;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A comma list, as the core client encodes arrays, upper- or lower-cased. */
function list(params: URLSearchParams, name: string, upper = true): string[] {
  return params
    .getAll(name)
    .flatMap((v) => v.split(","))
    .map((v) => (upper ? v.trim().toUpperCase() : v.trim().toLowerCase()))
    .filter(Boolean);
}

/** The cabin letters a request asks for: `cabins=` on /search, `cabin=` on /availability; none means every cabin. */
function wantedCabins(params: URLSearchParams): Cabin[] {
  const names = [...list(params, "cabins", false), ...list(params, "cabin", false)];
  return names.flatMap((name) => (name in CABIN_NAME_TO_LETTER ? [CABIN_NAME_TO_LETTER[name as CabinName]] : []));
}

interface RowFilter {
  sources: string[];
  cabins: Cabin[];
  direct: boolean;
  includeFiltered: boolean;
}

function filterOf(params: URLSearchParams): RowFilter {
  const single = params.get("source");
  return {
    sources: [...list(params, "sources", false), ...(single ? [single.trim().toLowerCase()] : [])],
    cabins: wantedCabins(params),
    direct: params.get("only_direct_flights") === "true",
    includeFiltered: params.get("include_filtered") === "true",
  };
}

function keeps(row: Row, filter: RowFilter): boolean {
  if (row.dynamic && !filter.includeFiltered) return false;
  if (filter.sources.length > 0 && !filter.sources.includes(row.availability.Source)) return false;
  const cabins = filter.cabins.length > 0 ? filter.cabins : SAMPLE_CABINS;
  return cabins.some((cabin) => {
    const offer = row.cabins[cabin];
    return offer !== undefined && (!filter.direct || offer.direct);
  });
}

const isDay = (value: string | null): value is string => value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;

/** Days from `from` to `to` inclusive, clipped to what sample data covers: none when the range lies outside it. */
function days(from: string | null, to: string | null, today: string): string[] {
  const window = sampleWindow(today);
  const first = isDay(from) && from > window.from ? from : window.from;
  const last = isDay(to) && to < window.to ? to : window.to;
  const out: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) out.push(day);
  return out;
}

/**
 * The rows a search asks for, in order (route, then day, then program), generated lazily: the walk stops once
 * `limit` rows have been kept, so a page never draws more than it serves (plus one, to know whether there is more).
 */
function collect(pairs: Iterable<[string, string]>, dates: string[], today: string, filter: RowFilter, limit: number): SampleAvailability[] {
  const out: SampleAvailability[] = [];
  for (const [origin, destination] of pairs) {
    for (const date of dates) {
      for (const row of sampleRows(origin, destination, date, today)) {
        if (!keeps(row, filter)) continue;
        out.push(row.availability);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/** take (10..1000, default 500) and skip, as the API reads them. */
function paging(params: URLSearchParams): { take: number; skip: number } {
  const take = Math.min(1000, Math.max(10, Math.trunc(Number(params.get("take") ?? 500)) || 500));
  const skip = Math.max(0, Math.trunc(Number(params.get("skip") ?? 0)) || 0);
  return { take, skip };
}

function page(rows: SampleAvailability[], take: number, skip: number, cursor: number) {
  const data = rows.slice(skip, skip + take);
  return { data, count: data.length, hasMore: rows.length > skip + take, cursor };
}

function* searchPairs(params: URLSearchParams): Generator<[string, string]> {
  for (const origin of list(params, "origin_airport")) {
    for (const destination of list(params, "destination_airport")) {
      if (sampleAirport(origin) && sampleAirport(destination)) yield [origin, destination];
    }
  }
}

function* regionPairs(params: URLSearchParams): Generator<[string, string]> {
  const from = params.get("origin_region");
  const to = params.get("destination_region");
  for (const origin of SAMPLE_ROUTE_AIRPORTS) {
    if (from && SAMPLE_AIRPORTS[origin]!.region !== from) continue;
    for (const destination of SAMPLE_ROUTE_AIRPORTS) {
      if (origin === destination || (to && SAMPLE_AIRPORTS[destination]!.region !== to)) continue;
      yield [origin, destination];
    }
  }
}

const routeLists = new Map<string, ReturnType<typeof routeOf>[]>();

/** Get Routes: every pair of the seed's airports for a sample program, none for any other program. */
export function sampleRoutes(source: string | null): ReturnType<typeof routeOf>[] {
  const programs = source ? DEMO_PROGRAMS.filter((p) => p === source) : DEMO_PROGRAMS;
  return programs.flatMap((program) => {
    let routes = routeLists.get(program);
    if (!routes) {
      routes = [];
      for (const origin of SAMPLE_ROUTE_AIRPORTS) {
        for (const destination of SAMPLE_ROUTE_AIRPORTS) if (origin !== destination) routes.push(routeOf(origin, destination, program));
      }
      routeLists.set(program, routes);
    }
    return routes;
  });
}

/**
 * Get Trips for one sample availability id: every cabin's itineraries, and no booking links. A day that has passed
 * since the row was shown (a saved snapshot, a search left open overnight) still draws its itineraries: the offer is
 * the same whatever today is. A day past the window was never shown, and has none.
 */
export function sampleTrips(id: string, today: string): Record<string, unknown> | null {
  const read = readAvailabilityId(id);
  if (!read || !sampleAirport(read.origin) || !sampleAirport(read.destination)) return null;
  const { origin, destination, date, program } = read;
  const asOf = date < today ? date : today;
  const data = SAMPLE_CABINS.flatMap((cabin) => {
    const offer = generateSample({ origin, destination, date, cabin, today: asOf }).find((o) => o.program === program);
    if (!offer) return [];
    return sampleItineraries(origin, destination, date, offer).map((trip) => ({
      ID: trip.id,
      RouteID: `smp-${origin}-${destination}-${program}`,
      AvailabilityID: id,
      AvailabilitySegments: trip.legs.map((leg, order) => ({
        ID: `${trip.id}-s${order}`,
        AvailabilityID: id,
        AvailabilityTripID: trip.id,
        FlightNumber: leg.flightNumber,
        Distance: leg.miles,
        AircraftName: leg.aircraft,
        AircraftCode: leg.aircraft,
        OriginAirport: leg.from,
        DestinationAirport: leg.to,
        DepartsAt: leg.departsAt,
        ArrivesAt: leg.arrivesAt,
        Source: program,
        Order: order,
      })),
      TotalDuration: trip.durationMinutes,
      Stops: trip.legs.length - 1,
      Carriers: trip.carriers.join(", "),
      RemainingSeats: trip.seats,
      MileageCost: trip.miles,
      TotalTaxes: trip.feesCents,
      TaxesCurrency: trip.currency ?? "",
      TaxesCurrencySymbol: trip.currency ? "$" : "",
      FlightNumbers: trip.legs.map((leg) => leg.flightNumber).join(", "),
      DepartsAt: trip.legs[0]!.departsAt,
      ArrivesAt: trip.legs.at(-1)!.arrivesAt,
      Cabin: CABIN_LETTER_TO_NAME[cabin],
      Source: program,
    }));
  });
  if (data.length === 0) return null;
  const a = airportInfo(origin)!;
  const b = airportInfo(destination)!;
  return { data, origin_coordinates: { Lat: a.lat, Lon: a.lon }, destination_coordinates: { Lat: b.lat, Lon: b.lon }, booking_links: [] };
}

export interface SampleFetchOptions {
  /** The app's clock: decides which days are covered (today on this device's calendar … today + 364). */
  now: () => Date;
}

/** The sample transport: hand it to bootstrap() as `fetchImpl` in sample mode. */
export function createSampleFetch({ now }: SampleFetchOptions): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    if (!href.startsWith(SEATS_PARTNER_API) || method !== "GET") return json({}, 404);
    const url = new URL(href);
    const path = url.pathname.slice(new URL(SEATS_PARTNER_API).pathname.length);
    const params = url.searchParams;
    // The device's calendar day, as every other "today" in the app (app/local-date.ts).
    const today = localDate(now());
    const cursor = Math.floor(now().getTime() / 1000);

    if (path === "search") {
      const { take, skip } = paging(params);
      const rows = collect(searchPairs(params), days(params.get("start_date"), params.get("end_date"), today), today, filterOf(params), skip + take + 1);
      return json(page(rows, take, skip, cursor));
    }
    if (path === "availability") {
      if (!params.get("source")) return json({}, 400);
      const { take, skip } = paging(params);
      const rows = collect(regionPairs(params), days(params.get("start_date"), params.get("end_date"), today), today, filterOf(params), skip + take + 1);
      return json(page(rows, take, skip, cursor));
    }
    if (path === "routes") return json(sampleRoutes(params.get("source")));
    if (path.startsWith("trips/")) {
      const trips = sampleTrips(decodeURIComponent(path.slice("trips/".length)), today);
      return trips ? json(trips) : json({}, 404);
    }
    return json({}, 404);
  }) as typeof fetch;
}
