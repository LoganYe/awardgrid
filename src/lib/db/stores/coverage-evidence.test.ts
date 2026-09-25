/**
 * The web cache keeps coverage evidence (UI/UX v1 T03, migration 0004, cache_coverage.evidence).
 *
 * A fetch that stopped at the page cap or for quota must stay partial on every later cache hit, on the web as on
 * iOS; a cell written before evidence existed, or rewritten by a build that does not record it, proves nothing.
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openTestDb } from "@/lib/db/client";
import { createSqliteStores } from "@/lib/db/stores";
import { createSqliteAvailabilityCache, decodeCoverageEvidence } from "@/lib/db/stores/cache";
import { seedUsers, testDbWithUsers } from "@/lib/db/stores/testing";
import { QueryObject } from "@awardgrid/core/query/schema";
import type { CoverageRecord } from "@awardgrid/core/seatsaero/cache";
import { runFind } from "@awardgrid/core/seatsaero/find";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import { RoutesCatalog } from "@awardgrid/core/seatsaero/routes";
import { fakeFetch, jsonResponse, textResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";

const NOW = new Date("2026-10-18T08:30:00Z");
const PAIR = [{ origin: "HKG", dest: "SEA" }];

function record(overrides: Partial<CoverageRecord> = {}): CoverageRecord {
  return {
    origin: "HKG",
    dest: "SEA",
    date_from: "2026-10-01",
    date_to: "2026-10-03",
    cabins: ["J"],
    programs: ["aeroplan"],
    direct_only: false,
    fetched_at: "2026-10-18T08:00:00.000Z",
    ...overrides,
  };
}

describe("coverage evidence in the SQLite coverage table", () => {
  it("round-trips evidence; a record without evidence stays without", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(["u"]));
    await cache.markPairsFetched("u", [record({ evidence: { state: "partial", reason: "page_cap" } })]);
    await cache.markPairsFetched("u", [record({ origin: "PVG" })]);
    const [hkg] = await cache.getCoverage("u", PAIR);
    const [pvg] = await cache.getCoverage("u", [{ origin: "PVG", dest: "SEA" }]);
    expect(hkg).toMatchObject({ date_from: "2026-10-01", date_to: "2026-10-03", evidence: { state: "partial", reason: "page_cap" } });
    expect("evidence" in pvg!).toBe(false);
  });

  it("a newer fetch brings its own evidence", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(["u"]));
    await cache.markPairsFetched("u", [record({ evidence: { state: "complete", reason: "exhausted" }, fetched_at: "2026-10-18T08:10:00.000Z" })]);
    await cache.markPairsFetched("u", [record({ evidence: { state: "partial", reason: "page_cap" }, fetched_at: "2026-10-18T08:20:00.000Z" })]);
    expect((await cache.getCoverage("u", PAIR))[0]).toMatchObject({ fetched_at: "2026-10-18T08:20:00.000Z", evidence: { state: "partial", reason: "page_cap" } });
  });

  it("an OLDER fetch that finishes later rewrote the rows: unless it was complete, the cells keep no evidence", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(["u"]));
    await cache.markPairsFetched("u", [record({ evidence: { state: "complete", reason: "exhausted" }, fetched_at: "2026-10-18T08:10:00.000Z" })]);
    await cache.markPairsFetched("u", [record({ evidence: { state: "partial", reason: "quota" }, fetched_at: "2026-10-18T08:00:00.000Z" })]);
    const [rec] = await cache.getCoverage("u", PAIR);
    expect(rec!.fetched_at).toBe("2026-10-18T08:10:00.000Z");
    expect("evidence" in rec!).toBe(false);
    // An older write that was itself complete leaves the newer complete evidence in place.
    const other = createSqliteAvailabilityCache(testDbWithUsers(["v"]));
    await other.markPairsFetched("v", [record({ evidence: { state: "complete", reason: "exhausted" }, fetched_at: "2026-10-18T08:10:00.000Z" })]);
    await other.markPairsFetched("v", [record({ evidence: { state: "complete", reason: "exhausted" }, fetched_at: "2026-10-18T08:00:00.000Z" })]);
    expect((await other.getCoverage("v", PAIR))[0]).toMatchObject({ evidence: { state: "complete" } });
  });

  it("a newer write that records no evidence (an older build) leaves the cells with none", async () => {
    const db = testDbWithUsers(["u"]);
    const cache = createSqliteAvailabilityCache(db);
    await cache.markPairsFetched("u", [record({ evidence: { state: "complete", reason: "exhausted" } })]);
    // A pre-0004 upsert: fetched_at moves to max(old, new), evidence untouched.
    db.run(sql`UPDATE cache_coverage SET fetched_at = '2026-10-18T08:25:00.000Z'`);
    const [rec] = await cache.getCoverage("u", PAIR);
    expect(rec!.fetched_at).toBe("2026-10-18T08:25:00.000Z");
    expect("evidence" in rec!).toBe(false);
  });

  it("folds exactly as before evidence existed, and a folded rectangle carries its weakest cell's evidence", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(["u"]));
    const at = "2026-10-18T08:00:00.000Z";
    await cache.markPairsFetched("u", [
      record({ date_from: "2026-10-01", date_to: "2026-10-02", evidence: { state: "complete", reason: "exhausted" }, fetched_at: at }),
      record({ date_from: "2026-10-03", date_to: "2026-10-04", evidence: { state: "partial", reason: "page_cap" }, fetched_at: at }),
    ]);
    const recs = await cache.getCoverage("u", PAIR);
    expect(recs.map((r) => [r.date_from, r.date_to, r.evidence?.state])).toEqual([["2026-10-01", "2026-10-04", "partial"]]);
  });

  it("treats malformed evidence as none", () => {
    const at = "2026-10-18T08:00:00.000Z";
    expect(decodeCoverageEvidence("nope", at)).toBeNull();
    expect(decodeCoverageEvidence(JSON.stringify({ state: "complete", reason: "page_cap", at }), at)).toBeNull();
    expect(decodeCoverageEvidence(JSON.stringify({ state: "complete", reason: "exhausted" }), at)).toBeNull();
    expect(decodeCoverageEvidence(JSON.stringify({ state: "complete", reason: "exhausted", at }), at)).toEqual({ state: "complete", reason: "exhausted" });
  });
});

describe("runFind over the SQLite stores keeps a capped fetch partial", () => {
  it("page cap on the fetch → partial; the cache hit that follows is still partial", async () => {
    const db = openTestDb();
    seedUsers(db, ["alice"]);
    const stores = createSqliteStores(db);
    const page = {
      data: [
        {
          ID: "synthetic-cap-1",
          Route: { ID: "r", OriginAirport: "HKG", DestinationAirport: "SEA", Source: "aeroplan" },
          Date: "2026-10-18",
          JAvailable: true,
          JMileageCost: "75000",
          Source: "aeroplan",
        },
      ],
      hasMore: true,
      cursor: 1_700_000_000,
    };
    const fetch = fakeFetch((req) => (req.url.pathname === "/partnerapi/search" ? jsonResponse(page) : textResponse("nf", 404)));
    const deps = {
      fetch,
      quota: new Quota({ store: stores.quota, now: () => NOW }),
      cache: stores.cache,
      routes: new RoutesCatalog({ store: stores.routes, now: () => NOW }),
    };
    const query = QueryObject.parse({
      origins: ["HKG"],
      destinations: ["SEA"],
      date_from: "2026-10-01",
      date_to: "2026-10-30",
      cabins: ["J"],
      programs: ["aeroplan"],
      raw_text: "synthetic",
      language: "en",
    });
    const first = await runFind({ query, userId: "alice", apiKey: "fixture-not-a-real-key", ...deps, now: () => NOW, ttlMinutes: 45, maxPages: 2 });
    expect(first.coverage?.state).toBe("partial");
    const again = await runFind({ query, userId: "alice", apiKey: "fixture-not-a-real-key", ...deps, now: () => NOW, ttlMinutes: 45 });
    expect(again.served_from_cache).toBe(true);
    expect(again.coverage?.state).toBe("partial");
    expect(again.coverage?.slices.map((s) => s.reason)).toEqual(["page_cap"]);
  });
});

describe("runFind over the SQLite stores: overlapping fetches, races and save failures", () => {
  const Q = (patch: Record<string, unknown> = {}) =>
    QueryObject.parse({ origins: ["HKG"], destinations: ["SEA"], date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J"], programs: ["aeroplan"], raw_text: "synthetic", language: "en", ...patch });
  const av = (id: string, date: string, program = "aeroplan") => ({
    ID: id,
    Route: { ID: `r-${program}`, OriginAirport: "HKG", DestinationAirport: "SEA", Source: program },
    Date: date,
    JAvailable: true,
    JMileageCost: "75000",
    JDirect: true,
    FAvailable: true,
    FMileageCost: "110000",
    FDirect: true,
    Source: program,
  });
  function setup(user: string) {
    const db = openTestDb();
    seedUsers(db, [user]);
    const stores = createSqliteStores(db);
    let mode: "complete" | "capped" = "complete";
    const fetch = fakeFetch((req) => {
      if (req.url.pathname === "/partnerapi/routes") return jsonResponse([]);
      if (req.url.pathname !== "/partnerapi/search") return textResponse("nf", 404);
      return mode === "complete"
        ? jsonResponse({ data: [av("a", "2026-10-05"), av("b", "2026-10-06"), av("c", "2026-10-07", "united")], hasMore: false })
        : jsonResponse({ data: [av("a", "2026-10-05")], hasMore: true, cursor: 1 });
    });
    const deps = { fetch, quota: new Quota({ store: stores.quota, now: () => NOW }), cache: stores.cache, routes: new RoutesCatalog({ store: stores.routes, now: () => NOW }) };
    const run = (query: QueryObject, extra: { maxPages?: number; now?: Date } = {}) =>
      runFind({ query, userId: user, apiKey: "fixture-not-a-real-key", ...deps, now: () => extra.now ?? NOW, ttlMinutes: 45, ...(extra.maxPages ? { maxPages: extra.maxPages } : {}) });
    return { db, stores, deps, run, setMode: (m: typeof mode) => (mode = m) };
  }

  it.each<[string, Record<string, unknown>]>([
    ["wider dates", { date_to: "2026-11-30" }],
    ["more cabins", { cabins: ["J", "F"] }],
    ["direct only, wider dates", { direct_only: true, date_to: "2026-11-30" }],
  ])("a later capped fetch over an overlapping scope (%s) makes the earlier complete scope partial", async (_why, patch) => {
    const s = setup("alice");
    expect((await s.run(Q())).coverage?.state).toBe("complete");
    s.setMode("capped");
    await s.run(Q(patch), { maxPages: 1, now: new Date(NOW.getTime() + 60_000) });
    const again = await s.run(Q(), { now: new Date(NOW.getTime() + 120_000) });
    expect(again.served_from_cache).toBe(true);
    expect(again.coverage?.state).toBe("partial");
  });

  it("across program keys: a capped fetch for one program makes an earlier all-programs scope partial", async () => {
    const s = setup("alice");
    const all = Q({ programs: undefined });
    expect((await s.run(all)).coverage?.state).toBe("complete");
    s.setMode("capped");
    await s.run(Q({ date_from: "2026-09-25" }), { maxPages: 1, now: new Date(NOW.getTime() + 60_000) });
    const again = await s.run(all, { now: new Date(NOW.getTime() + 120_000) });
    expect(again.served_from_cache).toBe(true);
    expect(again.coverage?.state).toBe("partial");
  });

  it("a save failure rolls the whole replace back: old rows, old evidence, still complete and consistent", async () => {
    const s = setup("alice");
    const first = await s.run(Q());
    expect(first.rows).toHaveLength(2);
    // Break the coverage write inside the same transaction as the row replace.
    s.db.run(sql`CREATE TRIGGER fail_coverage BEFORE INSERT ON cache_coverage BEGIN SELECT RAISE(ABORT, 'simulated save failure'); END`);
    s.setMode("capped");
    await expect(s.run(Q({ date_to: "2026-11-30" }), { maxPages: 1, now: new Date(NOW.getTime() + 60_000) })).rejects.toThrow(/simulated save failure/);
    s.db.run(sql`DROP TRIGGER fail_coverage`);
    const again = await s.run(Q(), { now: new Date(NOW.getTime() + 120_000) });
    expect(again.served_from_cache).toBe(true);
    expect(again.rows).toHaveLength(2);
    expect(again.coverage?.state).toBe("complete");
  });

  it("a 429 or 500 fails the run before any write", async () => {
    for (const status of [429, 500]) {
      const db = openTestDb();
      seedUsers(db, ["alice"]);
      const stores = createSqliteStores(db);
      const fetch = fakeFetch(() => textResponse("upstream", status));
      const deps = { fetch, quota: new Quota({ store: stores.quota, now: () => NOW }), cache: stores.cache, routes: new RoutesCatalog({ store: stores.routes, now: () => NOW }) };
      await expect(runFind({ query: Q(), userId: "alice", apiKey: "fixture-not-a-real-key", ...deps, now: () => NOW, ttlMinutes: 45 })).rejects.toThrow();
      expect(await stores.cache.getCoverage("alice", PAIR)).toEqual([]);
    }
  });
});

