/**
 * seats.aero Partner API types — modelled ONLY on the official reference
 * (https://developers.seats.aero/reference/*.md, OpenAPI 3.1 embedded in each page).
 * Base URL https://seats.aero/partnerapi/ ; header `Partner-Authorization: <key>`.
 *
 * Endpoints used (Live Search is out of scope — Pro keys cannot use it):
 *   GET /search            Cached Search      (multi-airport, date range, `cabins=`, take 10..1000, cursor+skip)
 *   GET /availability      Bulk Availability  (one `source`, optional `cabin=`, regions, take, cursor+skip)
 *   GET /trips/{id}        Get Trips          (flight-level detail + booking_links)
 *   GET /routes?source=    Get Routes         (which pairs a program is monitored on; bare array)
 */
import { z } from "zod";
import type { Cabin } from "../query/schema";

/** Mileage-program source codes from the Concepts page (updated 2026-08-28). */
export const SEATS_SOURCES = [
  "eurobonus",
  "virginatlantic",
  "aeromexico",
  "american",
  "delta",
  "etihad",
  "united",
  "emirates",
  "aeroplan",
  "alaska",
  "velocity",
  "qantas",
  "connectmiles",
  "azul",
  "smiles",
  "flyingblue",
  "jetblue",
  "qatar",
  "turkish",
  "singapore",
  "ethiopian",
  "saudia",
  "finnair",
  "lufthansa",
  "frontier",
  "spirit",
] as const;
export type SeatsSource = (typeof SEATS_SOURCES)[number];

/** Human-readable program names (text only — no logos, kickoff §0.2 #4). */
export const SOURCE_NAMES: Record<SeatsSource, string> = {
  eurobonus: "SAS EuroBonus",
  virginatlantic: "Virgin Atlantic Flying Club",
  aeromexico: "Aeromexico Club Premier",
  american: "American Airlines AAdvantage",
  delta: "Delta SkyMiles",
  etihad: "Etihad Guest",
  united: "United MileagePlus",
  emirates: "Emirates Skywards",
  aeroplan: "Air Canada Aeroplan",
  alaska: "Alaska Mileage Plan",
  velocity: "Virgin Australia Velocity",
  qantas: "Qantas Frequent Flyer",
  connectmiles: "Copa ConnectMiles",
  azul: "Azul TudoAzul",
  smiles: "GOL Smiles",
  flyingblue: "Air France/KLM Flying Blue",
  jetblue: "JetBlue TrueBlue",
  qatar: "Qatar Privilege Club",
  turkish: "Turkish Miles & Smiles",
  singapore: "Singapore KrisFlyer",
  ethiopian: "Ethiopian ShebaMiles",
  saudia: "Saudia AlFursan",
  finnair: "Finnair Plus",
  lufthansa: "Lufthansa Miles & More",
  frontier: "Frontier Airlines",
  spirit: "Spirit Airlines",
};

/** Cabin names as the API spells them in `cabins=` / `cabin=` and `Trip.Cabin`. */
export const CabinName = z.enum(["economy", "premium", "business", "first"]);
export type CabinName = z.infer<typeof CabinName>;
export const CABIN_LETTER_TO_NAME: Record<Cabin, CabinName> = {
  Y: "economy",
  W: "premium",
  J: "business",
  F: "first",
};
export const CABIN_NAME_TO_LETTER: Record<CabinName, Cabin> = {
  economy: "Y",
  premium: "W",
  business: "J",
  first: "F",
};

export const Route = z.object({
  ID: z.string(),
  OriginAirport: z.string(),
  OriginRegion: z.string(),
  DestinationAirport: z.string(),
  DestinationRegion: z.string(),
  NumDaysOut: z.number().int(),
  Distance: z.number().int(),
  Source: z.string(),
});
export type Route = z.infer<typeof Route>;

/** GET /routes?source= returns a bare array of Route. */
export const RoutesResponse = z.array(Route);

/**
 * The route embedded in an Availability. Only ID/OriginAirport/DestinationAirport/Source are
 * present in every documented example (the Concepts page omits the rest, and the Bulk
 * Availability response schema is empty), so the region/day/distance fields are optional here
 * while `Route` (Get Routes, fully documented) keeps them required.
 */
export const AvailabilityRoute = Route.partial({
  OriginRegion: true,
  DestinationRegion: true,
  NumDaysOut: true,
  Distance: true,
});
export type AvailabilityRoute = z.infer<typeof AvailabilityRoute>;

const nullableStr = z.string().nullable().optional();
const nullableBool = z.boolean().nullable().optional();
const nullableInt = z.number().int().nullable().optional();

/**
 * One Availability = one route + one departure date + one source. Per-cabin fields are
 * prefixed Y/W/J/F. MileageCost is a STRING ("12500"; "0" when unavailable); RemainingSeats
 * is 0 when unknown; Airlines is "AA, B6"-style. Every per-cabin field may be null (the
 * official example has F* all null for some rows).
 *
 * `UpdatedAt` is the documented freshness field. Fields marked "observed" are NOT in the
 * 2025-04-23 OpenAPI snapshot; they are consumed only when present and never required.
 */
