/**
 * runFind end to end over the synthetic fixture with the SQLite stores (no network, no env
 * keys). Mirrors the in-memory runFind tests and adds the kickoff §9 Phase-2 self-acceptance:
 * two users with two keys have independent caches and quotas, and no key material ever lands
 * in the database.
 */
import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { openTestDb, type Db } from "@/lib/db/client";
import { apiUsage, availabilityCache, cacheCoverage, routesCache } from "@/lib/db/schema";
import { createSqliteStores } from "@/lib/db/stores";
import { seedUsers } from "@/lib/db/stores/testing";
import { QueryObject, type QueryObjectInput } from "@awardgrid/core/query/schema";
import { runFind } from "@awardgrid/core/seatsaero/find";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import { RoutesCatalog } from "@awardgrid/core/seatsaero/routes";
import type { Route } from "@awardgrid/core/seatsaero/types";
import { fakeFetch, jsonResponse, textResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { SYNTHETIC_ORIGINS, SYNTHETIC_PROGRAMS, generateSynthetic } from "@awardgrid/core/test-fixtures/seatsaero/generate-synthetic";

const ALICE_KEY = "alice_pro_key_SECRET_a1b2c3";
const BOB_KEY = "bob_pro_key_SECRET_z9y8x7";
const NOW = new Date("2026-10-01T12:00:00Z");

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

/** Routes per program derived from the synthetic fixture (GMP is monitored by nobody). */
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

const synthetic = generateSynthetic();

function harness(db: Db) {
  const fetch = fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") return jsonResponse(synthetic);
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse(syntheticRoutes(req.url.searchParams.get("source")!));
    return textResponse("not found", 404);
  });
  const stores = createSqliteStores(db);
  const quota = new Quota({ store: stores.quota, now: () => NOW });
  const routes = new RoutesCatalog({ store: stores.routes, now: () => NOW });
  return { fetch, stores, quota, cache: stores.cache, routes };
}

function dumpTables(db: Db): string {
  return JSON.stringify({
    [getTableName(apiUsage)]: db.select().from(apiUsage).all(),
    [getTableName(availabilityCache)]: db.select().from(availabilityCache).all(),
    [getTableName(cacheCoverage)]: db.select().from(cacheCoverage).all(),
    [getTableName(routesCache)]: db.select().from(routesCache).all(),
  });
}

