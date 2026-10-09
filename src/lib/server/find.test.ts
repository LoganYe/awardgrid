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
import { connectForTests } from "@/lib/seats-oauth/testing";
import { readConnection } from "@/lib/seats-oauth/store";
import { SeatsRenewalUnavailableError, type TokenBroker } from "@/lib/seats-oauth";
import { QueryObject, type QueryObjectInput } from "@awardgrid/core/query/schema";
import { SOURCE_NAMES, type Route, type TripsResponse } from "@awardgrid/core/seatsaero/types";
import { createSqliteAvailabilityCache } from "@/lib/db/stores/cache";
import {
  NOT_FETCHED_REASON,
  cacheFeesFromTrips,
  SeatsNotConnectedError,
  ParseError,
  QuotaExceededError,
  exportFilename,
  findGridForUser,
  getTripsForUser,
  gridErrorResponse,
  llmAvailable,
  notFetchedPairsFrom,
  parseForUser,
  summarizeTrip,
  utcToday,
} from "@/lib/server/find";
import { notice } from "@awardgrid/core/notices";
import { enumeratePairs } from "@awardgrid/core/grid/pivot";
import { compareRows } from "@awardgrid/core/grid/ranking";
import { SeatsAeroHttpError } from "@awardgrid/core/seatsaero/client";
import { fakeFetch, jsonResponse, loadFixture, textResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { SYNTHETIC_ORIGINS, SYNTHETIC_PROGRAMS, generateSynthetic } from "@awardgrid/core/test-fixtures/seatsaero/generate-synthetic";

const MASTER = Buffer.from("0f".repeat(32), "hex");
const ALICE_KEY = "seats:ota:alice_pro_key_SECRET_a1b2c3";
const BOB_KEY = "seats:ota:bob_pro_key_SECRET_z9y8x7";
/** The access token a renewal hands back (fake). */
const RENEWED = "seats:ota:alice_renewed_SECRET_r3n3w";

/** A token service that renews every refresh to RENEWED, recording the refresh tokens it was sent. */
function renewingBroker(): { broker: TokenBroker; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    broker: {
      exchange: async () => ({ ok: false, reason: "unavailable", status: 0, error: null }),
      refresh: async (refreshToken: string) => {
        calls.push(refreshToken);
        return { ok: true, grant: { access: RENEWED, refresh: null, expiresIn: 3600 } };
      },
    },
  };
}
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
  connectForTests(db, "alice", { masterKey: MASTER, access: ALICE_KEY, now: NOW });
  connectForTests(db, "bob", { masterKey: MASTER, access: BOB_KEY, now: NOW });
  const fetch = fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") return jsonResponse(synthetic);
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse(syntheticRoutes(req.url.searchParams.get("source")!));
    if (req.url.pathname.startsWith("/partnerapi/trips/")) return jsonResponse(tripsFixture);
    return textResponse("not found", 404);
  });
  return { db, fetch };
}

export const BOOKING_URL = "https://example.test/book";

interface TripSpec {
  taxes: number;
  currency?: string;
  miles?: number;
  cabin?: string;
}

/** A Get Trips payload for ONE availability, with the taxes/currency/cabins the test dictates. */
function tripsPayload(availabilityId: string, specs: readonly TripSpec[]): TripsResponse {
  return {
    data: specs.map((spec, i) => ({
      ID: `trip-${availabilityId}-${i}`,
      AvailabilityID: availabilityId,
      AvailabilitySegments: [],
      Stops: 0,
      Carriers: "AA",
      RemainingSeats: 2,
      MileageCost: spec.miles ?? 70_000,
      TotalTaxes: spec.taxes,
      TaxesCurrency: spec.currency ?? "",
      FlightNumbers: "AA1",
      DepartsAt: "2026-10-01T10:00:00Z",
      Cabin: spec.cabin ?? "business",
      ArrivesAt: "2026-10-01T20:00:00Z",
      Source: "american",
    })),
    booking_links: [{ label: "Book", link: BOOKING_URL, primary: true }],
  };
}

/**
 * The harness fetch with a Get Trips answer per availability id: `{ [id]: spec }`. An id with no
 * entry answers with an empty trip list (the "nothing was learned" case).
 */
function feeFetch(byId: Record<string, TripSpec | TripSpec[]>): ReturnType<typeof fakeFetch> {
  return fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") return jsonResponse(synthetic);
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse(syntheticRoutes(req.url.searchParams.get("source")!));
    if (req.url.pathname.startsWith("/partnerapi/trips/")) {
      const id = req.url.pathname.slice("/partnerapi/trips/".length);
      const spec = byId[id];
      if (spec === undefined) return jsonResponse({ data: [], booking_links: [] });
      return jsonResponse(tripsPayload(id, Array.isArray(spec) ? spec : [spec]));
    }
    return textResponse("not found", 404);
  });
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
    expect(fetch.calls.every((c) => c.headers["partner-authorization"] === `Bearer ${ALICE_KEY}`)).toBe(true);

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
    // Program counts from the routes catalog (loaded on the first run, hydrated from the store on
    // the second): every program monitors every synthetic pair except GMP.
    for (const res of [first, second]) {
      const byPair = res.programs_by_pair;
      expect(byPair).not.toBeNull();
      for (const p of enumeratePairs(query())) expect(byPair?.[p.key]).toBe(p.origin === "GMP" ? 0 : SYNTHETIC_PROGRAMS.length);
      expect(res.programs_checked).toBe(SYNTHETIC_PROGRAMS.length);
    }
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
    expect(bobCalls.every((c) => c.headers["partner-authorization"] === `Bearer ${BOB_KEY}`)).toBe(true);
    expect(fetch.calls.slice(0, aliceCalls).every((c) => c.headers["partner-authorization"] === `Bearer ${ALICE_KEY}`)).toBe(true);
    const usage = db.select().from(apiUsage).all();
    expect(usage.map((u) => u.userId).sort()).toEqual(["alice", "bob"]);
  });

  it("throws SeatsNotConnectedError for a user without a connection before touching the master key or the network", async () => {
    const { db, fetch } = harness();
    await expect(findGridForUser(db, { id: "carol" }, query(), { now, fetch })).rejects.toBeInstanceOf(SeatsNotConnectedError);
    expect(fetch.calls).toHaveLength(0);
    expect(db.select().from(apiUsage).all()).toEqual([]);
  });

  it("maps upstream failures to a SeatsAeroError whose text never contains the token", async () => {
    const { db } = harness();
    const fetch = fakeFetch((req) => textResponse(`unauthorized ${req.headers["partner-authorization"]}`, 401));
    const renewing = renewingBroker();
    let caught: unknown;
    try {
      await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER, tokenBroker: renewing.broker });
    } catch (err) {
      caught = err;
    }
    // Refused, renewed once, refused again with the new token: seats.aero's refusal stands (the account, not its token).
    expect(renewing.calls).toHaveLength(1);
    expect(new Set(fetch.calls.map((c) => c.headers["partner-authorization"]))).toEqual(new Set([`Bearer ${ALICE_KEY}`, `Bearer ${RENEWED}`]));
    expect(caught).toBeInstanceOf(SeatsAeroHttpError);
    expect((caught as Error).message).not.toContain(ALICE_KEY);
    expect((caught as Error).message).not.toContain(RENEWED);
    const res = gridErrorResponse(caught);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; kind: string; message: string };
    expect(body.error).toBe("seatsaero");
    expect(body.kind).toBe("invalid_key");
    expect(JSON.stringify(body)).not.toContain(ALICE_KEY);
  });
});