export const Availability = z
  .object({
    ID: z.string(),
    RouteID: z.string().optional(),
    Route: AvailabilityRoute,
    Date: z.string(),
    ParsedDate: z.string().optional(),
    YAvailable: nullableBool,
    WAvailable: nullableBool,
    JAvailable: nullableBool,
    FAvailable: nullableBool,
    YMileageCost: nullableStr,
    WMileageCost: nullableStr,
    JMileageCost: nullableStr,
    FMileageCost: nullableStr,
    YRemainingSeats: nullableInt,
    WRemainingSeats: nullableInt,
    JRemainingSeats: nullableInt,
    FRemainingSeats: nullableInt,
    YAirlines: nullableStr,
    WAirlines: nullableStr,
    JAirlines: nullableStr,
    FAirlines: nullableStr,
    YDirect: nullableBool,
    WDirect: nullableBool,
    JDirect: nullableBool,
    FDirect: nullableBool,
    Source: z.string(),
    CreatedAt: z.string().optional(),
    UpdatedAt: z.string().optional(),
    AvailabilityTrips: z.array(z.unknown()).nullable().optional(),
    // ---- observed, not in the documented schema; optional on purpose ----
    ComputedLastSeen: z.string().nullable().optional(),
    YTotalTaxes: nullableInt,
    WTotalTaxes: nullableInt,
    JTotalTaxes: nullableInt,
    FTotalTaxes: nullableInt,
    TaxesCurrency: nullableStr,
    TaxesCurrencySymbol: nullableStr,
    APITermsOfUse: nullableStr,
  })
  .passthrough();
export type Availability = z.infer<typeof Availability>;

/** Envelope for GET /search (and, per the docs' prose, "similar" for GET /availability). */
export const SearchResponse = z.object({
  data: z.array(Availability),
  count: z.number().int().optional(),
  hasMore: z.boolean().optional(),
  cursor: z.number().int().optional(),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

/** Bulk Availability's documented schema is empty; accept either the envelope or a bare array. */
export const BulkResponse = z.union([SearchResponse, z.array(Availability)]);
export type BulkResponse = z.infer<typeof BulkResponse>;

export const Segment = z
  .object({
    ID: z.string(),
    RouteID: z.string().optional(),
    AvailabilityID: z.string().optional(),
    AvailabilityTripID: z.string().optional(),
    FlightNumber: z.string(),
    Distance: z.number().int().optional(),
    FareClass: z.string().optional(),
    AircraftName: z.string().optional(),
    AircraftCode: z.string().optional(),
    OriginAirport: z.string(),
    DestinationAirport: z.string(),
    DepartsAt: z.string(),
    ArrivesAt: z.string(),
    Source: z.string().optional(),
    Order: z.number().int().optional(),
  })
  .passthrough();
export type Segment = z.infer<typeof Segment>;

/** Trip times carry a "Z" suffix but are AIRPORT LOCAL times (Concepts page). TotalTaxes is in minor units. */
export const Trip = z
  .object({
    ID: z.string(),
    RouteID: z.string().optional(),
    AvailabilityID: z.string(),
    AvailabilitySegments: z.array(Segment).default([]),
    TotalDuration: z.number().int().optional(),
    Stops: z.number().int(),
    Carriers: z.string(),
    RemainingSeats: z.number().int(),
    MileageCost: z.number().int(),
    TotalTaxes: z.number().int(),
    TaxesCurrency: z.string(),
    TaxesCurrencySymbol: z.string().optional(),
    AllianceCost: z.number().int().optional(),
    FlightNumbers: z.string(),
    DepartsAt: z.string(),
    Cabin: z.string(),
    ArrivesAt: z.string(),
    Source: z.string(),
    MixedCabinPct: z.number().int().optional(),
    UpdatedAt: z.string().optional(),
  })
  .passthrough();
export type Trip = z.infer<typeof Trip>;

export const BookingLink = z.object({
  label: z.string(),
  link: z.string(),
  primary: z.boolean(),
});
export type BookingLink = z.infer<typeof BookingLink>;

export const TripsResponse = z.object({
  data: z.array(Trip),
  origin_coordinates: z.object({ Lat: z.number(), Lon: z.number() }).optional(),
  destination_coordinates: z.object({ Lat: z.number(), Lon: z.number() }).optional(),
  booking_links: z.array(BookingLink).default([]),
});
export type TripsResponse = z.infer<typeof TripsResponse>;

/** Query parameters for GET /search exactly as documented. */
export interface CachedSearchParams {
  origin_airport: string[]; // joined with ","
  destination_airport: string[];
  start_date?: string; // YYYY-MM-DD
  end_date?: string;
  cursor?: number;
  take?: number; // 10..1000, default 500
  order_by?: "lowest_mileage";
  skip?: number;
  include_trips?: boolean;
  only_direct_flights?: boolean;
  carriers?: string[];
  include_filtered?: boolean;
  sources?: string[];
  minify_trips?: boolean;
  cabins?: CabinName[]; // plural on /search
  min_cabin_pct?: number; // 0..100, default 100
}

/** Query parameters for GET /availability exactly as documented. */
export interface BulkAvailabilityParams {
  source: string; // required, exactly one program
  cabin?: CabinName; // singular on /availability
  start_date?: string;
  end_date?: string;
  origin_region?: SeatsRegion;
  destination_region?: SeatsRegion;
  take?: number;
  cursor?: number;
  skip?: number;
  include_filtered?: boolean;
  min_cabin_pct?: number;
}

export type SeatsRegion = "North America" | "South America" | "Africa" | "Asia" | "Europe" | "Oceania";

export interface GetTripsParams {
  include_filtered?: boolean;
  min_cabin_pct?: number;
}
