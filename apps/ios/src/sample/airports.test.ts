/**
 * Sample mode's airport table covers every code AwardGrid recognises (packages/core/data/places.json): every metro,
 * every airport under one, every alias's target. A code added to the seed without coordinates fails here, not as a
 * route that silently has no sample data.
 */
import places from "@awardgrid/core/data/places.json";
import { DEFAULT_PLACES } from "@awardgrid/core/query/places";
import { describe, expect, it } from "vitest";
import { SAMPLE_AIRPORTS, SAMPLE_AIRPORT_COUNT, SAMPLE_METROS, airportInfo, greatCircleMiles, sampleAirport, sampleCovers } from "./airports";

const seed = places as { cities: Record<string, string[]>; aliases: Record<string, string> };
const REGIONS = new Set(["North America", "South America", "Africa", "Asia", "Europe", "Oceania"]);

describe("the sample airport table", () => {
  it("covers every code in the places seed: metros, their airports and every alias's target", () => {
    const codes = new Set<string>([...Object.keys(seed.cities), ...Object.values(seed.cities).flat(), ...Object.values(seed.aliases)]);
    expect(codes.size).toBe(DEFAULT_PLACES.knownCodes.size);
    const missing = [...codes].filter((code) => !sampleCovers(code));
    expect(missing).toEqual([]);
    expect(codes.size).toBe(93);
  });

  it("has an entry of its own for every airport, and nothing the seed does not list", () => {
    const airports = new Set(Object.values(seed.cities).flat());
    expect(new Set(Object.keys(SAMPLE_AIRPORTS))).toEqual(airports);
    expect(SAMPLE_AIRPORT_COUNT).toBe(airports.size);
    expect(SAMPLE_AIRPORT_COUNT).toBe(84);
  });

  it("maps each metro that is not itself an airport to its first airport, in the seed's order", () => {
    for (const [metro, airports] of Object.entries(seed.cities)) {
      if (metro in SAMPLE_AIRPORTS) {
        expect(sampleAirport(metro), metro).toBe(metro);
        continue;
      }
      expect(SAMPLE_METROS[metro], metro).toBe(airports[0]);
      expect(airportInfo(metro), metro).toBe(SAMPLE_AIRPORTS[airports[0]!]);
    }
    expect(sampleAirport("TYO")).toBe("NRT");
    expect(sampleAirport("NYC")).toBe("JFK");
    expect(sampleAirport("LON")).toBe("LHR");
  });

  it("gives every airport plausible coordinates, a UTC offset and a seats.aero region", () => {
    for (const [code, a] of Object.entries(SAMPLE_AIRPORTS)) {
      expect(a.lat, code).toBeGreaterThanOrEqual(-90);
      expect(a.lat, code).toBeLessThanOrEqual(90);
      expect(a.lon, code).toBeGreaterThanOrEqual(-180);
      expect(a.lon, code).toBeLessThanOrEqual(180);
      expect(a.utc, code).toBeGreaterThanOrEqual(-12);
      expect(a.utc, code).toBeLessThanOrEqual(14);
      expect(Number.isInteger(a.utc * 2), code).toBe(true);
      expect(REGIONS.has(a.region), code).toBe(true);
    }
  });

  it("measures great-circle statute miles, and nothing outside the seed", () => {
    // Published great-circle distances, within 1 %.
    for (const [from, to, miles] of [
      ["HKG", "SEA", 6_490],
      ["LAX", "NRT", 5_451],
      ["JFK", "LHR", 3_451],
      ["SFO", "SYD", 7_417],
    ] as const) {
      const measured = greatCircleMiles(from, to)!;
      expect(Math.abs(measured - miles) / miles, `${from}-${to}: ${measured}`).toBeLessThan(0.01);
    }
    expect(greatCircleMiles("TYO", "SEL")).toBe(greatCircleMiles("NRT", "ICN"));
    expect(greatCircleMiles("LIS", "SEA")).toBeNull();
    expect(sampleCovers("LIS")).toBe(false);
  });
});
