import { describe, expect, it } from "vitest";
import { apiUsage } from "@/lib/db/schema";
import { SEATS_AERO_PROVIDER, createSqliteQuotaStore } from "@/lib/db/stores/quota";
import { testDbWithUsers } from "@/lib/db/stores/testing";
import { Quota, QuotaExceededError } from "@/lib/seatsaero/quota";

const USERS = ["alice", "bob", "carol", "u"];

describe("createSqliteQuotaStore", () => {
  it("get returns 0 for unknown (user, day) and increment upserts atomically with RETURNING", async () => {
    const store = createSqliteQuotaStore(testDbWithUsers(USERS));
    expect(await store.get("alice", "2026-10-01")).toBe(0);
    expect(await store.increment("alice", "2026-10-01", 3)).toBe(3);
    expect(await store.increment("alice", "2026-10-01", 4)).toBe(7);
    expect(await store.get("alice", "2026-10-01")).toBe(7);
    // negative = refund
    expect(await store.increment("alice", "2026-10-01", -2)).toBe(5);
    expect(await store.get("alice", "2026-10-01")).toBe(5);
    // other days are separate counters
    expect(await store.get("alice", "2026-10-02")).toBe(0);
    expect(await store.increment("alice", "2026-10-02", 1)).toBe(1);
    expect(await store.get("alice", "2026-10-01")).toBe(5);
  });

  it("two users' quotas count independently (kickoff §9 Phase 2 self-acceptance)", async () => {
    const store = createSqliteQuotaStore(testDbWithUsers(USERS));
    await store.increment("alice", "2026-10-01", 10);
    await store.increment("bob", "2026-10-01", 1);
    expect(await store.get("alice", "2026-10-01")).toBe(10);
    expect(await store.get("bob", "2026-10-01")).toBe(1);
    await store.increment("alice", "2026-10-01", 5);
    expect(await store.get("bob", "2026-10-01")).toBe(1);
    expect(await store.get("carol", "2026-10-01")).toBe(0);
  });

  it("persists across store instances on the same database and separates providers", async () => {
    const db = testDbWithUsers(USERS);
    await createSqliteQuotaStore(db).increment("alice", "2026-10-01", 9);
    expect(await createSqliteQuotaStore(db).get("alice", "2026-10-01")).toBe(9);
    const duffel = createSqliteQuotaStore(db, { provider: "duffel" });
    expect(duffel.provider).toBe("duffel");
    expect(await duffel.get("alice", "2026-10-01")).toBe(0);
    await duffel.increment("alice", "2026-10-01", 2);
    expect(await createSqliteQuotaStore(db).get("alice", "2026-10-01")).toBe(9);
    const rows = db.select().from(apiUsage).all();
    expect(rows.map((r) => r.provider).sort()).toEqual(["duffel", SEATS_AERO_PROVIDER]);
  });

  it("rejects malformed days, empty user ids and non-integer counts before touching the table", async () => {
    const store = createSqliteQuotaStore(testDbWithUsers(USERS));
    await expect(store.get("alice", "2026/10/01")).rejects.toBeInstanceOf(RangeError);
    await expect(store.increment("alice", "today", 1)).rejects.toBeInstanceOf(RangeError);
    await expect(store.increment("", "2026-10-01", 1)).rejects.toBeInstanceOf(RangeError);
    await expect(store.increment("alice", "2026-10-01", 1.5)).rejects.toBeInstanceOf(RangeError);
    // an unknown user violates the FK — surfaced as an error, never silently counted elsewhere
    await expect(store.increment("nobody", "2026-10-01", 1)).rejects.toThrow();
    expect(await store.get("alice", "2026-10-01")).toBe(0);
  });

  it("prune removes only days before the cut-off, optionally for one user", async () => {
    const store = createSqliteQuotaStore(testDbWithUsers(USERS));
    await store.increment("alice", "2026-09-01", 1);
    await store.increment("alice", "2026-10-01", 1);
    await store.increment("bob", "2026-09-01", 1);
    expect(await store.prune("alice", "2026-10-01")).toBe(1);
    expect(await store.get("alice", "2026-09-01")).toBe(0);
    expect(await store.get("alice", "2026-10-01")).toBe(1);
    expect(await store.get("bob", "2026-09-01")).toBe(1);
    expect(await store.prune(undefined, "2026-10-01")).toBe(1);
    expect(await store.get("bob", "2026-09-01")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The in-memory Quota behaviour tests, replayed against the SQLite store.
// ---------------------------------------------------------------------------
describe("Quota over the SQLite store", () => {
  it("counts per user per UTC day with a 950 soft limit and exposes the reset time", async () => {
    const store = createSqliteQuotaStore(testDbWithUsers(USERS));
    let clock = new Date("2026-10-01T22:30:00Z");
    const quota = new Quota({ store, now: () => clock });
    expect(quota.softLimit).toBe(950);
    expect(quota.today()).toBe("2026-10-01");
    expect(quota.resetAt().toISOString()).toBe("2026-10-02T00:00:00.000Z");

    await quota.increment("alice", 3);
    expect(await quota.used("alice")).toBe(3);
    expect(await quota.remaining("alice")).toBe(947);
    expect(await quota.used("bob")).toBe(0);
    expect(await quota.remaining("bob")).toBe(950);

    clock = new Date("2026-10-02T00:00:01Z");
    expect(await quota.used("alice")).toBe(0);
    expect(quota.today()).toBe("2026-10-02");
  });

  it("throws QuotaExceededError with remaining calls and reset time when the store reports 950 used", async () => {
    const store = createSqliteQuotaStore(testDbWithUsers(USERS));
    await store.increment("alice", "2026-10-01", 950);
    const quota = new Quota({ store, now: () => new Date("2026-10-01T10:00:00Z") });
    const err = await quota.assertCanCall("alice", 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect((err as QuotaExceededError).remaining).toBe(0);
    expect((err as Error).message).toContain("0 calls left");
    expect((err as Error).message).toContain("2026-10-02T00:00:00.000Z");
    await expect(quota.assertCanCall("bob", 900)).resolves.toBeUndefined();
    await store.increment("carol", "2026-10-01", 940);
    await expect(quota.assertCanCall("carol", 10)).resolves.toBeUndefined();
    await expect(quota.assertCanCall("carol", 11)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("reserve is atomic against the soft limit and release refunds the unused part", async () => {
    const store = createSqliteQuotaStore(testDbWithUsers(USERS));
    const quota = new Quota({ store, now: () => new Date("2026-10-01T12:00:00Z") });
    await store.increment("u", "2026-10-01", 940);
    expect(await quota.reserve("u", 6)).toBe(6);
    expect(await quota.used("u")).toBe(946);
    expect(await quota.reserve("u", 6)).toBe(4);
    expect(await quota.used("u")).toBe(950);
    const err = await quota.reserve("u", 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect((err as QuotaExceededError).remaining).toBe(0);
    expect(await quota.used("u")).toBe(950);
    await quota.release("u", 3);
    expect(await quota.used("u")).toBe(947);
    await quota.release("u", 0);
    expect(await quota.reserve("u", 0)).toBe(0);
    expect(await quota.used("u")).toBe(947);
  });

  it("concurrent reservations for one user never jointly pass the soft limit", async () => {
    const store = createSqliteQuotaStore(testDbWithUsers(USERS));
    const quota = new Quota({ store, now: () => new Date("2026-10-01T12:00:00Z") });
    await store.increment("u", "2026-10-01", 930);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => quota.reserve("u", 10)));
    const granted = results.reduce((s, r) => s + (r.status === "fulfilled" ? r.value : 0), 0);
    expect(granted).toBe(20);
    expect(await quota.used("u")).toBe(950);
  });

  it("release on a fresh day is clamped at zero instead of leaving a negative api_usage row", async () => {
    const db = testDbWithUsers(USERS);
    const store = createSqliteQuotaStore(db);
    const quota = new Quota({ store, now: () => new Date("2026-10-02T00:00:05Z") });
    await quota.release("u", 3);
    expect(await store.get("u", "2026-10-02")).toBe(0);
    expect(await quota.remaining("u")).toBe(950);
    expect(db.select().from(apiUsage).all().every((r) => r.calls >= 0)).toBe(true);
    // Pinned to the day the reservation was made, the refund lands on that day.
    await store.increment("u", "2026-10-01", 40);
    await quota.release("u", 37, "2026-10-01");
    expect(await store.get("u", "2026-10-01")).toBe(3);
  });
});
