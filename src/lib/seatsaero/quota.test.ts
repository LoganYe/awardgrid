import { describe, expect, it } from "vitest";
import {
  InMemoryQuotaStore,
  Quota,
  QuotaExceededError,
  estimateCalls,
  nextUtcMidnight,
  pagesFor,
  softLimitFromEnv,
  utcDayKey,
} from "@/lib/seatsaero/quota";

describe("Quota", () => {
  it("counts per user per UTC day with a 950 soft limit and exposes the reset time", async () => {
    const store = new InMemoryQuotaStore();
    let clock = new Date("2026-10-01T22:30:00Z");
    const quota = new Quota({ store, now: () => clock });
    expect(quota.softLimit).toBe(950);
    expect(quota.dailyLimit).toBe(1000);
    expect(quota.today()).toBe("2026-10-01");
    expect(quota.resetAt().toISOString()).toBe("2026-10-02T00:00:00.000Z");

    await quota.increment("alice", 3);
    expect(await quota.used("alice")).toBe(3);
    expect(await quota.remaining("alice")).toBe(947);
    // per-user separation
    expect(await quota.used("bob")).toBe(0);
    expect(await quota.remaining("bob")).toBe(950);

    // day rollover via the injected clock
    clock = new Date("2026-10-02T00:00:01Z");
    expect(await quota.used("alice")).toBe(0);
    expect(quota.today()).toBe("2026-10-02");
  });

  it("throws QuotaExceededError with remaining calls and reset time when the store reports 950 used", async () => {
    const store = new InMemoryQuotaStore();
    await store.increment("alice", "2026-10-01", 950);
    const quota = new Quota({ store, now: () => new Date("2026-10-01T10:00:00Z") });
    const err = await quota.assertCanCall("alice", 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect((err as QuotaExceededError).remaining).toBe(0);
    expect((err as Error).message).toContain("0 calls left");
    expect((err as Error).message).toContain("2026-10-02T00:00:00.000Z");
    // still fine for another user
    await expect(quota.assertCanCall("bob", 900)).resolves.toBeUndefined();
    // 940 used: 10 ok, 11 not
    await store.increment("carol", "2026-10-01", 940);
    await expect(quota.assertCanCall("carol", 10)).resolves.toBeUndefined();
    await expect(quota.assertCanCall("carol", 11)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("reserve is atomic against the soft limit and release refunds the unused part", async () => {
    const store = new InMemoryQuotaStore();
    const quota = new Quota({ store, now: () => new Date("2026-10-01T12:00:00Z") });
    await store.increment("u", "2026-10-01", 940);
    // Full grant, then partial grant (only 4 of 6 fit), then nothing left.
    expect(await quota.reserve("u", 6)).toBe(6);
    expect(await quota.used("u")).toBe(946);
    expect(await quota.reserve("u", 6)).toBe(4);
    expect(await quota.used("u")).toBe(950);
    const err = await quota.reserve("u", 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect((err as QuotaExceededError).remaining).toBe(0);
    expect(await quota.used("u")).toBe(950); // a refused reservation leaves no trace
    await quota.release("u", 3);
    expect(await quota.used("u")).toBe(947);
    await quota.release("u", 0);
    expect(await quota.reserve("u", 0)).toBe(0);
    expect(await quota.used("u")).toBe(947);
  });

  it("a reservation that straddles UTC midnight settles on the day it was made; unmatched refunds are clamped", async () => {
    const store = new InMemoryQuotaStore();
    let clock = new Date("2026-10-01T23:59:30Z");
    const quota = new Quota({ store, now: () => clock });
    const day = quota.today();
    expect(await quota.reserve("u", 40, day)).toBe(40);
    // …the run finishes after midnight: 3 calls were made, 37 come back to 2026-10-01.
    clock = new Date("2026-10-02T00:00:10Z");
    await quota.release("u", 37, day);
    await quota.increment("u", 1, day); // one late-counted call, same day
    expect(await store.get("u", "2026-10-01")).toBe(4);
    expect(await store.get("u", "2026-10-02")).toBe(0);
    expect(await quota.used("u")).toBe(0);
    expect(await quota.remaining("u")).toBe(950);

    // A refund without the day key never drives the new day negative or past the soft limit.
    await quota.release("u", 3);
    expect(await store.get("u", "2026-10-02")).toBe(0);
    expect(await quota.remaining("u")).toBe(950);
    await store.increment("u", "2026-10-02", -5); // a stray negative row from elsewhere
    expect(await quota.remaining("u")).toBe(950); // still capped at the soft limit
  });

  it("helpers: day key, next midnight, env soft limit, page estimates", () => {
    expect(utcDayKey(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
    expect(nextUtcMidnight(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(softLimitFromEnv({})).toBe(950);
    expect(softLimitFromEnv({ SEATS_AERO_DAILY_SOFT_LIMIT: "800" })).toBe(800);
    expect(softLimitFromEnv({ SEATS_AERO_DAILY_SOFT_LIMIT: "garbage" })).toBe(950);
    expect(softLimitFromEnv({ SEATS_AERO_DAILY_SOFT_LIMIT: "5000" })).toBe(950);
    expect(pagesFor(0)).toBe(1);
    expect(pagesFor(1000)).toBe(1);
    expect(pagesFor(1001)).toBe(2);
    expect(estimateCalls({ requests: [{ pages: 2 }, { pages: 0 }] })).toBe(3);
  });
});
