/**
 * scripts/mock-seatsaero.ts in DEMO mode: an ephemeral server, hit with fetch on 127.0.0.1 only,
 * one test per scenario key plus the include_filtered / routes / trips contracts the app relies on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Availability, SearchResponse, TripsResponse } from "@/lib/seatsaero/types";
import { DEMO_UNMONITORED_ORIGIN } from "../fixtures/demo/generate";
import { DEMO_KEYS, DEMO_PARTIAL_PROGRAM, createMockServer, type MockHandle } from "./mock-seatsaero";

const NOW = new Date("2026-09-06T15:00:00Z");
let demo: MockHandle;
const logs: string[] = [];

beforeAll(async () => {
  demo = await createMockServer({ demo: true, port: 0, now: () => NOW, log: (l) => logs.push(l), slowMs: 300 });
});
afterAll(async () => {
  await demo.close();
});

/** `key: null` sends no Partner-Authorization header at all. */
function get(path: string, key: string | null = DEMO_KEYS.normal, init: RequestInit = {}) {
  return fetch(`${demo.baseUrl}${path}`, { ...init, headers: key === null ? {} : { "Partner-Authorization": key } });
}
async function search(query: string, key: string = DEMO_KEYS.normal) {
  const res = await get(`search?${query}`, key);
  expect(res.status).toBe(200);
  return SearchResponse.parse(await res.json());
}
const today = NOW.toISOString().slice(0, 10);
const baseQuery = `origin_airport=HKG,PVG,SHA,NRT,HND,ICN&destination_airport=SEA&cabins=business,first&take=1000`;

