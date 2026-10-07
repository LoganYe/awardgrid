/**
 * Where the airports AwardGrid recognises are, for sample mode (./generate.ts): coordinates for the great-circle
 * distance that prices a trip and times its legs, a UTC offset for the airport-local times its itineraries print, and
 * the seats.aero region its routes are listed under.
 *
 * Every code in packages/core/data/places.json has an entry (airports.test.ts holds that): each airport its own, and
 * each metro code that is not itself an airport (TYO, NYC, LON…) its first airport's, as the seed's own order prefers.
 * The offsets are each airport's standard time, without daylight saving: invented itineraries need a plausible local
 * clock, not a timetable.
 */
import places from "@awardgrid/core/data/places.json";
import type { SeatsRegion } from "@awardgrid/core/seatsaero/types";

export interface SampleAirport {
  lat: number;
  lon: number;
  /** Hours from UTC, standard time. */
  utc: number;
  region: SeatsRegion;
}

const NA: SeatsRegion = "North America";
const AS: SeatsRegion = "Asia";
const EU: SeatsRegion = "Europe";
const OC: SeatsRegion = "Oceania";

/** Every airport in the seed, by its own code. */
export const SAMPLE_AIRPORTS: Readonly<Record<string, SampleAirport>> = {
  // East and South-East Asia
  NRT: { lat: 35.772, lon: 140.393, utc: 9, region: AS },
  HND: { lat: 35.549, lon: 139.78, utc: 9, region: AS },
  ICN: { lat: 37.469, lon: 126.451, utc: 9, region: AS },
  GMP: { lat: 37.558, lon: 126.791, utc: 9, region: AS },
  PVG: { lat: 31.143, lon: 121.805, utc: 8, region: AS },
  SHA: { lat: 31.198, lon: 121.336, utc: 8, region: AS },
  PEK: { lat: 40.08, lon: 116.585, utc: 8, region: AS },
  PKX: { lat: 39.509, lon: 116.411, utc: 8, region: AS },
  KIX: { lat: 34.427, lon: 135.244, utc: 9, region: AS },
  ITM: { lat: 34.785, lon: 135.438, utc: 9, region: AS },
  BKK: { lat: 13.69, lon: 100.75, utc: 7, region: AS },
  DMK: { lat: 13.913, lon: 100.607, utc: 7, region: AS },
  HKG: { lat: 22.308, lon: 113.918, utc: 8, region: AS },
  TPE: { lat: 25.078, lon: 121.233, utc: 8, region: AS },
  SIN: { lat: 1.364, lon: 103.991, utc: 8, region: AS },
  KUL: { lat: 2.746, lon: 101.71, utc: 8, region: AS },
  MNL: { lat: 14.509, lon: 121.02, utc: 8, region: AS },
  CAN: { lat: 23.392, lon: 113.299, utc: 8, region: AS },
  SZX: { lat: 22.639, lon: 113.811, utc: 8, region: AS },
  CTU: { lat: 30.578, lon: 103.947, utc: 8, region: AS },
  HGH: { lat: 30.229, lon: 120.434, utc: 8, region: AS },
  XMN: { lat: 24.544, lon: 118.128, utc: 8, region: AS },
  NGO: { lat: 34.858, lon: 136.805, utc: 9, region: AS },
  FUK: { lat: 33.586, lon: 130.451, utc: 9, region: AS },
  CTS: { lat: 42.775, lon: 141.692, utc: 9, region: AS },
  OKA: { lat: 26.196, lon: 127.646, utc: 9, region: AS },
  PUS: { lat: 35.18, lon: 128.938, utc: 9, region: AS },
  HAN: { lat: 21.221, lon: 105.807, utc: 7, region: AS },
  SGN: { lat: 10.819, lon: 106.652, utc: 7, region: AS },
  // South Asia and the Gulf (seats.aero lists the Gulf under Asia)
  DEL: { lat: 28.556, lon: 77.1, utc: 5.5, region: AS },
  BOM: { lat: 19.089, lon: 72.868, utc: 5.5, region: AS },
  DXB: { lat: 25.253, lon: 55.364, utc: 4, region: AS },
  DOH: { lat: 25.273, lon: 51.608, utc: 3, region: AS },
  // North America
  SEA: { lat: 47.449, lon: -122.309, utc: -8, region: NA },
  SFO: { lat: 37.619, lon: -122.375, utc: -8, region: NA },
  LAX: { lat: 33.942, lon: -118.408, utc: -8, region: NA },
  SJC: { lat: 37.363, lon: -121.929, utc: -8, region: NA },
  OAK: { lat: 37.721, lon: -122.221, utc: -8, region: NA },
  SAN: { lat: 32.734, lon: -117.19, utc: -8, region: NA },
  LAS: { lat: 36.084, lon: -115.154, utc: -8, region: NA },
  PDX: { lat: 45.589, lon: -122.598, utc: -8, region: NA },
  YVR: { lat: 49.195, lon: -123.184, utc: -8, region: NA },
  PHX: { lat: 33.437, lon: -112.008, utc: -7, region: NA },
  DEN: { lat: 39.856, lon: -104.674, utc: -7, region: NA },
  YYC: { lat: 51.131, lon: -114.01, utc: -7, region: NA },
  ORD: { lat: 41.978, lon: -87.905, utc: -6, region: NA },
  MDW: { lat: 41.786, lon: -87.752, utc: -6, region: NA },
  DFW: { lat: 32.897, lon: -97.038, utc: -6, region: NA },
  IAH: { lat: 29.99, lon: -95.337, utc: -6, region: NA },
  JFK: { lat: 40.641, lon: -73.778, utc: -5, region: NA },
  EWR: { lat: 40.69, lon: -74.174, utc: -5, region: NA },
  LGA: { lat: 40.777, lon: -73.873, utc: -5, region: NA },
  BOS: { lat: 42.366, lon: -71.01, utc: -5, region: NA },
  IAD: { lat: 38.953, lon: -77.456, utc: -5, region: NA },
  DCA: { lat: 38.851, lon: -77.04, utc: -5, region: NA },
  BWI: { lat: 39.177, lon: -76.668, utc: -5, region: NA },
  MIA: { lat: 25.796, lon: -80.287, utc: -5, region: NA },
  ATL: { lat: 33.637, lon: -84.428, utc: -5, region: NA },
  YYZ: { lat: 43.677, lon: -79.625, utc: -5, region: NA },
  YUL: { lat: 45.47, lon: -73.741, utc: -5, region: NA },
  HNL: { lat: 21.319, lon: -157.922, utc: -10, region: NA },
  // Europe
  LHR: { lat: 51.47, lon: -0.454, utc: 0, region: EU },
  LGW: { lat: 51.153, lon: -0.182, utc: 0, region: EU },
  LCY: { lat: 51.505, lon: 0.055, utc: 0, region: EU },
  STN: { lat: 51.885, lon: 0.235, utc: 0, region: EU },
  DUB: { lat: 53.421, lon: -6.27, utc: 0, region: EU },
  CDG: { lat: 49.01, lon: 2.548, utc: 1, region: EU },
  ORY: { lat: 48.723, lon: 2.379, utc: 1, region: EU },
  FRA: { lat: 50.038, lon: 8.562, utc: 1, region: EU },
  MUC: { lat: 48.354, lon: 11.786, utc: 1, region: EU },
  AMS: { lat: 52.31, lon: 4.768, utc: 1, region: EU },
  ZRH: { lat: 47.458, lon: 8.548, utc: 1, region: EU },
  MAD: { lat: 40.472, lon: -3.563, utc: 1, region: EU },
  BCN: { lat: 41.297, lon: 2.078, utc: 1, region: EU },
  FCO: { lat: 41.8, lon: 12.239, utc: 1, region: EU },
  MXP: { lat: 45.63, lon: 8.723, utc: 1, region: EU },
  CPH: { lat: 55.618, lon: 12.656, utc: 1, region: EU },
  ARN: { lat: 59.65, lon: 17.919, utc: 1, region: EU },
  VIE: { lat: 48.11, lon: 16.57, utc: 1, region: EU },
  HEL: { lat: 60.317, lon: 24.963, utc: 2, region: EU },
  IST: { lat: 41.275, lon: 28.752, utc: 3, region: EU },
  // Oceania
  SYD: { lat: -33.94, lon: 151.175, utc: 10, region: OC },
  MEL: { lat: -37.669, lon: 144.841, utc: 10, region: OC },
  AKL: { lat: -37.008, lon: 174.785, utc: 12, region: OC },
};

