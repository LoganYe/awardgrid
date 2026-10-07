/**
 * Sample mode's transport (release plan step 16): the four seats.aero partner endpoints answered in memory, in the
 * documented shapes, with the filters scripts/mock-seatsaero.ts applies; 404 for anything else. And the app's own
 * engine running on it: a search, an option's itineraries, an empty route's coverage, a code outside the seed.
 */
import { QueryObject } from "@awardgrid/core/query/schema";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import { RoutesResponse, SearchResponse, TripsResponse } from "@awardgrid/core/seatsaero/types";
import { describe, expect, it } from "vitest";
import { SearchEngine } from "../search/search";
import { DeviceQuotaStore } from "../store/quota-store";
import { SAMPLE_AIRPORT_COUNT } from "./airports";
import { readAvailabilityId } from "./generate";
import { createSampleFetch, sampleRows } from "./sample-fetch";
import { DEMO_PROGRAMS, addDays } from "./shared";

const NOW = new Date("2026-10-18T08:30:00Z");
const TODAY = "2026-10-18";
const api = createSampleFetch({ now: () => NOW });
const KEY = { headers: { "Partner-Authorization": "sample" } };

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await api(`https://seats.aero/partnerapi/${path}`, KEY);
  return { status: res.status, body: await res.json() };
}
type Row = SearchResponse["data"][number];
async function search(query: string): Promise<{ data: Row[]; hasMore?: boolean; count?: number }> {
  const { status, body } = await get(`search?${query}`);
  expect(status).toBe(200);
  return SearchResponse.parse(body);
}
const window30 = `start_date=${TODAY}&end_date=${addDays(TODAY, 29)}`;

describe("Cached Search", () => {
  it("answers in the documented shape, only the routes, days and cabins asked for", async () => {
    const { data } = await search(`origin_airport=HKG,TPE&destination_airport=SEA,SFO&${window30}&take=1000&cabins=business`);
    expect(data.length).toBeGreaterThan(10);
    for (const row of data) {
      expect(["HKG", "TPE"]).toContain(row.Route.OriginAirport);
      expect(["SEA", "SFO"]).toContain(row.Route.DestinationAirport);
      expect(row.Date >= TODAY && row.Date <= addDays(TODAY, 29)).toBe(true);
      expect(row.JAvailable).toBe(true);
      expect(DEMO_PROGRAMS as readonly string[]).toContain(row.Source);
      expect(readAvailabilityId(row.ID)).toMatchObject({ origin: row.Route.OriginAirport, destination: row.Route.DestinationAirport, date: row.Date, program: row.Source });
      // No source update time is claimed: the app says "Sample data" there.
      expect(row.UpdatedAt).toBeUndefined();
    }
    expect(new Set(data.map((r) => r.ID)).size).toBe(data.length);
  });

  it("filters by program, by nonstop and by dynamic pricing, as the mock does", async () => {
    const all = (await search(`origin_airport=LAX&destination_airport=NRT,HND&${window30}&take=1000&include_filtered=true`)).data;
    const plain = (await search(`origin_airport=LAX&destination_airport=NRT,HND&${window30}&take=1000`)).data;
    expect(plain.length).toBeLessThan(all.length);
    const one = (await search(`origin_airport=LAX&destination_airport=NRT,HND&${window30}&take=1000&sources=alaska,american&include_filtered=true`)).data;
    expect(one.length).toBeGreaterThan(0);
    expect(new Set(one.map((r) => r.Source))).toEqual(new Set(["alaska", "american"].filter((p) => one.some((r) => r.Source === p))));
    expect(one.every((r) => r.Source === "alaska" || r.Source === "american")).toBe(true);
    const direct = (await search(`origin_airport=LAX&destination_airport=NRT&${window30}&take=1000&cabins=business&only_direct_flights=true`)).data;
    expect(direct.length).toBeGreaterThan(0);
    expect(direct.every((r) => r.JDirect === true)).toBe(true);
  });

  it("pages with take and skip, and says when there is more", async () => {
    const q = `origin_airport=HKG,PVG,NRT&destination_airport=SEA,SFO,LAX&${window30}&include_filtered=true`;
    const whole = (await search(`${q}&take=1000`)).data;
    expect(whole.length).toBeGreaterThan(20);
    const first = await search(`${q}&take=10`);
    const second = await search(`${q}&take=10&skip=10`);
    expect(first.data.map((r) => r.ID)).toEqual(whole.slice(0, 10).map((r) => r.ID));
    expect(second.data.map((r) => r.ID)).toEqual(whole.slice(10, 20).map((r) => r.ID));
    expect(first.hasMore).toBe(true);
    expect((await search(`${q}&take=1000`)).hasMore).toBe(false);
  });

  it("has nothing outside the seed or outside today … today + 364", async () => {
    expect((await search(`origin_airport=LIS&destination_airport=SEA&${window30}`)).data).toEqual([]);
    expect((await search(`origin_airport=HKG&destination_airport=SEA&start_date=2027-11-01&end_date=2027-11-30`)).data).toEqual([]);
    const straddle = (await search(`origin_airport=HKG&destination_airport=SEA&start_date=2027-10-01&end_date=2027-11-30&take=1000`)).data;
    expect(straddle.every((r) => r.Date <= "2027-10-17")).toBe(true);
  });

  it("is the same answer twice", async () => {
    const q = `origin_airport=HKG&destination_airport=SEA&${window30}&take=1000`;
    expect(await search(q)).toEqual(await search(q));
    expect(sampleRows("HKG", "SEA", "2026-11-02", TODAY)).toEqual(sampleRows("HKG", "SEA", "2026-11-02", TODAY));
  });
});