describe("mock seats.aero — DEMO=1", () => {
  it("binds an ephemeral port and loads the demo dataset with dates shifted to today", async () => {
    expect(demo.port).toBeGreaterThan(0);
    expect(demo.demo).toBe(true);
    expect(demo.rowCount).toBeGreaterThan(100);
    const body = await search(baseQuery);
    expect([...new Set(body.data.map((r) => r.Date))].sort()[0]).toBe(today);
    expect(body.hasMore).toBe(false);
  });

  it("rejects a missing or blank Partner-Authorization with 401", async () => {
    expect((await get("search?origin_airport=HKG", null)).status).toBe(401);
    expect((await get("search?origin_airport=HKG", "  ")).status).toBe(401);
  });

  it("demo-key-normal (and any other non-empty key) serves the full dataset in the official shape", async () => {
    const normal = await search(baseQuery);
    const other = await search(baseQuery, "pro_dev_alice_FAKE_SEATS_KEY_a1c3");
    expect(other.data.map((r) => r.ID)).toEqual(normal.data.map((r) => r.ID));
    expect(normal.data.length).toBeGreaterThan(50);
    for (const row of normal.data) {
      expect(Availability.safeParse(row).success).toBe(true);
      // UpdatedAt is rebuilt from _demo_updated_minutes_ago relative to "now".
      const ago = (NOW.getTime() - Date.parse(String(row.UpdatedAt))) / 60_000;
      expect(ago).toBe(Number(row._demo_updated_minutes_ago));
      expect(ago).toBeGreaterThanOrEqual(20);
      expect(ago).toBeLessThanOrEqual(3 * 24 * 60);
      expect(row.Route.OriginAirport).not.toBe(DEMO_UNMONITORED_ORIGIN);
    }
  });

  it("include_filtered=false omits _demo_dynamic rows; include_filtered=true includes them", async () => {
    const off = await search(baseQuery);
    const on = await search(`${baseQuery}&include_filtered=true`);
    expect(off.data.some((r) => r._demo_dynamic === true)).toBe(false);
    const dynamic = on.data.filter((r) => r._demo_dynamic === true);
    expect(dynamic.length).toBeGreaterThanOrEqual(5);
    expect(on.data.length).toBe(off.data.length + dynamic.length);
  });

  it("filters by origin, sources, cabins, only_direct_flights and the date window", async () => {
    const hkg = await search(`origin_airport=HKG&destination_airport=SEA&cabins=business&take=1000`);
    expect(hkg.data.length).toBeGreaterThan(0);
    for (const r of hkg.data) {
      expect(r.Route.OriginAirport).toBe("HKG");
      expect(r.JAvailable).toBe(true);
    }
    const alaska = await search(`${baseQuery}&sources=alaska`);
    expect(alaska.data.length).toBeGreaterThan(0);
    for (const r of alaska.data) expect(r.Source).toBe("alaska");
    const direct = await search(`${baseQuery}&only_direct_flights=true`);
    for (const r of direct.data) expect((r.JAvailable && r.JDirect) || (r.FAvailable && r.FDirect)).toBe(true);
    const firstOnly = await search(`${baseQuery.replace("business,first", "first")}`);
    for (const r of firstOnly.data) expect(r.FAvailable).toBe(true);
    const window = await search(`${baseQuery}&start_date=${today}&end_date=${today}`);
    expect(window.data.length).toBeGreaterThan(0);
    for (const r of window.data) expect(r.Date).toBe(today);
  });

  it("pages with take/skip/hasMore like the real API", async () => {
    const page1 = await search(`${baseQuery.replace("take=1000", "take=10")}`);
    expect(page1.data).toHaveLength(10);
    expect(page1.count).toBe(10);
    expect(page1.hasMore).toBe(true);
    const all = await search(baseQuery);
    const last = await search(`${baseQuery.replace("take=1000", "take=10")}&skip=${all.data.length - 3}`);
    expect(last.data).toHaveLength(3);
    expect(last.hasMore).toBe(false);
  });

  it("/availability?source= serves one program with cabin= singular", async () => {
    const res = await get(`availability?source=united&cabin=business&take=1000`);
    expect(res.status).toBe(200);
    const body = SearchResponse.parse(await res.json());
    expect(body.data.length).toBeGreaterThan(0);
    for (const r of body.data) {
      expect(r.Source).toBe("united");
      expect(r.JAvailable).toBe(true);
    }
  });

  it("demo-key-empty answers 200 with no rows on /search and /availability", async () => {
    const s = await search(baseQuery, DEMO_KEYS.empty);
    expect(s.data).toEqual([]);
    expect(s.hasMore).toBe(false);
    const a = await get("availability?source=alaska", DEMO_KEYS.empty);
    expect(a.status).toBe(200);
    expect((await a.json()).data).toEqual([]);
    const routes = await get("routes?source=alaska", DEMO_KEYS.empty);
    expect(routes.status).toBe(200);
    expect((await routes.json()).length).toBeGreaterThan(0);
  });

  it("demo-key-error answers HTTP 500 {} on /search only", async () => {
    const res = await get(`search?${baseQuery}`, DEMO_KEYS.error);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({});
    expect((await get("routes?source=alaska", DEMO_KEYS.error)).status).toBe(200);
  });

  it("demo-key-slow delays every response (slowMs shortened for the test)", async () => {
    const started = Date.now();
    const body = await search(baseQuery, DEMO_KEYS.slow);
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
    expect(body.data.length).toBeGreaterThan(50);
  });

  it("demo-key-partial omits aeroplan rows and 500s /routes?source=aeroplan", async () => {
    const normal = await search(`${baseQuery}&include_filtered=true`);
    const partial = await search(`${baseQuery}&include_filtered=true`, DEMO_KEYS.partial);
    expect(normal.data.some((r) => r.Source === DEMO_PARTIAL_PROGRAM)).toBe(true);
    expect(partial.data.some((r) => r.Source === DEMO_PARTIAL_PROGRAM)).toBe(false);
    expect(partial.data.length).toBe(normal.data.filter((r) => r.Source !== DEMO_PARTIAL_PROGRAM).length);
    expect((await get(`routes?source=${DEMO_PARTIAL_PROGRAM}`, DEMO_KEYS.partial)).status).toBe(500);
    expect((await get(`availability?source=${DEMO_PARTIAL_PROGRAM}`, DEMO_KEYS.partial)).status).toBe(500);
    expect((await get("routes?source=alaska", DEMO_KEYS.partial)).status).toBe(200);
  });

  it("/routes?source= lists the monitored pairs, never ICN→SEA, and [] for an unknown source", async () => {
    const res = await get("routes?source=alaska");
    expect(res.status).toBe(200);
    const routes = (await res.json()) as { OriginAirport: string; DestinationAirport: string; Source: string; NumDaysOut: number }[];
    expect(routes.map((r) => r.OriginAirport).sort()).toEqual(["HKG", "HND", "NRT", "PVG", "SHA"]);
    for (const r of routes) {
      expect(r.Source).toBe("alaska");
      expect(r.DestinationAirport).toBe("SEA");
      expect(r.NumDaysOut).toBe(330);
    }
    for (const source of ["american", "united", "aeroplan", "singapore", "jetblue", "flyingblue"]) {
      const list = (await (await get(`routes?source=${source}`)).json()) as { OriginAirport: string }[];
      expect(list.some((r) => r.OriginAirport === DEMO_UNMONITORED_ORIGIN)).toBe(false);
    }
    expect(await (await get("routes?source=nosuchprogram")).json()).toEqual([]);
  });

  it("/trips/{id} serves the fixture payload with shifted dates; unknown id → 404", async () => {
    const rows = (await search(`${baseQuery}&include_filtered=true`)).data;
    const row = rows[5]!;
    const res = await get(`trips/${row.ID}`);
    expect(res.status).toBe(200);
    const trips = TripsResponse.parse(await res.json());
    expect(trips.data.length).toBeGreaterThanOrEqual(2);
    expect(trips.booking_links.filter((l) => l.primary)).toHaveLength(1);
    for (const t of trips.data) {
      expect(t.AvailabilityID).toBe(row.ID);
      expect(t.DepartsAt.startsWith(row.Date)).toBe(true);
      expect(t.UpdatedAt).toBe(row.UpdatedAt);
      for (const s of t.AvailabilitySegments) expect(s.DepartsAt.slice(0, 10) >= row.Date).toBe(true);
    }
    expect((await get("trips/2NoSuchAvailabilityId")).status).toBe(404);
  });

  it("logs one line per request without header values", () => {
    expect(logs.length).toBeGreaterThan(10);
    for (const line of logs) {
      expect(line).toMatch(/^GET \/partnerapi\/\S* \d{3} \d+ms$/);
      expect(line).not.toContain("demo-key");
      expect(line).not.toContain("FAKE");
    }
  });
});