/** Each metro code that is not itself an airport, read from the seed: its first airport (TYO → NRT). */
export const SAMPLE_METROS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries((places as { cities: Record<string, string[]> }).cities)
    .filter(([metro, airports]) => !(metro in SAMPLE_AIRPORTS) && airports[0] !== undefined)
    .map(([metro, airports]) => [metro, airports[0]!]),
);

/** How many airports the sample data covers: every airport AwardGrid recognises. */
export const SAMPLE_AIRPORT_COUNT = Object.keys(SAMPLE_AIRPORTS).length;

/** The airport a code stands for in sample mode — itself, or a metro's first airport — or null outside the seed. */
export function sampleAirport(code: string): string | null {
  if (code in SAMPLE_AIRPORTS) return code;
  return SAMPLE_METROS[code] ?? null;
}

/** Whether sample mode has data for this code (an airport or a metro in the seed). */
export function sampleCovers(code: string): boolean {
  return sampleAirport(code) !== null;
}

/** The airport's entry for any covered code; null outside the seed. */
export function airportInfo(code: string): SampleAirport | null {
  const airport = sampleAirport(code);
  return airport ? SAMPLE_AIRPORTS[airport]! : null;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in statute miles between two covered codes, rounded; null when either is outside the seed. */
export function greatCircleMiles(from: string, to: string): number | null {
  const a = airportInfo(from);
  const b = airportInfo(to);
  if (!a || !b) return null;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h))));
}