describe("Bulk Availability, Get Routes, Get Trips, and everything else", () => {
  it("Bulk Availability needs a program, and slices by region", async () => {
    expect((await get(`availability?${window30}`)).status).toBe(400);
    const { status, body } = await get(`availability?source=united&cabin=business&origin_region=Oceania&destination_region=North%20America&${window30}&take=1000`);
    expect(status).toBe(200);
    const rows = SearchResponse.parse(body).data;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.Source).toBe("united");
      expect(row.Route.OriginRegion).toBe("Oceania");
      expect(row.Route.DestinationRegion).toBe("North America");
      expect(row.JAvailable).toBe(true);
    }
  });

  it("Get Routes lists every pair of the seed's airports for a sample program, and none for another", async () => {
    const united = RoutesResponse.parse((await get("routes?source=united")).body);
    expect(united).toHaveLength(SAMPLE_AIRPORT_COUNT * (SAMPLE_AIRPORT_COUNT - 1));
    expect(united.every((r) => r.Source === "united" && r.OriginAirport !== r.DestinationAirport)).toBe(true);
    expect(RoutesResponse.parse((await get("routes?source=delta")).body)).toEqual([]);
  });

  it("Get Trips draws the itineraries again from the id alone, every cabin, with no booking links", async () => {
    // A day a week out, so it is still covered on the next day's clock below.
    const row = (await search(`origin_airport=HKG&destination_airport=SEA&${window30}&take=1000`)).data.find((r) => r.Date >= "2026-10-25")!;
    const { status, body } = await get(`trips/${row.ID}?include_filtered=false`);
    expect(status).toBe(200);
    const trips = TripsResponse.parse(body);
    expect(trips.booking_links).toEqual([]);
    expect(trips.data.length).toBeGreaterThan(0);
    for (const trip of trips.data) {
      expect(trip.AvailabilityID).toBe(row.ID);
      expect(trip.ID.startsWith(`${row.ID}-`)).toBe(true);
      expect(trip.AvailabilitySegments[0]!.OriginAirport).toBe("HKG");
      expect(trip.AvailabilitySegments.at(-1)!.DestinationAirport).toBe("SEA");
      expect(trip.Stops).toBe(trip.AvailabilitySegments.length - 1);
    }
    expect(JSON.stringify(body)).not.toMatch(/https?:/);
    // Drawn again, after a relaunch, from the same id: the same itineraries.
    const again = createSampleFetch({ now: () => new Date("2026-10-19T01:00:00Z") });
    expect(await (await again(`https://seats.aero/partnerapi/trips/${row.ID}`, KEY)).json()).toEqual(body);
    // A day that has passed since (a saved snapshot) still draws the same itineraries; one past the window has none.
    const past = (await search(`origin_airport=HKG,TPE,NRT,ICN,PVG&destination_airport=SEA,SFO,LAX&start_date=${TODAY}&end_date=${TODAY}&take=1000`)).data[0];
    expect(past).toBeDefined();
    expect(await (await again(`https://seats.aero/partnerapi/trips/${past!.ID}`, KEY)).json()).toEqual((await get(`trips/${past!.ID}`)).body);
    expect((await get(`trips/smp-HKG-SEA-${addDays(TODAY, 400).replaceAll("-", "")}-alaska`)).status).toBe(404);
    expect((await get("trips/smp-HKG-SEA-20261102-delta")).status).toBe(404);
    expect((await get("trips/not-a-sample-id")).status).toBe(404);
  });

  it("answers 404 to any other path, method or host, and never reaches the network", async () => {
    expect((await get("live")).status).toBe(404);
    expect((await api("https://seats.aero/partnerapi/search", { method: "POST" })).status).toBe(404);
    expect((await api("https://api.anthropic.com/v1/messages", { method: "POST" })).status).toBe(404);
    expect((await api("https://example.com/", KEY)).status).toBe(404);
  });
});

