/**
 * fixtures/demo — the generator is deterministic, the committed files match it, and the dataset
 * has the shape Phase 6 §7 asks for (sparse F, moderate J, three-program cells, an unmonitored
 * pair, dynamic rows, freshness 20 min .. 3 days) in the official Availability / Trips shapes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Availability, Route, SEATS_SOURCES, TripsResponse } from "@/lib/seatsaero/types";
import {
  DEMO_ANCHOR,
  DEMO_DAYS,
  DEMO_DEST,
  DEMO_FILES,
  DEMO_FRESHNESS_MAX_MINUTES,
  DEMO_FRESHNESS_MIN_MINUTES,
  DEMO_ORIGINS,
  DEMO_PROGRAMS,
  DEMO_UNMONITORED_ORIGIN,
  addDays,
  generateDemo,
  renderDemoFiles,
} from "../fixtures/demo/generate";

const dataset = generateDemo();
const rows = dataset.availability.data;
const monitoredOrigins = DEMO_ORIGINS.filter((o) => o !== DEMO_UNMONITORED_ORIGIN);
const pairDays = monitoredOrigins.length * DEMO_DAYS;
const pairDayKey = (r: { Route: { OriginAirport: string }; Date: string }) => `${r.Route.OriginAirport}|${r.Date}`;

describe("fixtures/demo generator", () => {
  it("is deterministic and the committed files are up to date", () => {
    const again = renderDemoFiles(generateDemo());
    const first = renderDemoFiles(dataset);
    expect(again).toEqual(first);
    for (const key of ["availability", "trips", "routes"] as const) {
      expect(readFileSync(DEMO_FILES[key], "utf8"), `${key}.json is stale — run pnpm exec tsx fixtures/demo/generate.ts`).toBe(first[key]);
    }
  });

  it("declares itself synthetic and anchored", () => {
    expect(dataset.availability._synthetic).toBe(true);
    expect(dataset.availability._anchor).toBe(DEMO_ANCHOR);
    expect(dataset.availability._generated_by).toBe("fixtures/demo/generate.ts");
  });

  it("every row parses with the official Availability schema and uses only real source codes", () => {
    expect(rows.length).toBeGreaterThan(100);
    for (const row of rows) {
      const parsed = Availability.safeParse(row);
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
      expect(SEATS_SOURCES).toContain(row.Source);
      expect(row.Route.Source).toBe(row.Source);
      expect(row.Route.DestinationAirport).toBe(DEMO_DEST);
      expect(typeof row.JMileageCost).toBe("string");
      expect(row.YAvailable).toBe(false);
      expect(row.WAvailable).toBe(false);
      expect(row.JAvailable || row.FAvailable).toBe(true);
    }
    expect(new Set(rows.map((r) => r.ID)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.Source))).toEqual(new Set(DEMO_PROGRAMS));
    for (const p of DEMO_PROGRAMS) expect(SEATS_SOURCES).toContain(p);
  });

  it("covers exactly the 30 anchored days for the canonical origins", () => {
    const dates = new Set(rows.map((r) => r.Date));
    expect([...dates].sort()[0]).toBe(DEMO_ANCHOR);
    for (const d of dates) {
      expect(d >= DEMO_ANCHOR && d <= addDays(DEMO_ANCHOR, DEMO_DAYS - 1)).toBe(true);
    }
    expect(new Set(rows.map((r) => r.Route.OriginAirport))).toEqual(new Set(monitoredOrigins));
  });

  it("has sparse F (~15%) and moderate J (~45%) across pair-days, with some three-program cells", () => {
    const jDays = new Set(rows.filter((r) => r.JAvailable).map(pairDayKey)).size / pairDays;
    const fDays = new Set(rows.filter((r) => r.FAvailable).map(pairDayKey)).size / pairDays;
    expect(jDays).toBeGreaterThanOrEqual(0.35);
    expect(jDays).toBeLessThanOrEqual(0.55);
    expect(fDays).toBeGreaterThanOrEqual(0.08);
    expect(fDays).toBeLessThanOrEqual(0.22);
    const perPairDay = new Map<string, number>();
    for (const r of rows) perPairDay.set(pairDayKey(r), (perPairDay.get(pairDayKey(r)) ?? 0) + 1);
    expect([...perPairDay.values()].filter((n) => n === 3).length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...perPairDay.values())).toBeLessThanOrEqual(3);
    // "No availability" cells exist too: fewer pair-days with rows than pair-days in total.
    expect(perPairDay.size).toBeLessThan(pairDays);
  });

  it("keeps ICN→SEA unmonitored: no rows and absent from every /routes list", () => {
    expect(rows.some((r) => r.Route.OriginAirport === DEMO_UNMONITORED_ORIGIN)).toBe(false);
    expect(Object.keys(dataset.routes).sort()).toEqual([...DEMO_PROGRAMS].sort());
    for (const [source, routes] of Object.entries(dataset.routes)) {
      expect(routes.map((r) => r.OriginAirport).sort()).toEqual([...monitoredOrigins].sort());
      for (const route of routes) {
        expect(Route.safeParse(route).success).toBe(true);
        expect(route.Source).toBe(source);
        expect(route.NumDaysOut).toBe(330);
        expect(route.DestinationAirport).toBe(DEMO_DEST);
      }
    }
  });

  it("has several dynamic-priced rows flagged _demo_dynamic", () => {
    const dynamic = rows.filter((r) => r._demo_dynamic === true);
    expect(dynamic.length).toBeGreaterThanOrEqual(5);
    expect(dynamic.length).toBeLessThan(rows.length / 3);
    for (const r of rows) expect(r._demo_dynamic === undefined || r._demo_dynamic === true).toBe(true);
  });

  it("spreads freshness from 20 minutes to 3 days as minutes-ago", () => {
    const ages = rows.map((r) => r._demo_updated_minutes_ago);
    expect(Math.min(...ages)).toBe(DEMO_FRESHNESS_MIN_MINUTES);
    expect(Math.max(...ages)).toBe(DEMO_FRESHNESS_MAX_MINUTES);
    expect(ages.filter((a) => a <= 120).length).toBeGreaterThan(rows.length / 4); // fresh
    expect(ages.filter((a) => a > 120 && a <= 360).length).toBeGreaterThan(5); // aging
    expect(ages.filter((a) => a > 360).length).toBeGreaterThan(5); // stale
    for (const r of rows) {
      expect(Date.parse(`${DEMO_ANCHOR}T12:00:00Z`) - Date.parse(r.UpdatedAt)).toBe(r._demo_updated_minutes_ago * 60_000);
    }
  });

  it("uses realistic, program-dependent miles, seats 0–4, airline strings and direct flags", () => {
    for (const r of rows) {
      if (r.JAvailable) {
        const miles = Number(r.JMileageCost);
        expect(miles).toBeGreaterThanOrEqual(55_000);
        expect(miles).toBeLessThanOrEqual(120_000);
        expect(miles % 500).toBe(0);
        expect(r.JAirlines).toMatch(/^[A-Z0-9]{2}(, [A-Z0-9]{2})*$/);
        expect(r.JRemainingSeats).toBeGreaterThanOrEqual(0);
        expect(r.JRemainingSeats).toBeLessThanOrEqual(4);
      } else {
        expect(r.JMileageCost).toBe("0");
        expect(r.JAirlines).toBe("");
        expect(r.JDirect).toBe(false);
      }
      if (r.FAvailable) {
        const miles = Number(r.FMileageCost);
        expect(miles).toBeGreaterThanOrEqual(70_000);
        expect(miles).toBeLessThanOrEqual(160_000);
        expect(r.FAirlines).toMatch(/^[A-Z0-9]{2}$/);
      } else {
        expect(r.FMileageCost).toBe("0");
      }
    }
    expect(rows.some((r) => r.JAvailable && r.JRemainingSeats === 0)).toBe(true); // 0 = unknown
    expect(rows.some((r) => r.JAvailable && r.JDirect)).toBe(true);
    expect(rows.some((r) => r.JAvailable && !r.JDirect)).toBe(true);
    expect(rows.some((r) => r.JAirlines.includes(", "))).toBe(true);
    // Program-dependent: a cheap program's median J price sits below an expensive one's.
    const median = (p: string) => {
      const xs = rows.filter((r) => r.Source === p && r.JAvailable && !r._demo_dynamic).map((r) => Number(r.JMileageCost)).sort((a, b) => a - b);
      return xs[Math.floor(xs.length / 2)]!;
    };
    expect(median("american")).toBeLessThan(median("singapore"));
  });

  it("has a Get Trips payload for every availability that parses with TripsResponse", () => {
    expect(Object.keys(dataset.trips).sort()).toEqual(rows.map((r) => r.ID).sort());
    for (const row of rows) {
      const payload = dataset.trips[row.ID]!;
      const parsed = TripsResponse.safeParse(payload);
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
      expect(payload.data.length).toBeGreaterThanOrEqual(2);
      expect(payload.data.length).toBeLessThanOrEqual(3);
      expect(payload.booking_links.filter((l) => l.primary)).toHaveLength(1);
      expect(payload.booking_links.find((l) => l.primary)!.link).toContain(`/demo-booking/${row.Source}`);
      for (const trip of payload.data) {
        expect(trip.AvailabilityID).toBe(row.ID);
        expect(trip.Source).toBe(row.Source);
        expect(["business", "first"]).toContain(trip.Cabin);
        expect(trip.AvailabilitySegments.length).toBe(trip.Stops + 1);
        expect(trip.AvailabilitySegments[0]!.OriginAirport).toBe(row.Route.OriginAirport);
        expect(trip.AvailabilitySegments.at(-1)!.DestinationAirport).toBe(DEMO_DEST);
        expect(trip.DepartsAt.startsWith(row.Date)).toBe(true);
        expect(Number.isInteger(trip.TotalTaxes)).toBe(true);
        expect(["", "USD"]).toContain(trip.TaxesCurrency);
        expect(trip.FlightNumbers.split(", ")).toHaveLength(trip.AvailabilitySegments.length);
      }
    }
  });
});
