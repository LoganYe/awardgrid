import { describe, expect, it } from "vitest";
import { availabilityCache, cacheCoverage } from "@/lib/db/schema";
import {
  ALL_PROGRAMS_KEY,
  createSqliteAvailabilityCache,
  datesBetween,
  decodeProgram,
  decodeProgramsKey,
  encodeProgram,
  encodeProgramsKey,
} from "@/lib/db/stores/cache";
import { testDbWithUsers } from "@/lib/db/stores/testing";
import type { AvailabilityRow } from "@/lib/grid/types";
import { InMemoryAvailabilityCache, coverageSatisfies, uncoveredPairs, type CoverageRecord } from "@/lib/seatsaero/cache";
import type { Cabin } from "@/lib/query/schema";

const USERS = ["alice", "bob", "u"];

function row(overrides: Partial<AvailabilityRow> = {}): AvailabilityRow {
  return {
    program: "american",
    origin: "HKG",
    dest: "SEA",
    date: "2026-10-05",
    cabin: "J",
    miles: 70000,
    fees_cents: null,
    currency: null,
    seats_left: 2,
    direct: true,
    airlines: ["CX"],
    computed_last_seen: "2026-10-01T10:00:00Z",
    source_id: "id1",
    booking_url: null,
    fetched_at: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

const scope = {
  origins: ["HKG", "PVG"],
  dests: ["SEA"],
  date_from: "2026-10-01",
  date_to: "2026-10-30",
  cabins: ["J", "F"] as const,
};

function coverage(overrides: Partial<CoverageRecord> = {}): CoverageRecord {
  return {
    origin: "HKG",
    dest: "SEA",
    date_from: "2026-10-01",
    date_to: "2026-10-30",
    cabins: ["J", "F"],
    programs: null,
    direct_only: false,
    fetched_at: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("encoding helpers", () => {
  it("round-trips the include_filtered scope through the program column", () => {
    expect(encodeProgram("american", undefined)).toBe("american");
    expect(encodeProgram("american", false)).toBe("american");
    expect(encodeProgram("american", true)).toBe("american#filtered");
    // Existing stored text keeps its meaning: no `#pct` suffix decodes to the API default, 100.
    expect(decodeProgram("american")).toEqual({ program: "american", include_filtered: false, min_cabin_pct: 100 });
    expect(decodeProgram("american#filtered")).toEqual({ program: "american", include_filtered: true, min_cabin_pct: 100 });
  });

  it("round-trips the min_cabin_pct scope through the program column with no migration", () => {
    // 100 is the default, so it adds NOTHING: every row already in the table keeps its exact
    // stored text and decodes to 100. That is what makes this change migration-free.
    expect(encodeProgram("american", false, 100)).toBe("american");
    expect(encodeProgram("american", false, undefined)).toBe("american");
    expect(encodeProgram("american", true, 100)).toBe("american#filtered");
    expect(encodeProgram("american", false, 70)).toBe("american#pct70");
    expect(encodeProgram("american", true, 70)).toBe("american#filtered#pct70");
    expect(encodeProgram("american", false, 0)).toBe("american#pct0");
    expect(decodeProgram("american")).toEqual({ program: "american", include_filtered: false, min_cabin_pct: 100 });
    expect(decodeProgram("american#filtered")).toEqual({ program: "american", include_filtered: true, min_cabin_pct: 100 });
    expect(decodeProgram("american#pct70")).toEqual({ program: "american", include_filtered: false, min_cabin_pct: 70 });
    expect(decodeProgram("american#filtered#pct70")).toEqual({ program: "american", include_filtered: true, min_cabin_pct: 70 });
    expect(decodeProgram("american#pct0")).toEqual({ program: "american", include_filtered: false, min_cabin_pct: 0 });
  });

  it("round-trips programs + flags through programs_key with a canonical order", () => {
    expect(encodeProgramsKey(null, false, false)).toBe(ALL_PROGRAMS_KEY);
    expect(encodeProgramsKey(undefined, undefined, undefined)).toBe("*");
    expect(encodeProgramsKey(["united", "alaska", "united"], false, false)).toBe("alaska,united");
    expect(encodeProgramsKey(["alaska"], true, true)).toBe("alaska|direct|filtered");
    expect(encodeProgramsKey(null, false, true)).toBe("*|filtered");
    expect(encodeProgramsKey([], true, false)).toBe("|direct");
    expect(decodeProgramsKey("*")).toEqual({ programs: null, direct_only: false, include_filtered: false, min_cabin_pct: 100 });
    expect(decodeProgramsKey("alaska,united|direct")).toEqual({ programs: ["alaska", "united"], direct_only: true, include_filtered: false, min_cabin_pct: 100 });
    expect(decodeProgramsKey("*|filtered")).toEqual({ programs: null, direct_only: false, include_filtered: true, min_cabin_pct: 100 });
    expect(decodeProgramsKey("|direct")).toEqual({ programs: [], direct_only: true, include_filtered: false, min_cabin_pct: 100 });
  });

  it("carries min_cabin_pct in programs_key only when it is not the default", () => {
    // Every programs_key already in cache_coverage keeps its exact text and decodes to 100.
    expect(encodeProgramsKey(null, false, false, 100)).toBe("*");
    expect(encodeProgramsKey(null, false, false, undefined)).toBe("*");
    expect(encodeProgramsKey(null, false, false, 70)).toBe("*|pct70");
    expect(encodeProgramsKey(["alaska"], true, true, 70)).toBe("alaska|direct|filtered|pct70");
    expect(encodeProgramsKey(null, false, false, 0)).toBe("*|pct0");
    expect(decodeProgramsKey("*")).toEqual({ programs: null, direct_only: false, include_filtered: false, min_cabin_pct: 100 });
    expect(decodeProgramsKey("*|pct70")).toEqual({ programs: null, direct_only: false, include_filtered: false, min_cabin_pct: 70 });
    expect(decodeProgramsKey("alaska|direct|filtered|pct70")).toEqual({
      programs: ["alaska"],
      direct_only: true,
      include_filtered: true,
      min_cabin_pct: 70,
    });
    expect(decodeProgramsKey("*|pct0").min_cabin_pct).toBe(0);
  });

  it("datesBetween is inclusive, handles month ends and inverted ranges", () => {
    expect(datesBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(datesBetween("2026-10-05", "2026-10-05")).toEqual(["2026-10-05"]);
    expect(datesBetween("2026-10-06", "2026-10-05")).toEqual([]);
    expect(datesBetween("garbage", "2026-10-05")).toEqual([]);
    expect(() => datesBetween("2000-01-01", "2030-01-01")).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// The InMemoryAvailabilityCache behaviour tests, replayed against SQLite.
// ---------------------------------------------------------------------------
describe("createSqliteAvailabilityCache", () => {
  it("isolates users: A's rows and coverage are invisible to B", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(USERS));
    await cache.putRows("alice", [row()]);
    await cache.markPairsFetched("alice", [coverage()]);
    expect((await cache.getRows("alice", scope)).rows).toHaveLength(1);
    expect((await cache.getRows("bob", scope)).rows).toHaveLength(0);
    expect((await cache.getRows("bob", scope)).fetched_at_min).toBeNull();
    expect(await cache.getCoverage("alice", [{ origin: "HKG", dest: "SEA" }])).toHaveLength(1);
    expect(await cache.getCoverage("bob", [{ origin: "HKG", dest: "SEA" }])).toHaveLength(0);
    // deleting bob's scope must not touch alice
    await cache.deleteRows("bob", scope);
    expect((await cache.getRows("alice", scope)).rows).toHaveLength(1);
    // bob writing the same PK does not overwrite alice's row
    await cache.putRows("bob", [row({ miles: 1 })]);
    expect((await cache.getRows("alice", scope)).rows[0]!.miles).toBe(70000);
    expect((await cache.getRows("bob", scope)).rows[0]!.miles).toBe(1);
    // per-user prune leaves the other user alone
    expect(await cache.prune("bob", "2027-01-01T00:00:00.000Z")).toEqual({ rows: 1, coverage: 0 });
    expect((await cache.getRows("alice", scope)).rows).toHaveLength(1);
    expect(await cache.getCoverage("alice", [{ origin: "HKG", dest: "SEA" }])).toHaveLength(1);
  });

  it("getRowsBySourceId is per user and per scope, and decodes the row it returns (#52)", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(USERS));
    await cache.putRows("alice", [
      row({ cabin: "J" }),
      row({ cabin: "F", miles: 90000 }),
      row({ cabin: "J", miles: 71000, include_filtered: true }),
      row({ cabin: "J", miles: 72000, min_cabin_pct: 70 }),
    ]);
    await cache.putRows("bob", [row({ cabin: "J", miles: 5 })]);

    const plain = await cache.getRowsBySourceId("alice", "id1", {});
    expect(plain.map((r) => [r.cabin, r.miles])).toEqual([
      ["F", 90000],
      ["J", 70000],
    ]);
    // The `#filtered` / `#pct70` suffixes never leak out of the store.
    expect(plain.every((r) => r.program === "american" && r.include_filtered === undefined && r.min_cabin_pct === undefined)).toBe(true);
    expect((await cache.getRowsBySourceId("alice", "id1", { include_filtered: true })).map((r) => r.miles)).toEqual([71000]);
    expect((await cache.getRowsBySourceId("alice", "id1", { min_cabin_pct: 70 })).map((r) => r.miles)).toEqual([72000]);
    expect((await cache.getRowsBySourceId("bob", "id1", {})).map((r) => r.miles)).toEqual([5]);
    expect(await cache.getRowsBySourceId("alice", "missing", {})).toEqual([]);
    expect(await cache.getRowsBySourceId("alice", "", {})).toEqual([]);
    await expect(cache.getRowsBySourceId("", "id1", {})).rejects.toBeInstanceOf(RangeError);
  });

  it("updateRowFees touches only the three fee columns, and never inserts (#52)", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(USERS));
    const j = row({ cabin: "J" });
    await cache.putRows("alice", [j, row({ cabin: "J", miles: 71000, include_filtered: true })]);
    await cache.putRows("bob", [row({ cabin: "J", miles: 5 })]);
    const fees = { fees_cents: 3400, currency: null, booking_url: "https://example.test/book" };
    const read = async (u: string, scope = {}) => (await cache.getRowsBySourceId(u, "id1", scope))[0];

    expect(await cache.updateRowFees("alice", j, fees)).toBe(true);
    const hit = (await read("alice"))!;
    expect([hit.fees_cents, hit.currency, hit.booking_url]).toEqual([3400, null, "https://example.test/book"]);
    // Everything else — including the freshness the grid's mark reads — is untouched.
    expect([hit.miles, hit.seats_left, hit.computed_last_seen, hit.fetched_at]).toEqual([j.miles, j.seats_left, j.computed_last_seen, j.fetched_at]);
    // and it stayed inside its own scope and its own user.
    expect((await read("alice", { include_filtered: true }))!.fees_cents).toBeNull();
    expect((await read("bob"))!.fees_cents).toBeNull();

    // No row matches → no INSERT. This is what keeps a concurrently deleted row deleted.
    const before = await cache.getRows("alice", scope);
    expect(await cache.updateRowFees("alice", { ...j, date: "2026-11-30" }, fees)).toBe(false);
    expect(await cache.updateRowFees("alice", { ...j, source_id: "id-other" }, fees)).toBe(false);
    expect(await cache.updateRowFees("alice", { ...j, min_cabin_pct: 70 }, fees)).toBe(false);
    expect((await cache.getRows("alice", scope)).rows).toHaveLength(before.rows.length);
  });

  it("keeps include_filtered rows in their own scope with their own PK", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(USERS));
    await cache.putRows("u", [row({ miles: 70000 }), row({ miles: 90000, include_filtered: true })]);
    const plain = (await cache.getRows("u", scope)).rows;
    expect(plain.map((r) => r.miles)).toEqual([70000]);
    expect(plain[0]!.include_filtered).toBeUndefined();
    expect(plain[0]!.program).toBe("american");
    const filtered = (await cache.getRows("u", { ...scope, include_filtered: true })).rows;
    expect(filtered.map((r) => r.miles)).toEqual([90000]);
    expect(filtered[0]!.include_filtered).toBe(true);
    expect(filtered[0]!.program).toBe("american");
    // explicit programs list honours the scope too
    expect((await cache.getRows("u", { ...scope, programs: ["american"] })).rows.map((r) => r.miles)).toEqual([70000]);
    expect((await cache.getRows("u", { ...scope, programs: ["american"], include_filtered: true })).rows.map((r) => r.miles)).toEqual([90000]);
    await cache.deleteRows("u", { ...scope, include_filtered: true });
    expect((await cache.getRows("u", scope)).rows).toHaveLength(1);
    expect((await cache.getRows("u", { ...scope, include_filtered: true })).rows).toHaveLength(0);
  });

  it("keeps min_cabin_pct rows in their own scope — a 100 query never sees a #pct70 row (issue #18)", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(USERS));
    await cache.putRows("u", [
      row({ miles: 70000 }),
      row({ miles: 90000, min_cabin_pct: 70 }),
      row({ miles: 80000, include_filtered: true, min_cabin_pct: 70 }),
    ]);
    // THE TRAP: scopeWhere selected the default scope with notLike(program, "%#filtered"),
    // which is anchored at the end — "american#pct70" does not end in "#filtered", so an
    // unguarded prefilter hands a 70 % row to a 100 % query.
    const plain = (await cache.getRows("u", scope)).rows;
    expect(plain.map((r) => r.miles)).toEqual([70000]);
    expect(plain[0]!.program).toBe("american");
    expect(plain[0]!.min_cabin_pct).toBeUndefined();
    expect((await cache.getRows("u", { ...scope, min_cabin_pct: 100 })).rows.map((r) => r.miles)).toEqual([70000]);

    const pct = (await cache.getRows("u", { ...scope, min_cabin_pct: 70 })).rows;
    expect(pct.map((r) => r.miles)).toEqual([90000]);
    expect(pct[0]!.program).toBe("american");
    expect(pct[0]!.min_cabin_pct).toBe(70);
    // The two flags are independent scopes and compose.
    const both = (await cache.getRows("u", { ...scope, include_filtered: true, min_cabin_pct: 70 })).rows;
    expect(both.map((r) => r.miles)).toEqual([80000]);
    expect((await cache.getRows("u", { ...scope, include_filtered: true })).rows).toHaveLength(0);
    // An explicit programs list is exact on both flags too.
    expect((await cache.getRows("u", { ...scope, programs: ["american"] })).rows.map((r) => r.miles)).toEqual([70000]);
    expect((await cache.getRows("u", { ...scope, programs: ["american"], min_cabin_pct: 70 })).rows.map((r) => r.miles)).toEqual([90000]);
    // Re-inserting a 70 % pull must not delete the 100 % rows.
    await cache.deleteRows("u", { ...scope, min_cabin_pct: 70 });
    expect((await cache.getRows("u", scope)).rows.map((r) => r.miles)).toEqual([70000]);
    expect((await cache.getRows("u", { ...scope, min_cabin_pct: 70 })).rows).toHaveLength(0);
    expect((await cache.getRows("u", { ...scope, include_filtered: true, min_cabin_pct: 70 })).rows).toHaveLength(1);
  });

  it("coverage written at 100 does not cover a 70 % search, and the two never merge", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(USERS));
    const now = new Date("2026-10-01T12:10:00.000Z");
    await cache.markPairsFetched("u", [coverage(), coverage({ min_cabin_pct: 70, fetched_at: "2026-10-01T12:05:00.000Z" })]);
    const recs = await cache.getCoverage("u", [{ origin: "HKG", dest: "SEA" }]);
    expect(recs).toHaveLength(2);
    expect(recs.filter((r) => (r.min_cabin_pct ?? 100) === 100)).toHaveLength(1);
    expect(recs.filter((r) => r.min_cabin_pct === 70)).toHaveLength(1);
    const pair = { origins: ["HKG"], dests: ["SEA"], date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J", "F"] as const };
    expect(uncoveredPairs(pair, recs, 45, now)).toEqual([]);
    expect(uncoveredPairs({ ...pair, min_cabin_pct: 70 }, recs, 45, now)).toEqual([]);
    expect(uncoveredPairs({ ...pair, min_cabin_pct: 50 }, recs, 45, now)).toEqual([{ origin: "HKG", dest: "SEA" }]);
    // Only the 100 record exists → the 70 % search is uncovered and must go to the API.
    const onlyDefault = recs.filter((r) => (r.min_cabin_pct ?? 100) === 100);
    expect(uncoveredPairs({ ...pair, min_cabin_pct: 70 }, onlyDefault, 45, now)).toEqual([{ origin: "HKG", dest: "SEA" }]);
  });

  it("upserts by PK, filters by scope, and reports the oldest fetched_at", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(USERS));
    await cache.putRows("u", [row({ miles: 70000 }), row({ miles: 65000 })]); // same PK → one row
    await cache.putRows("u", [row({ cabin: "F", miles: 90000, fetched_at: "2026-10-01T11:00:00.000Z" })]);
    await cache.putRows("u", [row({ origin: "NRT" }), row({ date: "2026-11-15" }), row({ program: "delta" }), row({ direct: false, cabin: "Y" })]);
    const got = await cache.getRows("u", scope);
    expect(got.rows).toHaveLength(3); // HKG J (65000), HKG F, delta J
    expect(got.rows.find((r) => r.cabin === "J" && r.program === "american")!.miles).toBe(65000);
    expect(got.fetched_at_min).toBe("2026-10-01T11:00:00.000Z");
    expect((await cache.getRows("u", { ...scope, programs: ["delta"] })).rows).toHaveLength(1);
    expect((await cache.getRows("u", { ...scope, programs: [] })).rows).toHaveLength(0);
    await cache.deleteRows("u", { ...scope, programs: ["american"] });
    expect((await cache.getRows("u", scope)).rows.map((r) => r.program)).toEqual(["delta"]);
  });

  it("direct_only reads and deletes only direct rows; nullable fields and airlines JSON round-trip", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(USERS));
    const full = row({
      program: "alaska",
      direct: false,
      fees_cents: 5620,
      currency: "USD",
      booking_url: "https://example.test/book",
      airlines: ["JL", "AS"],
      seats_left: 0,
    });
    await cache.putRows("u", [row(), full]);
    const direct = await cache.getRows("u", { ...scope, direct_only: true });
    expect(direct.rows.map((r) => r.program)).toEqual(["american"]);
    const all = await cache.getRows("u", scope);
    expect(all.rows).toHaveLength(2);
    expect(all.rows.find((r) => r.program === "alaska")).toEqual(full);
    expect(all.rows.find((r) => r.program === "american")).toEqual(row());
    // a direct-only delete leaves the non-direct row alone
    await cache.deleteRows("u", { ...scope, direct_only: true });
    expect((await cache.getRows("u", scope)).rows.map((r) => r.program)).toEqual(["alaska"]);
  });

  it("stores airlines as JSON text and survives a corrupt value", async () => {
    const db = testDbWithUsers(USERS);
    const cache = createSqliteAvailabilityCache(db);
    await cache.putRows("u", [row({ airlines: ["CX", "AA"] })]);
    const raw = db.select({ airlines: availabilityCache.airlines }).from(availabilityCache).all();
    expect(raw).toEqual([{ airlines: '["CX","AA"]' }]);
    db.update(availabilityCache).set({ airlines: "not json" }).run();
    expect((await cache.getRows("u", scope)).rows[0]!.airlines).toEqual([]);
  });

  it("handles large batches (chunked multi-row upserts)", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(USERS));
    const rows: AvailabilityRow[] = [];
    for (const program of ["american", "alaska", "united", "aeroplan", "singapore", "jetblue"]) {
      for (const origin of ["HKG", "PVG"]) {
        for (const date of datesBetween("2026-10-01", "2026-12-31")) {
          for (const cabin of ["J", "F"] as const) rows.push(row({ program, origin, date, cabin, miles: 1 + rows.length }));
        }
      }
    }
    expect(rows.length).toBe(6 * 2 * 92 * 2);
    await cache.putRows("u", rows);
    await cache.putRows("u", rows.map((r) => ({ ...r, miles: r.miles + 1 })));
    const got = await cache.getRows("u", { ...scope, date_to: "2026-12-31" });
    expect(got.rows).toHaveLength(rows.length);
    expect(got.rows.every((r) => r.miles > 1)).toBe(true);
    await cache.markPairsFetched("u", [
      coverage({ date_to: "2026-12-31", cabins: ["Y", "W", "J", "F"] }),
      coverage({ origin: "PVG", date_to: "2026-12-31", cabins: ["Y", "W", "J", "F"] }),
    ]);
    const cov = await cache.getCoverage("u", [{ origin: "HKG", dest: "SEA" }, { origin: "PVG", dest: "SEA" }]);
    expect(cov).toHaveLength(2);
    expect(cov[0]).toEqual(coverage({ date_to: "2026-12-31", cabins: ["Y", "W", "J", "F"] }));
  });
});