describe("mock seats.aero — default (non-demo) mode is unchanged", () => {
  let plain: MockHandle;
  beforeAll(async () => {
    plain = await createMockServer({ demo: false, port: 0, now: () => NOW, log: () => {} });
  });
  afterAll(async () => {
    await plain.close();
  });

  it("serves the recorded synthetic fixture and ignores demo scenario keys", async () => {
    expect(plain.demo).toBe(false);
    const fetchAll = async (key: string) => {
      const res = await fetch(`${plain.baseUrl}search?origin_airport=HKG,PVG,SHA,NRT,HND,ICN&destination_airport=SEA&cabins=business,first&take=1000`, { headers: { "Partner-Authorization": key } });
      expect(res.status).toBe(200);
      return SearchResponse.parse(await res.json());
    };
    const normal = await fetchAll("pro_dev_alice_FAKE_SEATS_KEY_a1c3");
    expect(normal.data.length).toBeGreaterThan(50);
    expect(normal.data.some((r) => "_demo_dynamic" in r)).toBe(false);
    expect([...new Set(normal.data.map((r) => r.Date))].sort()[0]).toBe(today);
    const asError = await fetchAll(DEMO_KEYS.error);
    expect(asError.data.length).toBe(normal.data.length);
    const trips = await fetch(`${plain.baseUrl}trips/${normal.data[0]!.ID}`, { headers: { "Partner-Authorization": "x" } });
    expect(trips.status).toBe(200);
    expect(TripsResponse.safeParse(await trips.json()).success).toBe(true);
    const routes = await fetch(`${plain.baseUrl}routes?source=alaska`, { headers: { "Partner-Authorization": "x" } });
    expect(((await routes.json()) as unknown[]).length).toBeGreaterThan(0);
  });
});