describe("findGridForUser — the seats.aero connection's token", () => {
  it("renews a token seats.aero refuses and sends the search again, once, with the new one", async () => {
    const { db } = harness();
    const base = fakeFetch((req) => {
      if (req.headers["partner-authorization"] !== `Bearer ${RENEWED}`) return textResponse("unauthorized", 401);
      if (req.url.pathname === "/partnerapi/search") return jsonResponse(synthetic);
      if (req.url.pathname === "/partnerapi/routes") return jsonResponse(syntheticRoutes(req.url.searchParams.get("source")!));
      return textResponse("not found", 404);
    });
    const renewing = renewingBroker();
    const res = await findGridForUser(db, { id: "alice" }, query(), { now, fetch: base, masterKey: MASTER, tokenBroker: renewing.broker });
    expect(res.grid.cells.flat().some((c) => c.status === "ok")).toBe(true);
    expect(renewing.calls).toHaveLength(1);
    expect(readConnection(db, "alice", MASTER)?.tokens.access).toBe(RENEWED);
    expect(JSON.stringify(res)).not.toContain(RENEWED);
  });

  it("renews early: a token with less than five minutes left is replaced before it is sent", async () => {
    const { db, fetch } = harness();
    connectForTests(db, "alice", { masterKey: MASTER, access: ALICE_KEY, now: NOW, expiresIn: 120 });
    const renewing = renewingBroker();
    await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER, tokenBroker: renewing.broker });
    expect(renewing.calls).toHaveLength(1);
    expect(fetch.calls.every((c) => c.headers["partner-authorization"] === `Bearer ${RENEWED}`)).toBe(true);
  });

  it("a revoked grant removes the connection and purges what the server kept, then answers 409 no_key", async () => {
    const { db, fetch } = harness();
    await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER });
    await findGridForUser(db, { id: "bob" }, query(), { now, fetch, masterKey: MASTER });
    expect(db.select().from(availabilityCache).all().some((r) => r.userId === "alice")).toBe(true);
    connectForTests(db, "alice", { masterKey: MASTER, access: ALICE_KEY, now: NOW, expiresIn: 60 });
    const revoked: TokenBroker = {
      exchange: async () => ({ ok: false, reason: "unavailable", status: 0, error: null }),
      refresh: async () => ({ ok: false, reason: "rejected", status: 400, error: "invalid_grant" }),
    };
    let caught: unknown;
    try {
      await findGridForUser(db, { id: "alice" }, query(), { now: () => new Date(NOW.getTime() + 2 * 60_000), fetch, masterKey: MASTER, tokenBroker: revoked });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SeatsNotConnectedError);
    expect((await gridErrorResponse(caught).json())).toEqual({ error: "no_key", provider: "seats_aero" });
    expect(readConnection(db, "alice", MASTER)).toBeNull();
    expect(db.select().from(availabilityCache).all().some((r) => r.userId === "alice")).toBe(false);
    // Bob's results are his own and stay.
    expect(db.select().from(availabilityCache).all().some((r) => r.userId === "bob")).toBe(true);
  });

  it("a token run out that cannot be renewed now is a passing failure: 502 renewal_unavailable, the connection kept", async () => {
    const { db, fetch } = harness();
    connectForTests(db, "alice", { masterKey: MASTER, access: ALICE_KEY, now: NOW, expiresIn: 60 });
    const down: TokenBroker = {
      exchange: async () => ({ ok: false, reason: "unavailable", status: 502, error: null }),
      refresh: async () => ({ ok: false, reason: "unavailable", status: 502, error: "upstream_blocked" }),
    };
    let caught: unknown;
    try {
      await findGridForUser(db, { id: "alice" }, query(), { now: () => new Date(NOW.getTime() + 2 * 60_000), fetch, masterKey: MASTER, tokenBroker: down });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SeatsRenewalUnavailableError);
    expect((await gridErrorResponse(caught).json())).toEqual({ error: "seatsaero", kind: "renewal_unavailable" });
    expect(readConnection(db, "alice", MASTER)?.tokens.access).toBe(ALICE_KEY);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("getTripsForUser", () => {
  it("spends exactly one call, returns trips + fees + booking links, and records the call", async () => {
    const { db, fetch } = harness();
    const res = await getTripsForUser(db, { id: "alice" }, "2PPrELk9WcfJaNREWEPXypvhXAD", { now, fetch, masterKey: MASTER, cabin: "J" });
    expect(res.api_calls_used).toBe(1);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]!.url.pathname).toBe("/partnerapi/trips/2PPrELk9WcfJaNREWEPXypvhXAD");
    expect(fetch.calls[0]!.headers["partner-authorization"]).toBe(`Bearer ${ALICE_KEY}`);
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

  it("writes the priced row's fees, currency and booking link back into the cache (#52)", async () => {
    const { db } = harness();
    const q = query({ cabins: ["J"], sort_by: "fees_asc" });
    const first = await findGridForUser(db, { id: "alice" }, q, { now, fetch: feeFetch({}), masterKey: MASTER });

    // The defect's starting point: Cached Search carries no taxes, so every row's fee is unknown
    // and `fees_asc` can only fall back to its tiebreakers.
    const before = first.grid.cells.flat().flatMap((c) => c.all);
    expect(before.length).toBeGreaterThan(4);
    expect(before.every((r) => r.fees_cents === null)).toBe(true);

    // Two DIFFERENT cells get expanded — the only two fees a user could have learned by hand.
    const cells = first.grid.cells.flat().filter((c) => c.status === "ok" && c.best !== null);
    const cheap = cells[0]!.best!;
    const dear = cells.find((c) => c.best!.source_id !== cheap.source_id)!.best!;
    for (const [row, taxes] of [
      [cheap, 1_200],
      [dear, 9_900],
    ] as const) {
      const res = await getTripsForUser(db, { id: "alice" }, row.source_id, {
        now,
        fetch: feeFetch({ [row.source_id]: { taxes, currency: "USD", miles: row.miles } }),
        masterKey: MASTER,
        cabin: "J",
        include_filtered: false,
        min_cabin_pct: 100,
      });
      expect(res.fees_cents).toBe(taxes);
    }

    // The same query again, inside the TTL: no network, the grid is the cache's own answer.
    const second = await findGridForUser(db, { id: "alice" }, q, {
      now: () => new Date(NOW.getTime() + 20 * 60_000),
      fetch: feeFetch({}),
      masterKey: MASTER,
    });
    expect(second.grid.meta.served_from_cache).toBe(true);

    const after = second.grid.cells.flat().flatMap((c) => c.all);
    expect(after.filter((r) => r.fees_cents !== null).map((r) => [r.source_id, r.fees_cents, r.currency])).toEqual([
      [cheap.source_id, 1_200, "USD"],
      [dear.source_id, 9_900, "USD"],
    ]);
    expect(after.find((r) => r.source_id === cheap.source_id)!.booking_url).toBe(BOOKING_URL);

    // What the user asked for: cheapest fee first, then the next, then the unknown tail.
    const sorted = [...after].sort(compareRows("fees_asc"));
    expect(sorted.slice(0, 2).map((r) => r.source_id)).toEqual([cheap.source_id, dear.source_id]);
    expect(sorted.slice(2).every((r) => r.fees_cents === null)).toBe(true);

    // Freshness is untouched: the fee is new, the availability behind it is not (see DECISIONS #52).
    const stored = db.select().from(availabilityCache).all().find((r) => r.sourceId === cheap.source_id && r.cabin === "J")!;
    expect(stored.computedLastSeen).toBe(cheap.computed_last_seen);
    expect(stored.fetchedAt).toBe(cheap.fetched_at);
    expect(stored.miles).toBe(cheap.miles);
    expect(stored.seatsLeft).toBe(cheap.seats_left);
  });

  it("writes the fee of the cabin the cell shows, not the cheapest trip in the response (#52)", async () => {
    const { db } = harness();
    const q = query({ cabins: ["J", "F"] });
    const grid = await findGridForUser(db, { id: "alice" }, q, { now, fetch: feeFetch({}), masterKey: MASTER });
    // A cell whose availability is offered in BOTH cabins: two rows, one source_id.
    const both = grid.grid.cells
      .flat()
      .flatMap((c) => c.all)
      .filter((r, _i, all) => all.filter((x) => x.source_id === r.source_id).length === 2);
    const j = both.find((r) => r.cabin === "J")!;
    expect(both.some((r) => r.cabin === "F" && r.source_id === j.source_id)).toBe(true);

    // First is cheaper in miles AND in taxes; the J row must not inherit it.
    const res = await getTripsForUser(db, { id: "alice" }, j.source_id, {
      now,
      fetch: feeFetch({
        [j.source_id]: [
          { cabin: "first", miles: 60_000, taxes: 500, currency: "USD" },
          { cabin: "business", miles: 70_000, taxes: 3_000, currency: "USD" },
        ],
      }),
      masterKey: MASTER,
      cabin: "J",
    });
    expect(res.fees_cents).toBe(3_000);
    const stored = db.select().from(availabilityCache).all().filter((r) => r.sourceId === j.source_id);
    expect(stored.map((r) => [r.cabin, r.feesCents]).sort()).toEqual([
      ["F", null],
      ["J", 3_000],
    ]);
  });

  it("never writes outside the scope it read in, or into another user's cache (#52)", async () => {
    const { db } = harness();
    const q = query({ cabins: ["J"] });
    const grid = await findGridForUser(db, { id: "alice" }, q, { now, fetch: feeFetch({}), masterKey: MASTER });
    await findGridForUser(db, { id: "bob" }, q, { now, fetch: feeFetch({}), masterKey: MASTER });
    const row = grid.grid.cells.flat().find((c) => c.best !== null)!.best!;
    const spec = { [row.source_id]: { taxes: 4_200, currency: "USD" } };
    const feesOf = (userId: string) =>
      db.select().from(availabilityCache).all().filter((r) => r.userId === userId && r.sourceId === row.source_id).map((r) => r.feesCents);

    // Both rows were fetched at include_filtered=false / min_cabin_pct=100; a drawer opened in
    // either of the other scopes is asking a different question and must not touch them.
    for (const scope of [{ include_filtered: true }, { min_cabin_pct: 70 }]) {
      await getTripsForUser(db, { id: "alice" }, row.source_id, { now, fetch: feeFetch(spec), masterKey: MASTER, cabin: "J", ...scope });
      expect(feesOf("alice")).toEqual([null]);
    }

    await getTripsForUser(db, { id: "alice" }, row.source_id, {
      now,
      fetch: feeFetch(spec),
      masterKey: MASTER,
      cabin: "J",
      include_filtered: false,
      min_cabin_pct: 100,
    });
    expect(feesOf("alice")).toEqual([4_200]);
    // Bob searched the same fixture and holds a row with the same Availability ID: untouched.
    expect(feesOf("bob")).toEqual([null]);
  });

  it("a failed call, a fee-less answer or an unattributable one leaves the cached row as it was (#52)", async () => {
    const { db } = harness();
    const q = query({ cabins: ["J"] });
    const grid = await findGridForUser(db, { id: "alice" }, q, { now, fetch: feeFetch({}), masterKey: MASTER });
    const cells = grid.grid.cells.flat().filter((c) => c.best !== null);
    const row = cells[0]!.best!;
    const other = cells.find((c) => c.best!.source_id !== row.source_id)!.best!;
    const stored = (sourceId: string) =>
      db.select().from(availabilityCache).all().find((r) => r.userId === "alice" && r.sourceId === sourceId)!;

    const opts = { now, masterKey: MASTER, cabin: "J", include_filtered: false, min_cabin_pct: 100 } as const;
    await getTripsForUser(db, { id: "alice" }, row.source_id, {
      ...opts,
      fetch: feeFetch({ [row.source_id]: { taxes: 1_200, currency: "EUR" } }),
    });
    expect([stored(row.source_id).feesCents, stored(row.source_id).currency]).toEqual([1_200, "EUR"]);

    // (a) an answer with no trips at all: nothing was learned, so nothing is overwritten.
    await getTripsForUser(db, { id: "alice" }, row.source_id, { ...opts, fetch: feeFetch({}) });
    expect([stored(row.source_id).feesCents, stored(row.source_id).currency]).toEqual([1_200, "EUR"]);

    // (b) no trip in THIS cabin: same rule, via tripsToFees' cabin filter.
    await getTripsForUser(db, { id: "alice" }, row.source_id, {
      ...opts,
      fetch: feeFetch({ [row.source_id]: { cabin: "first", taxes: 99, currency: "USD" } }),
    });
    expect([stored(row.source_id).feesCents, stored(row.source_id).currency]).toEqual([1_200, "EUR"]);

    // (c) the call itself fails: it throws before any write, and the row keeps its fee.
    const failing = fakeFetch((req) =>
      req.url.pathname.startsWith("/partnerapi/trips/") ? textResponse("upstream is down", 502) : textResponse("not found", 404),
    );
    await expect(getTripsForUser(db, { id: "alice" }, row.source_id, { ...opts, fetch: failing })).rejects.toBeInstanceOf(SeatsAeroHttpError);
    expect([stored(row.source_id).feesCents, stored(row.source_id).currency]).toEqual([1_200, "EUR"]);

    // (d) no cabin asked: the cheapest trip across cabins is not any one cell's fee.
    const noCabin = await getTripsForUser(db, { id: "alice" }, other.source_id, {
      now,
      masterKey: MASTER,
      fetch: feeFetch({ [other.source_id]: { taxes: 7_000, currency: "USD" } }),
    });
    expect(noCabin.fees_cents).toBe(7_000);
    expect(stored(other.source_id).feesCents).toBeNull();
  });

  it("on a first render every fee is unknown, so fees_asc IS miles_asc (#52 does not fix that)", async () => {
    // The honest limit of #52, pinned so nobody reads the write-back as a fix for `fees_asc`.
    // Cached Search carries no taxes, so a grid that has never been expanded has zero fee
    // coverage; `byFeesAscNullLast` then returns 0 for every pair and the chain falls through to
    // `byMilesAsc`, which is where `miles_asc` starts. Coverage only ever climbs one expand — one
    // cell, one quota call — at a time. See BACKLOG.md.
    const { db } = harness();
    const grid = await findGridForUser(db, { id: "alice" }, query({ sort_by: "fees_asc" }), { now, fetch: feeFetch({}), masterKey: MASTER });
    const rows = grid.grid.cells.flat().flatMap((c) => c.all);
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.filter((r) => r.fees_cents !== null)).toEqual([]);
    const id = (r: (typeof rows)[number]) => `${r.date}|${r.origin}|${r.dest}|${r.cabin}|${r.program}`;
    expect([...rows].sort(compareRows("fees_asc")).map(id)).toEqual([...rows].sort(compareRows("miles_asc")).map(id));
  });

  it("takes the currency of the fee it just learned, never the row's previous one (#52)", async () => {
    const { db } = harness();
    const grid = await findGridForUser(db, { id: "alice" }, query({ cabins: ["J"] }), { now, fetch: feeFetch({}), masterKey: MASTER });
    const row = grid.grid.cells.flat().find((c) => c.best !== null)!.best!;
    const opts = { now, masterKey: MASTER, cabin: "J", include_filtered: false, min_cabin_pct: 100 } as const;
    const stored = () => db.select().from(availabilityCache).all().find((r) => r.userId === "alice" && r.sourceId === row.source_id)!;

    // A genuinely non-USD quote is recorded as such.
    await getTripsForUser(db, { id: "alice" }, row.source_id, { ...opts, fetch: feeFetch({ [row.source_id]: { taxes: 12_000, currency: "EUR" } }) });
    expect([stored().feesCents, stored().currency]).toEqual([12_000, "EUR"]);

    // The next expand quotes 50.00 in USD, which seats.aero encodes as TaxesCurrency: "". The
    // amount and its label travel together: inheriting "EUR" here would print "50.00 EUR" in the
    // grid and the CSV while the drawer, reading the same response, prints "$50.00".
    const res = await getTripsForUser(db, { id: "alice" }, row.source_id, { ...opts, fetch: feeFetch({ [row.source_id]: { taxes: 5_000, currency: "" } }) });
    expect([res.fees_cents, res.currency]).toEqual([5_000, null]);
    expect([stored().feesCents, stored().currency]).toEqual([5_000, null]);
  });

  it("does not learn a booking link for a cabin it found no itinerary in (#52)", async () => {
    const { db } = harness();
    const grid = await findGridForUser(db, { id: "alice" }, query({ cabins: ["J"] }), { now, fetch: feeFetch({}), masterKey: MASTER });
    const row = grid.grid.cells.flat().find((c) => c.best !== null)!.best!;
    // A real seats.aero response carries `booking_links` per AVAILABILITY: it is there whether or
    // not the trip list holds anything, and whether or not anything in it is in the asked cabin.
    const linkOnly = (data: TripsResponse["data"]) =>
      fakeFetch((req) =>
        req.url.pathname.startsWith("/partnerapi/trips/")
          ? jsonResponse({ data, booking_links: [{ label: "Book", link: BOOKING_URL, primary: true }] })
          : textResponse("not found", 404),
      );
    const opts = { now, masterKey: MASTER, cabin: "J", include_filtered: false, min_cabin_pct: 100 } as const;
    const stored = () => db.select().from(availabilityCache).all().find((r) => r.userId === "alice" && r.sourceId === row.source_id)!;

    // (a) no trips at all, and (b) trips but none in J. Persisting the link on this evidence
    // would permanently re-point the cell's deeplink (resolveDeeplink prefers booking_url over
    // every program builder) on the strength of a call that found nothing to book in this cabin.
    await getTripsForUser(db, { id: "alice" }, row.source_id, { ...opts, fetch: linkOnly([]) });
    expect([stored().feesCents, stored().bookingUrl]).toEqual([null, null]);
    await getTripsForUser(db, { id: "alice" }, row.source_id, { ...opts, fetch: linkOnly(tripsPayload(row.source_id, [{ cabin: "first", taxes: 99 }]).data) });
    expect([stored().feesCents, stored().bookingUrl]).toEqual([null, null]);

    // A priced J trip is the evidence the link write was waiting for.
    await getTripsForUser(db, { id: "alice" }, row.source_id, { ...opts, fetch: linkOnly(tripsPayload(row.source_id, [{ cabin: "business", taxes: 3_400 }]).data) });
    expect([stored().feesCents, stored().bookingUrl]).toEqual([3_400, BOOKING_URL]);
  });

  it("a Cached Search refresh that lands mid-write is not rolled back, and a deleted row stays deleted (#52)", async () => {
    const { db } = harness();
    const grid = await findGridForUser(db, { id: "alice" }, query({ cabins: ["J"] }), { now, fetch: feeFetch({}), masterKey: MASTER });
    const row = grid.grid.cells.flat().find((c) => c.best !== null)!.best!;
    const fees = { fees_cents: 4_200, currency: "USD", booking_url: BOOKING_URL };

    // cacheFeesFromTrips reads the row, then writes. /api/find and /api/trips are concurrent
    // handlers over the same synchronous handle, so a refresh can land in that await gap; this
    // store wrapper puts one exactly there.
    const withRefreshInTheGap = (refresh: (c: ReturnType<typeof createSqliteAvailabilityCache>) => void) => {
      const real = createSqliteAvailabilityCache(db);
      return Object.assign(Object.create(Object.getPrototypeOf(real) as object) as typeof real, real, {
        async getRowsBySourceId(...args: Parameters<typeof real.getRowsBySourceId>) {
          const rows = await real.getRowsBySourceId(...args);
          refresh(real);
          return rows;
        },
      });
    };

    // (a) the refresh rewrote the row (new miles, seats, freshness). The fee write must add its
    // three columns to THAT row, not restore the snapshot it read a microtask earlier.
    const refreshed = { ...row, miles: 55_000, seats_left: 9, computed_last_seen: "2026-10-01T11:59:00Z", fetched_at: "2026-10-01T11:59:00Z" };
    await cacheFeesFromTrips(withRefreshInTheGap((c) => void c.putRows("alice", [refreshed])), "alice", row.source_id, fees, {
      cabin: "J",
      include_filtered: false,
      min_cabin_pct: 100,
    });
    const after = db.select().from(availabilityCache).all().find((r) => r.userId === "alice" && r.sourceId === row.source_id)!;
    expect([after.miles, after.seatsLeft, after.computedLastSeen]).toEqual([55_000, 9, "2026-10-01T11:59:00Z"]);
    expect([after.feesCents, after.bookingUrl]).toEqual([4_200, BOOKING_URL]);

    // (b) the refresh found the award gone and deleted the row. Re-inserting it would put a
    // phantom back in a scope whose coverage record is now fresh, so it would be served until
    // the TTL expired. Nothing matches, so nothing is written.
    const gone = withRefreshInTheGap(
      (c) => void c.deleteRows("alice", { origins: [row.origin], dests: [row.dest], date_from: row.date, date_to: row.date, cabins: ["J"] }),
    );
    expect(await cacheFeesFromTrips(gone, "alice", row.source_id, fees, { cabin: "J", include_filtered: false, min_cabin_pct: 100 })).toBe(false);
    expect(db.select().from(availabilityCache).all().filter((r) => r.userId === "alice" && r.sourceId === row.source_id)).toEqual([]);
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
    // "未来一个月" is 30 days counted inclusively, the spec's own "Oct 1 – Oct 30 (30 days)".
    expect(result.query.date_to).toBe("2026-10-30");
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
    // UI/UX v1 T20: only when the person asked for it (allowLlm), never implicitly.
    const r = await parseForUser("HKG to SEA over Thanksgiving, first", { today: "2026-10-01", env: {}, llmClient, allowLlm: true });
    expect(r.used_llm).toBe(true);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(r.query.date_from).toBe("2026-11-26");
    const d = await parseForUser("HKG to SEA next month", { today: "2026-10-01", env: {}, llmClient, allowLlm: true });
    expect(d.used_llm).toBe(false);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("never calls the language model unless the request asks: a server key and missing fields are not consent (UI/UX v1 T20)", async () => {
    const parse = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const llmClient = { messages: { parse } };
    for (const opts of [{}, { allowLlm: false }]) {
      await expect(parseForUser("first class over Thanksgiving", { today: "2026-10-01", env: { ANTHROPIC_API_KEY: "sk-test" }, llmClient, ...opts })).rejects.toBeInstanceOf(ParseError);
    }
    expect(parse).not.toHaveBeenCalled();
    // A complete sentence still parses, deterministically, with no model.
    const r = await parseForUser("HKG to SEA next month", { today: "2026-10-01", env: { ANTHROPIC_API_KEY: "sk-test" }, llmClient });
    expect(r.used_llm).toBe(false);
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

  it("gridErrorResponse maps SeatsNotConnectedError → 409 and unknown errors → 500 logging only the name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await gridErrorResponse(new SeatsNotConnectedError()).json())).toEqual({ error: "no_key", provider: "seats_aero" });
    const res = gridErrorResponse(new Error(`boom ${ALICE_KEY}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(ALICE_KEY);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 additive: dynamic rows from the cached include_filtered scope, not-fetched pairs,
// per-program Get Routes failures.
// ---------------------------------------------------------------------------

type SyntheticObject = Record<string, unknown> & { ID: string; Source: string; Date: string; Route: { OriginAirport: string } };

/**
 * Three dynamic-priced objects on (origin, date) cells the plain fixture leaves EMPTY for every
 * program, so they can only ever come from the include_filtered scope and each one is the
 * sole occupant of its cell.
 */
function dynamicObjects(): SyntheticObject[] {
  const data = synthetic.data as SyntheticObject[];
  const taken = new Set(data.map((o) => `${o.Route.OriginAirport}:${o.Date}`));
  const out: SyntheticObject[] = [];
  const template = data.find((o) => o.JAvailable === true)!;
  for (const program of SYNTHETIC_PROGRAMS) {
    for (const origin of SYNTHETIC_ORIGINS) {
      if (origin === "GMP") continue;
      for (let day = 0; day < 30 && out.length < 3; day += 1) {
        const date = `2026-10-${String(day + 1).padStart(2, "0")}`;
        if (taken.has(`${origin}:${date}`)) continue;
        const route = { ...(template.Route as Record<string, unknown>), OriginAirport: origin, Source: program, ID: `route-dyn-${out.length}` };
        out.push({
          ...template,
          ID: `DYN${out.length}`,
          RouteID: route.ID,
          Route: route as SyntheticObject["Route"],
          Date: date,
          ParsedDate: `${date}T00:00:00Z`,
          Source: program,
          JAvailable: true,
          JMileageCost: "42500",
          JRemainingSeats: 3,
          JAirlines: "JL",
          JDirect: true,
          FAvailable: false,
          FMileageCost: "0",
          FRemainingSeats: 0,
          FAirlines: "",
          FDirect: false,
        });
        taken.add(`${origin}:${date}`);
        break;
      }
      if (out.length >= 3) return out;
    }
  }
  return out;
}

function dynamicHarness() {
  const db: Db = openTestDb();
  seedUsers(db, ["alice"]);
  connectForTests(db, "alice", { masterKey: MASTER, access: ALICE_KEY, now: NOW });
  const extra = dynamicObjects();
  const fetch = fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") {
      const filtered = req.url.searchParams.get("include_filtered") === "true";
      return jsonResponse(filtered ? { ...synthetic, data: [...synthetic.data, ...extra], count: synthetic.count + extra.length } : synthetic);
    }
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse(syntheticRoutes(req.url.searchParams.get("source")!));
    return textResponse("not found", 404);
  });
  return { db, fetch, extra };
}

describe("findGridForUser — dynamic rows (Phase 6)", () => {
  it("appends cached include_filtered rows flagged dynamic to the plain query only, without any fetch", async () => {
    const { db, fetch, extra } = dynamicHarness();
    expect(extra).toHaveLength(3);
    const plainQ = query({ include_filtered: false });
    const filteredQ = query({ include_filtered: true });

    // 1. Warm the include_filtered scope. Its own result never carries the flag.
    const first = await findGridForUser(db, { id: "alice" }, filteredQ, { now, fetch, masterKey: MASTER });
    expect(first.dynamic_rows_available).toBe(false);
    expect(first.grid.cells.flat().flatMap((c) => c.all).some((r) => r.dynamic)).toBe(false);
    expect(first.grid.cells.flat().every((c) => c.status !== "filtered")).toBe(true);
    const warm = fetch.calls.length;

    // 2. The plain query fetches its own scope (one search page; routes already cached) and
    //    then reads the filtered scope from SQLite: no extra request.
    const plain = await findGridForUser(db, { id: "alice" }, plainQ, { now, fetch, masterKey: MASTER });
    expect(fetch.calls.length).toBe(warm + 1);
    expect(fetch.calls[warm]!.url.searchParams.get("include_filtered")).toBeNull();
    expect(plain.dynamic_rows_available).toBe(true);
    const rows = plain.grid.cells.flat().flatMap((c) => c.all);
    const dynamic = rows.filter((r) => r.dynamic === true);
    expect(dynamic).toHaveLength(3);
    expect(dynamic.map((r) => r.miles)).toEqual([42_500, 42_500, 42_500]);
    expect(dynamic.every((r) => r.include_filtered === true)).toBe(true);
    // Every dynamic row sits in a cell of its own → the "filtered" state with the dynamic row as best.
    const filteredCells = plain.grid.cells.flat().filter((c) => c.status === "filtered");
    expect(filteredCells).toHaveLength(3);
    expect(filteredCells.every((c) => c.best?.dynamic === true && c.all.every((r) => r.dynamic))).toBe(true);
    // Nothing that the plain scope already had is duplicated.
    expect(rows.filter((r) => !r.dynamic)).toHaveLength(first.grid.cells.flat().flatMap((c) => c.all).length - 3);
    expect(JSON.stringify(plain)).not.toContain(ALICE_KEY);

    // 3. Served from cache within the TTL: same answer, still no request.
    const again = await findGridForUser(db, { id: "alice" }, plainQ, { now: () => new Date(NOW.getTime() + 10 * 60_000), fetch, masterKey: MASTER });
    expect(again.grid.meta.served_from_cache).toBe(true);
    expect(again.dynamic_rows_available).toBe(true);
    expect(again.grid.cells.flat().filter((c) => c.status === "filtered")).toHaveLength(3);
    expect(fetch.calls.length).toBe(warm + 1);

    // 4. Opt-out (standing queries): the plain answer only.
    const strict = await findGridForUser(db, { id: "alice" }, plainQ, { now, fetch, masterKey: MASTER, dynamic_rows: false });
    expect(strict.dynamic_rows_available).toBe(false);
    expect(strict.grid.cells.flat().flatMap((c) => c.all).some((r) => r.dynamic)).toBe(false);
    expect(fetch.calls.length).toBe(warm + 1);

    // 5. With the toggle on, the same rows are ordinary "ok" rows again (from cache).
    const on = await findGridForUser(db, { id: "alice" }, filteredQ, { now, fetch, masterKey: MASTER });
    expect(on.grid.meta.served_from_cache).toBe(true);
    expect(on.grid.cells.flat().every((c) => c.status !== "filtered")).toBe(true);
    expect(on.grid.cells.flat().flatMap((c) => c.all).filter((r) => r.miles === 42_500)).toHaveLength(3);
  });

  it("without a cached include_filtered scope the plain query has no dynamic rows and says so", async () => {
    const { db, fetch } = dynamicHarness();
    const plain = await findGridForUser(db, { id: "alice" }, query({ include_filtered: false }), { now, fetch, masterKey: MASTER });
    expect(plain.dynamic_rows_available).toBe(false);
    expect(plain.grid.cells.flat().some((c) => c.status === "filtered")).toBe(false);
    expect(plain.grid.cells.flat().flatMap((c) => c.all).some((r) => r.dynamic)).toBe(false);
    expect(fetch.calls.every((c) => c.url.searchParams.get("include_filtered") === null)).toBe(true);
  });

  it("a stale include_filtered scope (older than the TTL) is not appended", async () => {
    const { db, fetch } = dynamicHarness();
    await findGridForUser(db, { id: "alice" }, query({ include_filtered: true }), { now, fetch, masterKey: MASTER });
    const later = () => new Date(NOW.getTime() + 3 * 60 * 60_000); // beyond the 45-minute TTL
    const plain = await findGridForUser(db, { id: "alice" }, query({ include_filtered: false }), { now: later, fetch, masterKey: MASTER });
    expect(plain.dynamic_rows_available).toBe(false);
    expect(plain.grid.cells.flat().flatMap((c) => c.all).some((r) => r.dynamic)).toBe(false);
  });
});

describe("findGridForUser — not fetched pairs (Phase 6)", () => {
  it("marks monitored pairs without rows as not fetched when the search was truncated", async () => {
    const db: Db = openTestDb();
    seedUsers(db, ["alice"]);
    connectForTests(db, "alice", { masterKey: MASTER, access: ALICE_KEY, now: NOW });
    const page = (synthetic.data as SyntheticObject[]).filter((o) => o.Route.OriginAirport === "HKG").slice(0, 5);
    const fetch = fakeFetch((req) => {
      // Every page claims there is more: the run stops at the page cap and warns.
      if (req.url.pathname === "/partnerapi/search") return jsonResponse({ ...synthetic, data: page, count: page.length, hasMore: true, cursor: 1 });
      if (req.url.pathname === "/partnerapi/routes") {
        const source = req.url.searchParams.get("source")!;
        return jsonResponse([...syntheticRoutes(source), { ...syntheticRoutes(source)[0]!, ID: `${source}-TPE`, OriginAirport: "TPE" }]);
      }
      return textResponse("not found", 404);
    });
    const q = query({ origins: [...SYNTHETIC_ORIGINS, "TPE"] });
    const res = await findGridForUser(db, { id: "alice" }, q, { now, fetch, masterKey: MASTER });
    expect(res.notices.map((n) => n.code)).toContain("find.truncated_search");
    const cells = res.grid.cells.flat();
    const status = (origin: string) => new Set(cells.filter((c) => c.origin === origin).map((c) => c.status));
    expect(status("GMP")).toEqual(new Set(["unmonitored"]));
    expect(status("TPE")).toEqual(new Set(["not_fetched"]));
    expect(status("PVG")).toEqual(new Set(["not_fetched"]));
    expect(status("HKG").has("ok")).toBe(true);
    expect(status("HKG").has("not_fetched")).toBe(false);
    expect(cells.find((c) => c.origin === "TPE")?.reason).toBe("grid.cell.not_fetched");
    expect(res.grid.meta.not_fetched_pairs.map((p) => p.pair.origin).sort()).toEqual(["HND", "ICN", "NRT", "PVG", "SHA", "TPE"]);
    expect(res.programs_failed).toEqual([]);
  });

  it("notFetchedPairsFrom: quota headroom wins over truncation; pairs with rows or unmonitored are left alone", () => {
    const q = query({ origins: ["HKG", "PVG", "GMP"] });
    const pairs = enumeratePairs(q);
    const row = { origin: "HKG", dest: "SEA" } as never;
    const base = { rows: [row], unmonitored_pairs: [{ origin: "GMP", dest: "SEA", key: "GMP-SEA" }] };
    expect(notFetchedPairsFrom({ ...base, notices: [] }, pairs)).toEqual([]);
    expect(notFetchedPairsFrom({ ...base, notices: [notice("find.truncated_bulk", { pages: 2, source: "alaska" })] }, pairs)).toEqual([
      { pair: { origin: "PVG", dest: "SEA" }, reason: "grid.cell.not_fetched" },
    ]);
    expect(
      notFetchedPairsFrom({ ...base, notices: [notice("find.truncated_search", { pages: 3 }), notice("find.quota_headroom")] }, pairs),
    ).toEqual([{ pair: { origin: "PVG", dest: "SEA" }, reason: "grid.cell.not_fetched_quota" }]);
    expect(notFetchedPairsFrom({ ...base, notices: [notice("find.routes_skipped", { pairs: 1, skipped: 2 })] }, pairs)).toEqual([]);
  });
});

describe("findGridForUser — one program's Get Routes failing (Phase 6)", () => {
  function failingHarness(status: number) {
    const db: Db = openTestDb();
    seedUsers(db, ["alice"]);
    connectForTests(db, "alice", { masterKey: MASTER, access: ALICE_KEY, now: NOW });
    const fetch = fakeFetch((req) => {
      if (req.url.pathname === "/partnerapi/search") return jsonResponse(synthetic);
      if (req.url.pathname === "/partnerapi/routes") {
        const source = req.url.searchParams.get("source")!;
        if (source === "aeroplan") return textResponse(`upstream failure ${ALICE_KEY}`, status);
        return jsonResponse(syntheticRoutes(source));
      }
      return textResponse("not found", 404);
    });
    return { db, fetch };
  }

  it("a 500 on one program's route list keeps the grid, reports the program and never claims not monitored", async () => {
    const { db, fetch } = failingHarness(500);
    const res = await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER });
    expect(res.programs_failed).toEqual(["aeroplan"]);
    // The failure is reported as a failure. It is NOT a quota story: every source this run
    // skipped, it skipped because its route list errored, so "skipped to stay within today's
    // quota" would tell the user their daily allowance ran out when it did not.
    expect(res.notices.map((n) => n.code)).toContain("find.routes_failed");
    expect(res.notices.map((n) => n.code)).not.toContain("find.routes_skipped");
    expect(res.notices.find((n) => n.code === "find.routes_failed")?.vars).toEqual({
      programs: SOURCE_NAMES.aeroplan,
      count: 1,
    });
    // uiNotices falls back to raw English for the WHOLE strip unless the two arrays line up.
    expect(res.warnings).toHaveLength(res.notices.length);
    expect(res.warnings.join(" ")).toContain(SOURCE_NAMES.aeroplan);
    expect(res.grid.meta.unmonitored_pairs).toEqual([]);
    // A pair with no rows that none of the LOADED programs monitors may belong to the failed
    // one: it is "not fetched (upstream error)", neither "no availability" nor "not monitored".
    const gmp = res.grid.cells.flat().filter((c) => c.origin === "GMP");
    expect(gmp.length).toBeGreaterThan(0);
    expect(gmp.every((c) => c.status === "not_fetched" && c.reason === NOT_FETCHED_REASON.upstream)).toBe(true);
    expect(res.grid.meta.not_fetched_pairs.map((p) => `${p.pair.origin}-${p.pair.dest}`)).toContain("GMP-SEA");
    // Pairs a loaded program monitors keep their own states.
    expect(res.grid.cells.flat().some((c) => c.status === "ok")).toBe(true);
    expect(res.grid.cells.flat().some((c) => c.status === "none")).toBe(true);
    // one search page + one Get Routes per program (the failed one included; seats.aero charged for it)
    expect(fetch.calls).toHaveLength(1 + SYNTHETIC_PROGRAMS.length);
    expect(res.grid.meta.api_calls_used).toBe(1 + SYNTHETIC_PROGRAMS.length);
    expect(JSON.stringify(res)).not.toContain(ALICE_KEY);
    // With one route list missing the header cannot claim a monitoring count.
    expect(res.programs_by_pair).toBeNull();
    expect(res.programs_checked).toBe(SYNTHETIC_PROGRAMS.length);
  });

  it("the cached grid after that failure still marks the unresolved pair not fetched (generic reason, zero calls)", async () => {
    const { db, fetch } = failingHarness(500);
    await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER });
    const calls = fetch.calls.length;
    // A new request builds a fresh catalog: the failure is not stored, only the loaded lists are.
    const again = await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER });
    expect(fetch.calls).toHaveLength(calls);
    expect(again.grid.meta.served_from_cache).toBe(true);
    expect(again.programs_failed).toEqual([]);
    expect(again.grid.meta.unmonitored_pairs).toEqual([]);
    const gmp = again.grid.cells.flat().filter((c) => c.origin === "GMP");
    expect(gmp.length).toBeGreaterThan(0);
    expect(gmp.every((c) => c.status === "not_fetched" && c.reason === NOT_FETCHED_REASON.truncated)).toBe(true);
    expect(again.programs_by_pair).toBeNull();
  });

  it("one program fails AND the routes budget runs out: both notices, the skipped count minus the failures", async () => {
    const { db, fetch } = failingHarness(500);
    // 5 calls left: one Cached Search page, then a routes budget of 4 over the six programs in
    // SYNTHETIC_PROGRAMS order — american, alaska, united are fetched, aeroplan errors (its call
    // was still made and charged), and singapore + jetblue never get a request at all.
    db.insert(apiUsage).values({ userId: "alice", provider: "seats_aero", day: "2026-10-01", calls: 945 }).run();
    const res = await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER });
    expect(res.programs_failed).toEqual(["aeroplan"]);
    const codes = res.notices.map((n) => n.code);
    expect(codes).toContain("find.routes_failed");
    expect(codes).toContain("find.routes_skipped");
    // Three sources went unloaded; one of them for an upstream error, so only two are the
    // quota's doing and only two may be counted in the quota sentence.
    expect(res.notices.find((n) => n.code === "find.routes_skipped")?.vars?.skipped).toBe(2);
    expect(res.notices.find((n) => n.code === "find.routes_failed")?.vars).toEqual({ programs: SOURCE_NAMES.aeroplan, count: 1 });
    expect(res.warnings).toHaveLength(res.notices.length);
  });

  it("warnings and notices stay the same length on every path (uiNotices falls back to English otherwise)", async () => {
    const { db, fetch } = failingHarness(500);
    const live = await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER });
    expect(live.warnings).toHaveLength(live.notices.length);
    const cached = await findGridForUser(db, { id: "alice" }, query(), { now, fetch, masterKey: MASTER });
    expect(cached.grid.meta.served_from_cache).toBe(true);
    expect(cached.warnings).toHaveLength(cached.notices.length);
    const clean = harness();
    const ok = await findGridForUser(clean.db, { id: "alice" }, query(), { now, fetch: clean.fetch, masterKey: MASTER });
    expect(ok.warnings).toHaveLength(ok.notices.length);
  });

  it("a token rejection on a route list is not swallowed: it fails the attempt, and the token is renewed", async () => {
    const { db, fetch } = failingHarness(401);
    const renewing = renewingBroker();
    // Refused for any token: the attempt after the renewal is refused too, and that refusal stands.
    const refusing = fakeFetch((req) => (req.url.pathname === "/partnerapi/search" ? textResponse("unauthorized", 401) : fetch(req.url.toString(), { headers: req.headers })));
    await expect(findGridForUser(db, { id: "alice" }, query(), { now, fetch: refusing, masterKey: MASTER, tokenBroker: renewing.broker })).rejects.toBeInstanceOf(SeatsAeroHttpError);
    expect(renewing.calls).toEqual([`seats:otr:test-alice`]);
    // The first attempt's own route-list refusal is what started the renewal (the catalog let it through).
    const first = failingHarness(401);
    const once = renewingBroker();
    await findGridForUser(first.db, { id: "alice" }, query(), { now, fetch: first.fetch, masterKey: MASTER, tokenBroker: once.broker }).catch(() => undefined);
    expect(once.calls).toHaveLength(1);
  });
});