describe("coverage round-trip", () => {
  const now = new Date("2026-10-01T12:40:00Z");

  it("reconstructs the record that was marked (dates, cabins, programs, flags, fetched_at)", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(USERS));
    const recs: CoverageRecord[] = [
      coverage(),
      coverage({ origin: "PVG", programs: ["united", "alaska"], direct_only: true, cabins: ["J"] }),
      coverage({ dest: "SFO", include_filtered: true, fetched_at: "2026-10-01T12:05:00.000Z" }),
    ];
    await cache.markPairsFetched("u", recs);
    const pairs = [
      { origin: "HKG", dest: "SEA" },
      { origin: "PVG", dest: "SEA" },
      { origin: "HKG", dest: "SFO" },
    ];
    const got = await cache.getCoverage("u", pairs);
    expect(got).toHaveLength(3);
    expect(got.find((c) => c.origin === "HKG" && c.dest === "SEA")).toEqual(coverage());
    expect(got.find((c) => c.origin === "PVG")).toEqual(
      coverage({ origin: "PVG", programs: ["alaska", "united"], direct_only: true, cabins: ["J"] }),
    );
    expect(got.find((c) => c.dest === "SFO")).toEqual(
      coverage({ dest: "SFO", include_filtered: true, fetched_at: "2026-10-01T12:05:00.000Z" }),
    );
    // only the pairs asked for come back; (PVG, SFO) was never marked
    expect(await cache.getCoverage("u", [{ origin: "PVG", dest: "SFO" }])).toEqual([]);
    expect(await cache.getCoverage("u", [])).toEqual([]);

    // The reconstructed records drive the real freshness logic exactly like in-memory ones.
    expect(uncoveredPairs(scope, got, 45, now)).toEqual([{ origin: "PVG", dest: "SEA" }]); // PVG is direct-only & J-only
    expect(uncoveredPairs({ ...scope, direct_only: true, cabins: ["J"], programs: ["united"] }, got, 45, now)).toEqual([]);
    expect(uncoveredPairs(scope, got, 30, now)).toEqual([
      { origin: "HKG", dest: "SEA" },
      { origin: "PVG", dest: "SEA" },
    ]);
  });

  it("a newer fetch refreshes overlapping cells (newest fetched_at wins) and older records shrink, never grow", async () => {
    const cache = createSqliteAvailabilityCache(testDbWithUsers(USERS));
    await cache.markPairsFetched("u", [coverage({ fetched_at: "2026-10-01T12:00:00.000Z" })]);
    await cache.markPairsFetched("u", [
      coverage({ date_from: "2026-10-15", date_to: "2026-11-15", cabins: ["J"], fetched_at: "2026-10-01T13:00:00.000Z" }),
    ]);
    const got = await cache.getCoverage("u", [{ origin: "HKG", dest: "SEA" }]);
    // The older fetch now only owns F for the whole month and J up to 10-14 (its J cells from
    // 10-15 were re-stamped by the newer fetch), so it folds into two exact records.
    expect(got).toHaveLength(3);
    const olderF = got.find((c) => c.fetched_at === "2026-10-01T12:00:00.000Z" && c.cabins.join() === "F")!;
    const olderJ = got.find((c) => c.fetched_at === "2026-10-01T12:00:00.000Z" && c.cabins.join() === "J")!;
    const newer = got.find((c) => c.fetched_at === "2026-10-01T13:00:00.000Z")!;
    expect(olderF).toEqual(coverage({ cabins: ["F"], fetched_at: "2026-10-01T12:00:00.000Z" }));
    expect(olderJ).toEqual(coverage({ date_to: "2026-10-14", cabins: ["J"], fetched_at: "2026-10-01T12:00:00.000Z" }));
    expect(newer).toEqual(coverage({ date_from: "2026-10-15", date_to: "2026-11-15", cabins: ["J"], fetched_at: "2026-10-01T13:00:00.000Z" }));
    // an OLDER re-mark of the same cells does not roll fetched_at backwards
    await cache.markPairsFetched("u", [
      coverage({ date_from: "2026-10-15", date_to: "2026-11-15", cabins: ["J"], fetched_at: "2026-10-01T11:00:00.000Z" }),
    ]);
    const again = await cache.getCoverage("u", [{ origin: "HKG", dest: "SEA" }]);
    expect([...new Set(again.map((c) => c.fetched_at))].sort()).toEqual(["2026-10-01T12:00:00.000Z", "2026-10-01T13:00:00.000Z"]);
    const late = new Date("2026-10-01T13:30:00Z");
    expect(coverageSatisfies(newer, { ...scope, origins: ["HKG"], date_from: "2026-10-20", date_to: "2026-11-10", cabins: ["J"] }, 45, late)).toBe(true);
    expect(coverageSatisfies(olderF, { ...scope, origins: ["HKG"] }, 45, late)).toBe(false);
    expect(coverageSatisfies(olderJ, { ...scope, origins: ["HKG"] }, 45, late)).toBe(false);
  });

  it("two disjoint rectangles sharing a fetched_at never merge into a bounding box (parity with the in-memory store)", async () => {
    const sqlite = createSqliteAvailabilityCache(testDbWithUsers(USERS));
    const memory = new InMemoryAvailabilityCache();
    const at = "2026-10-01T12:00:00.000Z";
    const recs = [
      coverage({ date_from: "2026-10-01", date_to: "2026-10-10", cabins: ["J"], fetched_at: at }),
      coverage({ date_from: "2026-11-01", date_to: "2026-11-10", cabins: ["J"], fetched_at: at }),
      // adjacent in time but a different cabin: must not become one J+F rectangle
      coverage({ date_from: "2026-10-11", date_to: "2026-10-20", cabins: ["F"], fetched_at: at }),
    ];
    await sqlite.markPairsFetched("u", recs);
    await memory.markPairsFetched("u", recs);
    const now = new Date("2026-10-01T12:10:00Z");
    const pairs = [{ origin: "HKG", dest: "SEA" }];
    const probes = [
      { ...scope, origins: ["HKG"], date_from: "2026-10-15", date_to: "2026-10-20", cabins: ["J"] as Cabin[] }, // the gap
      { ...scope, origins: ["HKG"], date_from: "2026-10-01", date_to: "2026-10-20", cabins: ["J", "F"] as Cabin[] }, // J+F across both
      { ...scope, origins: ["HKG"], date_from: "2026-10-12", date_to: "2026-10-18", cabins: ["F"] as Cabin[] }, // inside the F run
      { ...scope, origins: ["HKG"], date_from: "2026-11-02", date_to: "2026-11-09", cabins: ["J"] as Cabin[] }, // inside the second J run
    ];
    const sq = await sqlite.getCoverage("u", pairs);
    const mem = await memory.getCoverage("u", pairs);
    for (const q of probes) {
      expect(uncoveredPairs(q, sq, 45, now), JSON.stringify(q)).toEqual(uncoveredPairs(q, mem, 45, now));
    }
    expect(uncoveredPairs(probes[0]!, sq, 45, now)).toEqual([{ origin: "HKG", dest: "SEA" }]);
    expect(uncoveredPairs(probes[1]!, sq, 45, now)).toEqual([{ origin: "HKG", dest: "SEA" }]);
    expect(uncoveredPairs(probes[2]!, sq, 45, now)).toEqual([]);
    expect(uncoveredPairs(probes[3]!, sq, 45, now)).toEqual([]);
  });

  it("prune sweeps rows and coverage older than the cut-off, for one user or all", async () => {
    const db = testDbWithUsers(USERS);
    const cache = createSqliteAvailabilityCache(db);
    await cache.putRows("alice", [row({ fetched_at: "2026-10-01T10:00:00.000Z" }), row({ cabin: "F", fetched_at: "2026-10-01T12:00:00.000Z" })]);
    await cache.markPairsFetched("alice", [
      coverage({ date_to: "2026-10-02", cabins: ["J"], fetched_at: "2026-10-01T10:00:00.000Z" }),
      coverage({ date_from: "2026-10-03", date_to: "2026-10-03", cabins: ["F"], fetched_at: "2026-10-01T12:00:00.000Z" }),
    ]);
    await cache.putRows("bob", [row({ fetched_at: "2026-10-01T10:00:00.000Z" })]);
    expect(await cache.prune("alice", "2026-10-01T11:00:00.000Z")).toEqual({ rows: 1, coverage: 2 });
    expect((await cache.getRows("alice", scope)).rows.map((r) => r.cabin)).toEqual(["F"]);
    expect(await cache.getCoverage("alice", [{ origin: "HKG", dest: "SEA" }])).toEqual([
      coverage({ date_from: "2026-10-03", date_to: "2026-10-03", cabins: ["F"], fetched_at: "2026-10-01T12:00:00.000Z" }),
    ]);
    expect((await cache.getRows("bob", scope)).rows).toHaveLength(1);
    expect(await cache.prune(null, "2026-10-01T11:00:00.000Z")).toEqual({ rows: 1, coverage: 0 });
    expect((await cache.getRows("bob", scope)).rows).toHaveLength(0);
    expect(db.select().from(cacheCoverage).all()).toHaveLength(1);
    await expect(cache.prune(null, "not a date")).rejects.toBeInstanceOf(RangeError);
  });
});
