import { describe, expect, it } from "vitest";
import type { AvailabilityRow } from "@/lib/grid/types";
import {
  InMemoryAvailabilityCache,
  cacheTtlMinutesFromEnv,
  coverageSatisfies,
  isFresh,
  uncoveredPairs,
  type CoverageRecord,
} from "@/lib/seatsaero/cache";

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

const scope = { origins: ["HKG", "PVG"], dests: ["SEA"], date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J", "F"] as const };

describe("InMemoryAvailabilityCache", () => {
  it("isolates users: A's rows and coverage are invisible to B", async () => {
    const cache = new InMemoryAvailabilityCache();
    await cache.putRows("alice", [row()]);
    await cache.markPairsFetched("alice", [
      { origin: "HKG", dest: "SEA", date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J", "F"], programs: null, direct_only: false, fetched_at: "2026-10-01T12:00:00Z" },
    ]);
    expect((await cache.getRows("alice", scope)).rows).toHaveLength(1);
    expect((await cache.getRows("bob", scope)).rows).toHaveLength(0);
    expect((await cache.getRows("bob", scope)).fetched_at_min).toBeNull();
    expect(await cache.getCoverage("alice", [{ origin: "HKG", dest: "SEA" }])).toHaveLength(1);
    expect(await cache.getCoverage("bob", [{ origin: "HKG", dest: "SEA" }])).toHaveLength(0);
    // deleting bob's scope must not touch alice
    await cache.deleteRows("bob", scope);
    expect((await cache.getRows("alice", scope)).rows).toHaveLength(1);
  });

  it("keeps include_filtered rows in their own scope with their own PK", async () => {
    const cache = new InMemoryAvailabilityCache();
    await cache.putRows("u", [row({ miles: 70000 }), row({ miles: 90000, include_filtered: true })]);
    expect((await cache.getRows("u", scope)).rows.map((r) => r.miles)).toEqual([70000]);
    expect((await cache.getRows("u", { ...scope, include_filtered: true })).rows.map((r) => r.miles)).toEqual([90000]);
    await cache.deleteRows("u", { ...scope, include_filtered: true });
    expect((await cache.getRows("u", scope)).rows).toHaveLength(1);
    expect((await cache.getRows("u", { ...scope, include_filtered: true })).rows).toHaveLength(0);
  });

  it("keeps min_cabin_pct rows in their own scope, with absent reading as 100 (issue #18)", async () => {
    const cache = new InMemoryAvailabilityCache();
    // A row written before #18 existed carries no min_cabin_pct at all; it IS a 100 row.
    await cache.putRows("u", [row({ miles: 70000 }), row({ miles: 90000, min_cabin_pct: 70 })]);
    expect((await cache.getRows("u", scope)).rows.map((r) => r.miles)).toEqual([70000]);
    expect((await cache.getRows("u", { ...scope, min_cabin_pct: 100 })).rows.map((r) => r.miles)).toEqual([70000]);
    // A 70 % search must NOT be handed the 100 % row: seats.aero returned a different answer.
    expect((await cache.getRows("u", { ...scope, min_cabin_pct: 70 })).rows.map((r) => r.miles)).toEqual([90000]);
    // ...and must not poison it either.
    await cache.deleteRows("u", { ...scope, min_cabin_pct: 70 });
    expect((await cache.getRows("u", scope)).rows).toHaveLength(1);
    expect((await cache.getRows("u", { ...scope, min_cabin_pct: 70 })).rows).toHaveLength(0);
  });

  it("getRowsBySourceId returns one row per cabin, inside one scope, for one user (#52)", async () => {
    const cache = new InMemoryAvailabilityCache();
    await cache.putRows("u", [
      row({ cabin: "J" }),
      row({ cabin: "F", miles: 90000 }),
      row({ cabin: "J", miles: 71000, include_filtered: true }),
      row({ cabin: "J", miles: 72000, min_cabin_pct: 70 }),
      row({ source_id: "id2", date: "2026-10-06" }),
    ]);
    await cache.putRows("bob", [row()]);

    const plain = await cache.getRowsBySourceId("u", "id1", {});
    expect(plain.map((r) => [r.cabin, r.miles]).sort()).toEqual([
      ["F", 90000],
      ["J", 70000],
    ]);
    // Each scope sees only its own row — the flags are identity here, never a superset.
    expect((await cache.getRowsBySourceId("u", "id1", { include_filtered: true })).map((r) => r.miles)).toEqual([71000]);
    expect((await cache.getRowsBySourceId("u", "id1", { min_cabin_pct: 70 })).map((r) => r.miles)).toEqual([72000]);
    expect((await cache.getRowsBySourceId("u", "id1", { min_cabin_pct: 100 })).map((r) => r.miles).sort()).toEqual([70000, 90000]);
    expect(await cache.getRowsBySourceId("u", "nope", {})).toEqual([]);
    expect(await cache.getRowsBySourceId("carol", "id1", {})).toEqual([]);
  });

  it("updateRowFees mutates only the fee columns of an existing row (#52)", async () => {
    const cache = new InMemoryAvailabilityCache();
    const j = row({ cabin: "J" });
    await cache.putRows("u", [j, row({ cabin: "J", miles: 71000, include_filtered: true })]);
    const fees = { fees_cents: 3400, currency: null, booking_url: "https://example.test/book" };

    expect(await cache.updateRowFees("u", j, fees)).toBe(true);
    const hit = (await cache.getRowsBySourceId("u", "id1", {}))[0]!;
    expect([hit.fees_cents, hit.currency, hit.booking_url]).toEqual([3400, null, "https://example.test/book"]);
    expect([hit.miles, hit.seats_left, hit.computed_last_seen, hit.fetched_at]).toEqual([j.miles, j.seats_left, j.computed_last_seen, j.fetched_at]);
    expect((await cache.getRowsBySourceId("u", "id1", { include_filtered: true }))[0]!.fees_cents).toBeNull();

    // No match, no insert: the same guard that keeps a concurrently deleted row deleted.
    for (const miss of [{ ...j, date: "2026-11-30" }, { ...j, source_id: "id-other" }, { ...j, min_cabin_pct: 70 }]) {
      expect(await cache.updateRowFees("u", miss, fees)).toBe(false);
    }
    expect(await cache.updateRowFees("nobody", j, fees)).toBe(false);
    expect((await cache.getRowsBySourceId("u", "id1", {})).length).toBe(1);
  });

  it("upserts by PK, filters by scope, and reports the oldest fetched_at", async () => {
    const cache = new InMemoryAvailabilityCache();
    await cache.putRows("u", [row({ miles: 70000 }), row({ miles: 65000 })]); // same PK → one row
    await cache.putRows("u", [row({ cabin: "F", miles: 90000, fetched_at: "2026-10-01T11:00:00.000Z" })]);
    await cache.putRows("u", [row({ origin: "NRT" }), row({ date: "2026-11-15" }), row({ program: "delta" }), row({ direct: false, cabin: "Y" })]);
    const got = await cache.getRows("u", scope);
    expect(got.rows).toHaveLength(3); // HKG J (65000), HKG F, delta J
    expect(got.rows.find((r) => r.cabin === "J" && r.program === "american")!.miles).toBe(65000);
    expect(got.fetched_at_min).toBe("2026-10-01T11:00:00.000Z");
    expect((await cache.getRows("u", { ...scope, programs: ["delta"] })).rows).toHaveLength(1);
    await cache.deleteRows("u", { ...scope, programs: ["american"] });
    expect((await cache.getRows("u", scope)).rows.map((r) => r.program)).toEqual(["delta"]);
  });
});

describe("freshness and coverage", () => {
  const now = new Date("2026-10-01T12:40:00Z");

  it("isFresh honours the TTL and is false for an empty list", () => {
    expect(isFresh([row()], 45, now)).toBe(true);
    expect(isFresh([row()], 30, now)).toBe(false);
    expect(isFresh([row(), row({ fetched_at: "2026-10-01T11:00:00Z" })], 45, now)).toBe(false);
    expect(isFresh([], 45, now)).toBe(false);
  });

  it("coverage must be fresh and a superset on dates, cabins, programs and direct_only", () => {
    const rec: CoverageRecord = {
      origin: "HKG", dest: "SEA", date_from: "2026-10-01", date_to: "2026-10-30",
      cabins: ["J", "F"], programs: null, direct_only: false, fetched_at: "2026-10-01T12:00:00Z",
    };
    const q = { ...scope, origins: ["HKG"] };
    expect(coverageSatisfies(rec, q, 45, now)).toBe(true);
    expect(coverageSatisfies(rec, q, 30, now)).toBe(false);
    expect(coverageSatisfies(rec, { ...q, date_to: "2026-11-01" }, 45, now)).toBe(false);
    expect(coverageSatisfies(rec, { ...q, cabins: ["Y"] }, 45, now)).toBe(false);
    expect(coverageSatisfies(rec, { ...q, programs: ["alaska"] }, 45, now)).toBe(true); // null = all
    expect(coverageSatisfies({ ...rec, programs: ["alaska"] }, q, 45, now)).toBe(false);
    expect(coverageSatisfies({ ...rec, programs: ["alaska", "united"] }, { ...q, programs: ["united"] }, 45, now)).toBe(true);
    expect(coverageSatisfies({ ...rec, direct_only: true }, q, 45, now)).toBe(false);
    expect(coverageSatisfies({ ...rec, direct_only: true }, { ...q, direct_only: true }, 45, now)).toBe(true);
    // include_filtered is a separate scope in BOTH directions (nothing can be filtered locally).
    expect(coverageSatisfies({ ...rec, include_filtered: true }, q, 45, now)).toBe(false);
    expect(coverageSatisfies(rec, { ...q, include_filtered: true }, 45, now)).toBe(false);
    expect(coverageSatisfies({ ...rec, include_filtered: true }, { ...q, include_filtered: true }, 45, now)).toBe(true);
    // min_cabin_pct, like include_filtered, is an exact-match scope in BOTH directions: at 100
    // seats.aero drops every mixed-cabin itinerary, so a 100 record is not a superset of a 70
    // one and a 70 record is not a superset of a 100 one either (it holds extra itineraries).
    expect(coverageSatisfies({ ...rec, min_cabin_pct: 70 }, q, 45, now)).toBe(false);
    expect(coverageSatisfies(rec, { ...q, min_cabin_pct: 70 }, 45, now)).toBe(false);
    expect(coverageSatisfies({ ...rec, min_cabin_pct: 70 }, { ...q, min_cabin_pct: 70 }, 45, now)).toBe(true);
    // Absent and explicit 100 are the SAME scope — every record written before #18 keeps working.
    expect(coverageSatisfies(rec, { ...q, min_cabin_pct: 100 }, 45, now)).toBe(true);
    expect(coverageSatisfies({ ...rec, min_cabin_pct: 100 }, q, 45, now)).toBe(true);
    expect(uncoveredPairs({ ...scope, min_cabin_pct: 70 }, [rec, { ...rec, origin: "PVG" }], 45, now)).toEqual([
      { origin: "HKG", dest: "SEA" },
      { origin: "PVG", dest: "SEA" },
    ]);
    expect(uncoveredPairs(scope, [rec], 45, now)).toEqual([{ origin: "PVG", dest: "SEA" }]);
    expect(uncoveredPairs(scope, [rec, { ...rec, origin: "PVG" }], 45, now)).toEqual([]);
  });

  it("reads CACHE_TTL_MINUTES with a 45-minute default", () => {
    expect(cacheTtlMinutesFromEnv({})).toBe(45);
    expect(cacheTtlMinutesFromEnv({ CACHE_TTL_MINUTES: "90" })).toBe(90);
    expect(cacheTtlMinutesFromEnv({ CACHE_TTL_MINUTES: "-1" })).toBe(45);
  });
});
