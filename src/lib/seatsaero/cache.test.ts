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
    expect(uncoveredPairs(scope, [rec], 45, now)).toEqual([{ origin: "PVG", dest: "SEA" }]);
    expect(uncoveredPairs(scope, [rec, { ...rec, origin: "PVG" }], 45, now)).toEqual([]);
  });

  it("reads CACHE_TTL_MINUTES with a 45-minute default", () => {
    expect(cacheTtlMinutesFromEnv({})).toBe(45);
    expect(cacheTtlMinutesFromEnv({ CACHE_TTL_MINUTES: "90" })).toBe(90);
    expect(cacheTtlMinutesFromEnv({ CACHE_TTL_MINUTES: "-1" })).toBe(45);
  });
});
