/**
 * findGridForUser / getTripsForUser / parseForUser over an in-memory SQLite with a seeded user,
 * an encrypted key (test master key) and a fake fetch over the synthetic fixture. No network,
 * no env keys. Also asserts that the decrypted key only ever appears in the
 * Partner-Authorization header of requests made on that user's behalf.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTestDb, type Db } from "@/lib/db/client";
import { apiUsage, availabilityCache } from "@/lib/db/schema";
import { seedUsers } from "@/lib/db/stores/testing";
import { setKey } from "@/lib/keys";
import { QueryObject, type QueryObjectInput } from "@/lib/query/schema";
import type { Route, TripsResponse } from "@/lib/seatsaero/types";
import {
  NoKeyError,
  ParseError,
  QuotaExceededError,
  exportFilename,
  findGridForUser,
  getTripsForUser,
  gridErrorResponse,
  llmAvailable,
  parseForUser,
  summarizeTrip,
  utcToday,
} from "@/lib/server/find";
import { SeatsAeroHttpError } from "@/lib/seatsaero/client";
import { fakeFetch, jsonResponse, loadFixture, textResponse } from "../../../test/fixtures/seatsaero/helpers";
import { SYNTHETIC_ORIGINS, SYNTHETIC_PROGRAMS, generateSynthetic } from "../../../test/fixtures/seatsaero/generate-synthetic";

const MASTER = Buffer.from("0f".repeat(32), "hex");
const ALICE_KEY = "alice_pro_key_SECRET_a1b2c3";
const BOB_KEY = "bob_pro_key_SECRET_z9y8x7";
const NOW = new Date("2026-10-01T12:00:00Z");
const now = () => NOW;

const synthetic = generateSynthetic();
const tripsFixture = loadFixture<TripsResponse>("trips__id.json");

function query(overrides: Partial<QueryObjectInput> = {}): QueryObject {
  return QueryObject.parse({
    origins: [...SYNTHETIC_ORIGINS],
    destinations: ["SEA"],
    date_from: "2026-10-01",
    date_to: "2026-10-30",
    cabins: ["J", "F"],
    programs: [...SYNTHETIC_PROGRAMS],
    raw_text: "test",
    language: "en",
    ...overrides,
  });
}

function syntheticRoutes(source: string): Route[] {
  return SYNTHETIC_ORIGINS.filter((o) => o !== "GMP").map((o) => ({
    ID: `${source}-${o}`,
    OriginAirport: o,
    OriginRegion: "Asia",
    DestinationAirport: "SEA",
    DestinationRegion: "North America",
    NumDaysOut: 330,
    Distance: 5000,
    Source: source,
  }));
}

function harness() {
  const db: Db = openTestDb();
  seedUsers(db, ["alice", "bob", "carol"]);
  setKey(db, "alice", "seats_aero", ALICE_KEY, { masterKey: MASTER, now: NOW });
  setKey(db, "bob", "seats_aero", BOB_KEY, { masterKey: MASTER, now: NOW });
  const fetch = fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") return jsonResponse(synthetic);
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse(syntheticRoutes(req.url.searchParams.get("source")!));
    if (req.url.pathname.startsWith("/partnerapi/trips/")) return jsonResponse(tripsFixture);
    return textResponse("not found", 404);
  });
  return { db, fetch };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findGridForUser", () => {
  it("builds a grid with the user's own key; the second call within the TTL is served from cache", async () => {
    const { db, fetch } = harness();
    const q = query();
    const first = await findGridForUser(db, { id: "alice" }, q, { now, fetch, masterKey: MASTER });
    expect(first.grid.orientation).toBe("dates");
    expect(first.grid.rows).toHaveLength(30);
    expect(first.grid.cols).toHaveLength(SYNTHETIC_ORIGINS.length);
    expect(first.grid.meta.served_from_cache).toBe(false);
    const N = 1 + SYNTHETIC_PROGRAMS.length; // one search page + Get Routes per program (GMP empty)
    expect(first.grid.meta.api_calls_used).toBe(N);
    expect(first.grid.meta.unmonitored_pairs).toEqual([{ origin: "GMP", dest: "SEA", key: "GMP-SEA" }]);
    expect(first.grid.cells.flat().some((c) => c.status === "ok")).toBe(true);
    expect(first.grid.cells.flat().filter((c) => c.origin === "GMP").every((c) => c.status === "unmonitored")).toBe(true);
    expect(first.quota).toEqual({ used: N, limit: 950, resetAt: "2026-10-02T00:00:00.000Z" });
    expect(first.warnings).toEqual([]);

    // Every request carried alice's key and nothing else.
    expect(fetch.calls).toHaveLength(N);
    expect(fetch.calls.every((c) => c.headers["partner-authorization"] === ALICE_KEY)).toBe(true);

    // Quota accounting rows were written for alice only.
    expect(db.select().from(apiUsage).all()).toEqual([{ userId: "alice", provider: "seats_aero", day: "2026-10-01", calls: N }]);
    expect(db.select().from(availabilityCache).all().every((r) => r.userId === "alice")).toBe(true);

    const second = await findGridForUser(db, { id: "alice" }, q, {
      now: () => new Date(NOW.getTime() + 20 * 60_000),
      fetch,
      masterKey: MASTER,
      orientation: "routes",
    });
    expect(second.grid.meta.served_from_cache).toBe(true);
    expect(second.grid.meta.api_calls_used).toBe(0);
    // The web facade wires a fresh RoutesCatalog per request: a cached render must still
    // hydrate it from routes_cache (zero calls) and keep the §4.3 "not monitored" state.
    expect(second.grid.meta.unmonitored_pairs).toEqual([{ origin: "GMP", dest: "SEA", key: "GMP-SEA" }]);
    expect(second.grid.cells.flat().filter((c) => c.origin === "GMP").every((c) => c.status === "unmonitored")).toBe(true);
    expect(second.grid.orientation).toBe("routes");
    expect(second.grid.rows).toHaveLength(SYNTHETIC_ORIGINS.length);
    expect(fetch.calls).toHaveLength(N);
    expect(second.quota.used).toBe(N);
  });

  it("two users with two keys have independent caches and quotas; each request carries only its owner's key", async () => {
    const { db, fetch } = harness();
    const q = query();
    await findGridForUser(db, { id: "alice" }, q, { now, fetch, masterKey: MASTER });
    const aliceCalls = fetch.calls.length;
    const bob = await findGridForUser(db, { id: "bob" }, q, { now, fetch, masterKey: MASTER });
    expect(bob.grid.meta.served_from_cache).toBe(false); // alice's cache must not serve bob
    const bobCalls = fetch.calls.slice(aliceCalls);
    expect(bobCalls.length).toBeGreaterThan(0);
    expect(bobCalls.every((c) => c.headers["partner-authorization"] === BOB_KEY)).toBe(true);
    expect(fetch.calls.slice(0, aliceCalls).every((c) => c.headers["partner-authorization"] === ALICE_KEY)).toBe(true);
    const usage = db.select().from(apiUsage).all();
    expect(usage.map((u) => u.userId).sort()).toEqual(["alice", "bob"]);
  });

  it("throws NoKeyError for a user without a key before touching the master key or the network", async () => {
    const { db, fetch } = harness();
    await expect(findGridForUser(db, { id: "carol" }, query(), { now, fetch })).rejects.toBeInstanceOf(NoKeyError);
    expect(fetch.calls).toHaveLength(0);
    expect(db.select().from(apiUsage).all()).toEqual([]);
  });

  it("maps upstream failures to a SeatsAeroError whose text never contains the key", async () => {
    const { db } = harness();
    const fetch = fakeFetch(() => textResponse(`unauthorized ${ALICE_KEY}`, 401));
    let caught: unknown;
    try {
      await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SeatsAeroHttpError);
    expect((caught as Error).message).not.toContain(ALICE_KEY);
    const res = gridErrorResponse(caught);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; kind: string; message: string };
    expect(body.error).toBe("seatsaero");
    expect(body.kind).toBe("invalid_key");
    expect(JSON.stringify(body)).not.toContain(ALICE_KEY);
  });
});

describe("getTripsForUser", () => {
  it("spends exactly one call, returns trips + fees + booking links, and records the call", async () => {
    const { db, fetch } = harness();
    const res = await getTripsForUser(db, { id: "alice" }, "2PPrELk9WcfJaNREWEPXypvhXAD", { now, fetch, masterKey: MASTER, cabin: "J" });
    expect(res.api_calls_used).toBe(1);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]!.url.pathname).toBe("/partnerapi/trips/2PPrELk9WcfJaNREWEPXypvhXAD");
    expect(fetch.calls[0]!.headers["partner-authorization"]).toBe(ALICE_KEY);
    expect(res.trips.length).toBeGreaterThan(0);
    expect(res.trips[0]!.segments.length).toBeGreaterThan(0);
    expect(res.fees_cents).not.toBeNull();
    expect(res.booking_links.length).toBeGreaterThan(0);
    expect(res.quota.used).toBe(1);
    expect(db.select().from(apiUsage).all()).toEqual([{ userId: "alice", provider: "seats_aero", day: "2026-10-01", calls: 1 }]);
    expect(JSON.stringify(res)).not.toContain(ALICE_KEY);
  });

  it("refuses with QuotaExceededError (reset time attached) when the soft limit is reached", async () => {
    const { db, fetch } = harness();
    db.insert(apiUsage).values({ userId: "alice", provider: "seats_aero", day: "2026-10-01", calls: 950 }).run();
    let caught: unknown;
    try {
      await getTripsForUser(db, { id: "alice" }, "abc", { now, fetch, masterKey: MASTER });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(QuotaExceededError);
    expect((caught as QuotaExceededError).resetAt.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(fetch.calls).toHaveLength(0);
    const res = gridErrorResponse(caught);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "quota", resetAt: "2026-10-02T00:00:00.000Z" });
    // Nothing was charged.
    expect(db.select().from(apiUsage).all()[0]!.calls).toBe(950);
  });

  it("summarizeTrip orders segments and normalises empty currency to null", () => {
    const trip = tripsFixture.data[0]!;
    const s = summarizeTrip({ ...trip, TaxesCurrency: "" });
    expect(s.currency).toBeNull();
    expect(s.segments.map((x) => x.flight_number)).toEqual(
      [...trip.AvailabilitySegments].sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0)).map((x) => x.FlightNumber),
    );
  });
});

describe("parseForUser", () => {
  it("parses the canonical Chinese query deterministically without any LLM", async () => {
    const result = await parseForUser("香港、上海、东京、首尔到西雅图，未来一个月最便宜的头等舱", { today: "2026-10-01", env: {} });
    expect(result.used_llm).toBe(false);
    expect(result.query.origins).toEqual(["HKG", "PVG", "SHA", "NRT", "HND", "ICN", "GMP"]);
    expect(result.query.destinations).toEqual(["SEA"]);
    expect(result.query.cabins).toEqual(["F"]);
    expect(result.query.date_from).toBe("2026-10-01");
    expect(result.query.date_to).toBe("2026-10-31");
    expect(result.query.sort_by).toBe("miles_asc");
    expect(result.query.language).toBe("zh");
    expect(result.provenance.origins).toBe("deterministic");
  });

  it("without ANTHROPIC_API_KEY an ambiguous query fails with a ParseError listing the missing fields (→ 422)", async () => {
    let caught: unknown;
    try {
      await parseForUser("first class over Thanksgiving", { today: "2026-10-01", env: {} });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ParseError);
    expect((caught as ParseError).missing.length).toBeGreaterThan(0);
    const res = gridErrorResponse(caught);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; missing: string[]; message: string };
    expect(body.error).toBe("parse");
    expect(body.missing).toEqual((caught as ParseError).missing);
  });

  it("uses an injected LLM client only when the deterministic pass is incomplete", async () => {
    const parse = vi.fn(async () => ({
      parsed_output: {
        origins: ["HKG"],
        destinations: ["SEA"],
        date_from: "2026-11-26",
        date_to: "2026-11-30",
        cabins: ["F"] as ["F"],
        programs: null,
        direct_only: false,
        max_miles: null,
        sort_by: "miles_asc" as const,
      },
      stop_reason: "end_turn" as const,
    }));
    const llmClient = { messages: { parse } };
    const r = await parseForUser("HKG to SEA over Thanksgiving, first", { today: "2026-10-01", env: {}, llmClient });
    expect(r.used_llm).toBe(true);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(r.query.date_from).toBe("2026-11-26");
    const d = await parseForUser("HKG to SEA next month", { today: "2026-10-01", env: {}, llmClient });
    expect(d.used_llm).toBe(false);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("llmAvailable reflects ANTHROPIC_API_KEY without exposing it", () => {
    expect(llmAvailable({})).toBe(false);
    expect(llmAvailable({ ANTHROPIC_API_KEY: "  " })).toBe(false);
    expect(llmAvailable({ ANTHROPIC_API_KEY: "sk-test" })).toBe(true);
  });
});

describe("helpers", () => {
  it("exportFilename and utcToday", () => {
    expect(exportFilename(query())).toBe("awardgrid_HKG+PVG+SHA_SEA_2026-10-01_2026-10-30.csv");
    expect(utcToday(NOW)).toBe("2026-10-01");
  });

  it("gridErrorResponse maps NoKeyError → 409 and unknown errors → 500 logging only the name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await gridErrorResponse(new NoKeyError("seats_aero")).json())).toEqual({ error: "no_key", provider: "seats_aero" });
    const res = gridErrorResponse(new Error(`boom ${ALICE_KEY}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(ALICE_KEY);
  });
});
