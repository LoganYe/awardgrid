/**
 * Snapshot/restore for InMemoryAvailabilityCache (docs/PIVOT.md §6 Phase 2).
 *
 * A NEW file, deliberately. The 25 test files that moved in Phase 1 are untouchable — the kickoff
 * rejects on sight any PR that edits one — so a capability added after the move gets its own file
 * rather than a line appended to `cache.test.ts`.
 *
 * What these assert is the thing that would otherwise go wrong silently: that a round trip through
 * JSON preserves SCOPE. Two rows for the same program/pair/date/cabin at different
 * include_filtered / min_cabin_pct are different rows, not duplicates, and a snapshot that
 * collapsed them would serve a mixed-cabin row to a query that must not see it.
 */
import { describe, expect, it } from "vitest";
import {
  CACHE_SNAPSHOT_VERSION,
  type CacheQuery,
  InMemoryAvailabilityCache,
} from "@/lib/seatsaero/cache";
import type { AvailabilityRow } from "@/lib/grid/types";

const U = "local";

function row(over: Partial<AvailabilityRow> = {}): AvailabilityRow {
  return {
    program: "alaska",
    origin: "HKG",
    dest: "SEA",
    date: "2026-10-01",
    cabin: "J",
    miles: 80_000,
    fees_cents: 5_600,
    currency: "USD",
    seats_left: 2,
    direct: true,
    airlines: ["AS"],
    source_id: "abc123",
    fetched_at: "2026-09-10T00:00:00.000Z",
    booking_url: null,
    ...over,
  } as AvailabilityRow;
}

const query: CacheQuery = {
  origins: ["HKG"],
  dests: ["SEA"],
  date_from: "2026-10-01",
  date_to: "2026-10-01",
  cabins: ["J"],
};

/** JSON round trip, because that is what the shell actually does with a snapshot. */
const roundTrip = (c: InMemoryAvailabilityCache) => JSON.parse(JSON.stringify(c.snapshot()));

describe("InMemoryAvailabilityCache snapshot/restore", () => {
  it("restores rows through a JSON round trip", async () => {
    const a = new InMemoryAvailabilityCache();
    await a.putRows(U, [row(), row({ date: "2026-10-02", source_id: "def456" })]);

    const b = new InMemoryAvailabilityCache();
    expect(b.restore(roundTrip(a))).toBe(2);

    const got = await b.getRows(U, { ...query, date_to: "2026-10-02" });
    expect(got.rows).toHaveLength(2);
    expect(got.rows.map((r) => r.source_id).sort()).toEqual(["abc123", "def456"]);
    expect(got.fetched_at_min).toBe("2026-09-10T00:00:00.000Z");
  });

  it("keeps include_filtered and min_cabin_pct rows as SEPARATE rows, not duplicates", async () => {
    const a = new InMemoryAvailabilityCache();
    // Same program/pair/date/cabin, three different scopes. rowKey must keep them apart.
    await a.putRows(U, [
      row({ miles: 80_000 }),
      row({ miles: 70_000, include_filtered: true }),
      row({ miles: 60_000, min_cabin_pct: 70 }),
    ]);

    const b = new InMemoryAvailabilityCache();
    expect(b.restore(roundTrip(a))).toBe(3);

    // The default scope must see ONLY its own row — not the filtered or mixed-cabin ones.
    const plain = await b.getRows(U, query);
    expect(plain.rows).toHaveLength(1);
    expect(plain.rows[0]!.miles).toBe(80_000);

    const filtered = await b.getRows(U, { ...query, include_filtered: true });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0]!.miles).toBe(70_000);

    const mixed = await b.getRows(U, { ...query, min_cabin_pct: 70 });
    expect(mixed.rows).toHaveLength(1);
    expect(mixed.rows[0]!.miles).toBe(60_000);
  });

  it("restores coverage records so a warm start does not refetch", async () => {
    const a = new InMemoryAvailabilityCache();
    await a.markPairsFetched(U, [
      {
        origin: "HKG",
        dest: "SEA",
        date_from: "2026-10-01",
        date_to: "2026-10-01",
        cabins: ["J"],
        programs: null,
        direct_only: false,
        fetched_at: "2026-09-10T00:00:00.000Z",
      },
    ]);

    const b = new InMemoryAvailabilityCache();
    b.restore(roundTrip(a));
    const cov = await b.getCoverage(U, [{ origin: "HKG", dest: "SEA" }]);
    expect(cov).toHaveLength(1);
    expect(cov[0]!.programs).toBeNull();
    expect(cov[0]!.cabins).toEqual(["J"]);
  });

  it("discards a snapshot from a different version rather than misreading it", async () => {
    const a = new InMemoryAvailabilityCache();
    await a.putRows(U, [row()]);
    const stale = { ...a.snapshot(), version: CACHE_SNAPSHOT_VERSION + 1 };

    const b = new InMemoryAvailabilityCache();
    expect(b.restore(stale)).toBe(0);
    expect((await b.getRows(U, query)).rows).toEqual([]);
  });

  it("survives null, undefined and structurally broken input", async () => {
    const c = new InMemoryAvailabilityCache();
    expect(c.restore(null)).toBe(0);
    expect(c.restore(undefined)).toBe(0);
    expect(c.restore({ version: CACHE_SNAPSHOT_VERSION, users: undefined as never })).toBe(0);
    expect((await c.getRows(U, query)).rows).toEqual([]);
  });

  it("restore REPLACES rather than merges, so a stale row cannot outlive its snapshot", async () => {
    const a = new InMemoryAvailabilityCache();
    await a.putRows(U, [row({ source_id: "old" })]);
    const b = new InMemoryAvailabilityCache();
    await b.putRows(U, [row({ date: "2026-12-25", source_id: "other" })]);

    b.restore(roundTrip(a));
    const all = await b.getRows(U, { ...query, date_to: "2026-12-31" });
    expect(all.rows.map((r) => r.source_id)).toEqual(["old"]);
  });

  it("a restored cache is independent of the snapshot object it came from", async () => {
    const a = new InMemoryAvailabilityCache();
    await a.putRows(U, [row()]);
    const snap = a.snapshot();

    const b = new InMemoryAvailabilityCache();
    b.restore(snap);
    // Mutating the snapshot's arrays must not reach into the restored cache.
    snap.users[0]!.rows[0]!.airlines.push("XX");

    const got = await b.getRows(U, query);
    expect(got.rows[0]!.airlines).toEqual(["AS"]);
  });
});