describe("the app's engine on sample data", () => {
  const engine = () => new SearchEngine({ fetchImpl: api, quota: new Quota({ store: new DeviceQuotaStore(), now: () => NOW }), now: () => NOW });

  it("a typed search finds rows: \"Hong Kong to Seattle next month, business\" and \"LAX to Tokyo next month\"", async () => {
    const e = engine();
    const hk = await e.search("Hong Kong to Seattle next month, business", "sample");
    expect(hk.ok).toBe(true);
    if (!hk.ok) return;
    expect(hk.value.rows!.length).toBeGreaterThan(5);
    expect(hk.value.rows!.every((r) => r.origin === "HKG" && r.dest === "SEA" && r.cabin === "J" && r.booking_url === null)).toBe(true);
    const lax = await e.search("LAX to Tokyo next month", "sample");
    expect(lax.ok && lax.value.rows!.length).toBeGreaterThan(5);
  });

  it("an option's itineraries load through the engine's own Get Trips", async () => {
    const e = engine();
    const res = await e.search("Hong Kong to Seattle next month, business", "sample");
    if (!res.ok) throw new Error(res.message);
    const row = res.value.rows![0]!;
    const trips = await e.getTrips({ availabilityId: row.source_id, cabin: "J", include_filtered: false, min_cabin_pct: 100 }, "sample");
    expect(trips.ok).toBe(true);
    if (!trips.ok) return;
    expect(trips.value.trips.length).toBeGreaterThan(0);
    expect(trips.value.trips[0]!.miles).toBe(row.miles);
    expect(trips.value.booking_url).toBeNull();
    expect(trips.value.booking_links).toEqual([]);
  });

  it("an empty day on a seed route is checked and empty, never 'not monitored'; a code outside the seed is not monitored", async () => {
    const e = engine();
    const empty = await e.searchQuery(QueryObject.parse({ origins: ["SFO"], destinations: ["OAK"], date_from: "2026-10-20", date_to: "2026-10-20", cabins: ["F"], raw_text: "x", language: "en" }), "sample");
    expect(empty.ok && empty.value.rows).toEqual([]);
    expect(empty.ok && empty.value.coverage?.state).toBe("complete");
    expect(empty.ok && empty.value.coverage?.slices.every((s) => s.state === "complete")).toBe(true);
    const outside = await e.searchQuery(QueryObject.parse({ origins: ["LIS"], destinations: ["SEA"], date_from: TODAY, date_to: addDays(TODAY, 29), cabins: ["J"], raw_text: "x", language: "en" }), "sample");
    expect(outside.ok && outside.value.coverage?.slices[0]?.state).toBe("unmonitored");
  });

  // The 100 ms budget is the Simulator's (measured there and recorded in the PR: 22 ms cold, 1–4 ms warm). Here the
  // bound only catches a gross regression, such as a walk over every route: a loaded machine or a CI runner can stall
  // any one call for tens of milliseconds, and a timing test that fails on that says nothing about the generator.
  it("a 30-day, 2 × 2-airport search draws only what it asks for, in well under a second here", async () => {
    const started = performance.now();
    await api(`https://seats.aero/partnerapi/search?origin_airport=HKG,TPE&destination_airport=SEA,SFO&${window30}&take=1000`, KEY);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