describe("runFind over the SQLite stores (synthetic fixture, no network)", () => {
  it("first call spends N calls and persists rows + coverage + routes; second within the TTL spends 0", async () => {
    const db = openTestDb();
    seedUsers(db, ["alice"]);
    const h = harness(db);
    const q = query();

    const first = await runFind({ query: q, userId: "alice", apiKey: ALICE_KEY, ...h, now: () => NOW });
    expect(first.served_from_cache).toBe(false);
    expect(first.plan?.mode).toBe("cached");
    // 1 search page + 6 Get Routes calls (GMP→SEA came back empty)
    const N = 1 + SYNTHETIC_PROGRAMS.length;
    expect(first.api_calls_used).toBe(N);
    expect(h.fetch.calls).toHaveLength(N);
    expect(await h.quota.used("alice")).toBe(N);
    expect(first.unmonitored_pairs).toEqual([{ origin: "GMP", dest: "SEA", key: "GMP-SEA" }]);
    expect(first.warnings).toEqual([]);
    expect(first.rows.length).toBeGreaterThan(200);
    expect(first.rows.every((r) => r.fetched_at === NOW.toISOString())).toBe(true);

    // Everything landed in SQLite, scoped to alice.
    expect(db.select().from(apiUsage).all()).toEqual([{ userId: "alice", provider: "seats_aero", day: "2026-10-01", calls: N }]);
    const cachedRows = db.select().from(availabilityCache).all();
    expect(cachedRows.length).toBeGreaterThanOrEqual(first.rows.length);
    expect(cachedRows.every((r) => r.userId === "alice")).toBe(true);
    // 6 pairs with rows: 30 days × 2 cabins each, plus GMP (empty but covered) = 7 × 60
    expect(db.select().from(cacheCoverage).all()).toHaveLength(7 * 30 * 2);
    expect(db.select().from(routesCache).all().map((r) => r.source).sort()).toEqual([...SYNTHETIC_PROGRAMS].sort());

    // Second run within the TTL: served from cache, zero calls, identical rows.
    const second = await runFind({ query: q, userId: "alice", apiKey: ALICE_KEY, ...h, now: () => new Date(NOW.getTime() + 30 * 60_000) });
    expect(second.served_from_cache).toBe(true);
    expect(second.api_calls_used).toBe(0);
    expect(h.fetch.calls).toHaveLength(N);
    expect(await h.quota.used("alice")).toBe(N);
    expect(second.rows).toHaveLength(first.rows.length);
    expect(second.unmonitored_pairs).toEqual(first.unmonitored_pairs);
    expect(second.fetched_at_min).toBe(NOW.toISOString());
    const sortKey = (r: { program: string; origin: string; date: string; cabin: string }) => `${r.program}|${r.origin}|${r.date}|${r.cabin}`;
    const byKey = (a: (typeof first.rows)[number], b: (typeof first.rows)[number]) => sortKey(a).localeCompare(sortKey(b));
    expect([...second.rows].sort(byKey)).toEqual([...first.rows].sort(byKey));

    // A narrower query (subset of dates/cabins/programs) is covered too.
    const narrower = await runFind({ query: query({ programs: ["american"], cabins: ["J"], date_to: "2026-10-10" }), userId: "alice", apiKey: ALICE_KEY, ...h, now: () => NOW });
    expect(narrower.served_from_cache).toBe(true);
    expect(narrower.rows.length).toBeGreaterThan(0);
    expect(narrower.rows.every((r) => r.program === "american" && r.cabin === "J" && r.date <= "2026-10-10")).toBe(true);

    // A brand-new process (fresh store instances, same database) is still served from cache.
    const h2 = harness(db);
    const fresh = await runFind({ query: q, userId: "alice", apiKey: ALICE_KEY, ...h2, now: () => NOW });
    expect(fresh.served_from_cache).toBe(true);
    expect(fresh.api_calls_used).toBe(0);
    expect(h2.fetch.calls).toHaveLength(0);
    // A cache hit in a fresh process hydrates the catalog from routes_cache (zero calls) and
    // still yields the "not monitored" claim the first request paid for.
    expect(fresh.unmonitored_pairs).toEqual(first.unmonitored_pairs);
    expect(h2.fetch.calls).toHaveLength(0);
    const loaded = await h2.routes.ensureLoaded("alice", [...SYNTHETIC_PROGRAMS], { getRoutes: async () => { throw new Error("must not fetch"); } } as never);
    expect(loaded).toEqual({ fetched: [], cached: [...SYNTHETIC_PROGRAMS], skipped: [] });
    expect(h2.fetch.calls).toHaveLength(0);
    expect(h2.routes.unmonitoredPairs("alice", first.plan!.pairs, [...SYNTHETIC_PROGRAMS])).toEqual(first.unmonitored_pairs);

    // Past the TTL the search runs again; routes are still cached for 7 days → exactly 1 call.
    const third = await runFind({ query: q, userId: "alice", apiKey: ALICE_KEY, ...h, now: () => new Date(NOW.getTime() + 46 * 60_000) });
    expect(third.served_from_cache).toBe(false);
    expect(third.api_calls_used).toBe(1);
    expect(await h.quota.used("alice")).toBe(N + 1);
  });

  it("two seeded users with two keys have independent caches, quotas and route catalogs (§9 Phase 2)", async () => {
    const db = openTestDb();
    seedUsers(db, ["alice", "bob"]);
    const h = harness(db);
    const q = query();

    const alice = await runFind({ query: q, userId: "alice", apiKey: ALICE_KEY, ...h, now: () => NOW });
    const aliceCalls = alice.api_calls_used;
    expect(aliceCalls).toBe(1 + SYNTHETIC_PROGRAMS.length);

    // Bob's identical query is NOT served from alice's cache: he pays again, under HIS key only.
    const before = h.fetch.calls.length;
    const bob = await runFind({ query: q, userId: "bob", apiKey: BOB_KEY, ...h, now: () => NOW });
    expect(bob.served_from_cache).toBe(false);
    expect(bob.api_calls_used).toBe(aliceCalls);
    const bobsCalls = h.fetch.calls.slice(before);
    expect(bobsCalls).toHaveLength(bob.api_calls_used);
    expect(bobsCalls.every((c) => c.headers["partner-authorization"] === BOB_KEY)).toBe(true);
    expect(h.fetch.calls.slice(0, before).every((c) => c.headers["partner-authorization"] === ALICE_KEY)).toBe(true);

    // Quotas count independently.
    expect(await h.quota.used("alice")).toBe(aliceCalls);
    expect(await h.quota.used("bob")).toBe(aliceCalls);
    expect(db.select().from(apiUsage).all().map((r) => [r.userId, r.calls])).toEqual([
      ["alice", aliceCalls],
      ["bob", aliceCalls],
    ]);

    // Caches are separate copies: same content, different owners; pruning bob leaves alice intact.
    const rows = db.select().from(availabilityCache).all();
    expect(rows.filter((r) => r.userId === "alice")).toHaveLength(rows.length / 2);
    expect(rows.filter((r) => r.userId === "bob")).toHaveLength(rows.length / 2);
    expect(db.select().from(routesCache).all().filter((r) => r.userId === "bob")).toHaveLength(SYNTHETIC_PROGRAMS.length);
    await h.stores.cache.prune("bob", "2027-01-01T00:00:00.000Z");
    const aliceAgain = await runFind({ query: q, userId: "alice", apiKey: ALICE_KEY, ...h, now: () => NOW });
    expect(aliceAgain.served_from_cache).toBe(true);
    expect(aliceAgain.rows).toHaveLength(alice.rows.length);
    const bobAgain = await runFind({ query: q, userId: "bob", apiKey: BOB_KEY, ...h, now: () => NOW });
    expect(bobAgain.served_from_cache).toBe(false);
    expect(await h.quota.used("alice")).toBe(aliceCalls);

    // No key material anywhere in the four tables (§0.2 #8).
    const dump = dumpTables(db);
    expect(dump).not.toContain(ALICE_KEY);
    expect(dump).not.toContain(BOB_KEY);
    expect(dump).not.toContain("SECRET");
  });

  it("caches an empty result via coverage and include_filtered stays a separate scope", async () => {
    const db = openTestDb();
    seedUsers(db, ["u"]);
    const h = harness(db);
    const empty = query({ origins: ["GMP"], programs: ["alaska"] });
    const first = await runFind({ query: empty, userId: "u", apiKey: ALICE_KEY, ...h, now: () => NOW });
    expect(first.rows).toEqual([]);
    expect(first.api_calls_used).toBe(2); // search + alaska routes
    expect(first.unmonitored_pairs).toEqual([{ origin: "GMP", dest: "SEA", key: "GMP-SEA" }]);
    const again = await runFind({ query: empty, userId: "u", apiKey: ALICE_KEY, ...h, now: () => NOW });
    expect(again.served_from_cache).toBe(true);
    expect(again.api_calls_used).toBe(0);
    expect(again.unmonitored_pairs).toEqual(first.unmonitored_pairs);

    const searches = () => h.fetch.calls.filter((c) => c.url.pathname === "/partnerapi/search");
    const plain = await runFind({ query: query(), userId: "u", apiKey: ALICE_KEY, ...h, now: () => NOW });
    const filtered = await runFind({ query: query({ include_filtered: true }), userId: "u", apiKey: ALICE_KEY, ...h, now: () => NOW });
    expect(filtered.served_from_cache).toBe(false);
    expect(searches()).toHaveLength(3);
    expect(filtered.rows.length).toBe(plain.rows.length);
    expect(plain.rows.every((r) => r.include_filtered === undefined)).toBe(true);
    expect(filtered.rows.every((r) => r.include_filtered === true)).toBe(true);
    const plainAgain = await runFind({ query: query(), userId: "u", apiKey: ALICE_KEY, ...h, now: () => NOW });
    const filteredAgain = await runFind({ query: query({ include_filtered: true }), userId: "u", apiKey: ALICE_KEY, ...h, now: () => NOW });
    expect(plainAgain.served_from_cache).toBe(true);
    expect(filteredAgain.served_from_cache).toBe(true);
    expect(plainAgain.rows.every((r) => r.include_filtered === undefined)).toBe(true);
    expect(filteredAgain.rows.every((r) => r.include_filtered === true)).toBe(true);
    expect(searches()).toHaveLength(3);
  });

  it("direct_only: subset coverage never satisfies an all-flights query, but the reverse is served locally", async () => {
    const db = openTestDb();
    seedUsers(db, ["d"]);
    const h = harness(db);
    const searches = () => h.fetch.calls.filter((c) => c.url.pathname === "/partnerapi/search");
    // The fixture fetch ignores only_direct_flights, so the direct-only pull returns every object;
    // runFind filters locally to direct rows and records direct-only coverage.
    const direct = await runFind({ query: query({ direct_only: true }), userId: "d", apiKey: ALICE_KEY, ...h, now: () => NOW });
    expect(direct.rows.length).toBeGreaterThan(0);
    expect(direct.rows.every((r) => r.direct)).toBe(true);
    expect(searches()).toHaveLength(1);
    const all = await runFind({ query: query(), userId: "d", apiKey: ALICE_KEY, ...h, now: () => NOW });
    expect(all.served_from_cache).toBe(false);
    expect(searches()).toHaveLength(2);
    expect(all.rows.some((r) => !r.direct)).toBe(true);
    const again = await runFind({ query: query({ direct_only: true }), userId: "d", apiKey: ALICE_KEY, ...h, now: () => NOW });
    expect(again.served_from_cache).toBe(true);
    expect(again.rows.every((r) => r.direct)).toBe(true);
    expect(again.rows).toHaveLength(direct.rows.length);
    expect(searches()).toHaveLength(2);
  });
});
