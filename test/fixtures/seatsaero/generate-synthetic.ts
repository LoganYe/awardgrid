/**
 * Deterministic generator for test/fixtures/seatsaero/synthetic-example-query.json.
 *
 * The official fixtures (search.json, trips__id.json, routes.json, availability.json) are
 * the docs' example payloads and are never edited. This file produces a SYNTHETIC Cached
 * Search response, in the official shape, for the canonical example query:
 *   origins HKG,PVG,SHA,NRT,HND,ICN,GMP → SEA, 30 consecutive dates from 2026-10-01,
 *   J and F availability across a handful of programs.
 * It is seeded (mulberry32) so the output is byte-identical on every run — tests may call
 * generateSynthetic() directly instead of reading the file.
 *
 * Regenerate:  pnpm tsx test/fixtures/seatsaero/generate-synthetic.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SYNTHETIC_ORIGINS = ["HKG", "PVG", "SHA", "NRT", "HND", "ICN", "GMP"] as const;
export const SYNTHETIC_DEST = "SEA";
export const SYNTHETIC_DATE_FROM = "2026-10-01";
export const SYNTHETIC_DAYS = 30;
export const SYNTHETIC_FETCHED_AT = "2026-10-01T12:00:00Z";
export const SYNTHETIC_PROGRAMS = ["american", "alaska", "united", "aeroplan", "singapore", "jetblue"] as const;
/** Carriers a program plausibly books on Asia → Seattle, for the Airlines strings. */
const CARRIERS: Record<(typeof SYNTHETIC_PROGRAMS)[number], string[]> = {
  american: ["JL", "CX", "AA"],
  alaska: ["JL", "CX", "SQ"],
  united: ["UA", "NH", "OZ"],
  aeroplan: ["AC", "NH", "OZ"],
  singapore: ["SQ"],
  jetblue: ["JL"],
};
const REGION: Record<string, string> = {
  HKG: "Asia",
  PVG: "Asia",
  SHA: "Asia",
  NRT: "Asia",
  HND: "Asia",
  ICN: "Asia",
  GMP: "Asia",
  SEA: "North America",
};
/** Great-circle-ish distances in miles, only for realism. */
const DISTANCE: Record<string, number> = { HKG: 6483, PVG: 5710, SHA: 5714, NRT: 4776, HND: 4792, ICN: 5217, GMP: 5230 };

/** mulberry32 — tiny seeded PRNG; good enough for fixtures. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function ksuidLike(rand: () => number): string {
  let s = "2";
  for (let i = 0; i < 26; i += 1) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)]!;
}

function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}

export interface SyntheticFixture {
  _synthetic: true;
  _derived_from: "official cached-search example shape";
  _query: { origins: string[]; destination: string; date_from: string; date_to: string; programs: string[] };
  data: Record<string, unknown>[];
  count: number;
  hasMore: boolean;
  cursor: number;
}

export function generateSynthetic(seed = 20261001): SyntheticFixture {
  const rand = mulberry32(seed);
  const fetchedAtMs = Date.parse(SYNTHETIC_FETCHED_AT);
  const routeIds = new Map<string, string>();
  const data: Record<string, unknown>[] = [];

  for (const origin of SYNTHETIC_ORIGINS) {
    for (const program of SYNTHETIC_PROGRAMS) {
      const routeKey = `${program}:${origin}`;
      if (!routeIds.has(routeKey)) routeIds.set(routeKey, ksuidLike(rand));
      const routeId = routeIds.get(routeKey)!;
      // GMP has no long-haul service: no program monitors GMP→SEA (exercises "unmonitored").
      if (origin === "GMP") continue;
      for (let day = 0; day < SYNTHETIC_DAYS; day += 1) {
        // ~22% of (pair, program, day) combos carry an Availability object.
        if (rand() > 0.22) continue;
        const date = addDays(SYNTHETIC_DATE_FROM, day);
        const jAvailable = rand() < 0.85;
        // Some rows have the F block entirely null, exactly like the official example.
        const fNull = rand() < 0.25;
        const fAvailable = !fNull && rand() < 0.4;
        if (!jAvailable && !fAvailable) continue;
        const carriers = CARRIERS[program];
        const jAirlines = [...new Set([pick(rand, carriers), pick(rand, carriers)])].sort().join(", ");
        const fAirlines = pick(rand, carriers);
        const jMiles = roundTo(55_000 + rand() * 40_000, 500);
        const fMiles = roundTo(60_000 + rand() * 50_000, 500);
        const jSeats = Math.floor(rand() * 5); // 0..4
        const fSeats = Math.floor(rand() * 3); // 0..2
        const hoursAgo = 0.5 + rand() * 8.5; // 0.5..9 h before FETCHED_AT
        const updatedAt = new Date(fetchedAtMs - hoursAgo * 3_600_000).toISOString();
        const createdAt = new Date(fetchedAtMs - (30 + rand() * 60) * 86_400_000).toISOString();
        const jDirect = rand() < 0.6;
        data.push({
          ID: ksuidLike(rand),
          RouteID: routeId,
          Route: {
            ID: routeId,
            OriginAirport: origin,
            OriginRegion: REGION[origin],
            DestinationAirport: SYNTHETIC_DEST,
            DestinationRegion: REGION[SYNTHETIC_DEST],
            NumDaysOut: 330,
            Distance: DISTANCE[origin],
            Source: program,
          },
          Date: date,
          ParsedDate: `${date}T00:00:00Z`,
          YAvailable: false,
          WAvailable: false,
          JAvailable: jAvailable,
          FAvailable: fNull ? null : fAvailable,
          YMileageCost: "0",
          WMileageCost: "0",
          JMileageCost: jAvailable ? String(jMiles) : "0",
          FMileageCost: fNull ? null : fAvailable ? String(fMiles) : "0",
          YRemainingSeats: 0,
          WRemainingSeats: 0,
          JRemainingSeats: jAvailable ? jSeats : 0,
          FRemainingSeats: fNull ? null : fAvailable ? fSeats : 0,
          YAirlines: "",
          WAirlines: "",
          JAirlines: jAvailable ? jAirlines : "",
          FAirlines: fNull ? null : fAvailable ? fAirlines : "",
          YDirect: false,
          WDirect: false,
          JDirect: jAvailable ? jDirect : false,
          FDirect: fNull ? null : fAvailable ? rand() < 0.5 : false,
          Source: program,
          CreatedAt: createdAt,
          UpdatedAt: updatedAt,
          AvailabilityTrips: null,
        });
      }
    }
  }

  return {
    _synthetic: true,
    _derived_from: "official cached-search example shape",
    _query: {
      origins: [...SYNTHETIC_ORIGINS],
      destination: SYNTHETIC_DEST,
      date_from: SYNTHETIC_DATE_FROM,
      date_to: addDays(SYNTHETIC_DATE_FROM, SYNTHETIC_DAYS - 1),
      programs: [...SYNTHETIC_PROGRAMS],
    },
    data,
    count: data.length,
    hasMore: false,
    cursor: Math.floor(fetchedAtMs / 1000),
  };
}

export const SYNTHETIC_FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "synthetic-example-query.json");

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const fixture = generateSynthetic();
  writeFileSync(SYNTHETIC_FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
  process.stdout.write(`wrote ${fixture.count} availabilities to ${SYNTHETIC_FIXTURE_PATH}\n`);
}
