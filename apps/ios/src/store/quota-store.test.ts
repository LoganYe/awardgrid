/**
 * The X-RateLimit-Remaining trust rule (docs/PIVOT.md §2).
 *
 * The scenario worth naming: a user reinstalls the app at noon having already spent 600 calls.
 * The local counter is 0, so without reconciliation the app would offer 950 more and the user
 * would hit seats.aero's real 1,000 limit mid-grid, believing they had headroom. That is the
 * failure PIVOT §2 describes, and it is what `observeRateLimitRemaining` exists to prevent.
 */
import { describe, expect, it } from "vitest";
import { Quota, utcDayKey } from "@awardgrid/core/seatsaero/quota";
import { DeviceQuotaStore, QUOTA_SNAPSHOT_VERSION } from "./quota-store";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const TODAY = utcDayKey(NOW);
const U = "local";

describe("DeviceQuotaStore", () => {
  it("counts locally like any quota store", async () => {
    const s = new DeviceQuotaStore();
    expect(await s.get(U, TODAY)).toBe(0);
    expect(await s.increment(U, TODAY, 3)).toBe(3);
    expect(await s.increment(U, TODAY, 2)).toBe(5);
    expect(await s.get(U, TODAY)).toBe(5);
  });

  it("corrects a fresh install on the FIRST response, not after an overrun", async () => {
    const s = new DeviceQuotaStore();
    // Reinstalled at noon; seats.aero says 400 of 1,000 left, so 600 are already gone.
    expect(s.observeRateLimitRemaining("400", NOW)).toBe(600);

    const quota = new Quota({ store: s, now: () => NOW });
    // Soft limit is 950, so 950 - 600 = 350 remain to us, not 950.
    expect(await quota.remaining(U)).toBe(350);
  });

  it("never refunds calls: reconciliation is monotonic within a day", async () => {
    const s = new DeviceQuotaStore();
    s.observeRateLimitRemaining("400", NOW); // used = 600
    // A later (or out-of-order, or retried) response claiming more headroom must not lower it.
    expect(s.observeRateLimitRemaining("900", NOW)).toBe(600);
    expect(await s.get(U, TODAY)).toBe(600);
  });

  it("takes the header when it is higher than the local count, and the count when it is higher", async () => {
    const s = new DeviceQuotaStore();
    await s.increment(U, TODAY, 700);
    // Header implies only 600 used; our own count of 700 is worse news and wins.
    expect(s.observeRateLimitRemaining("400", NOW)).toBe(700);
    // Header now implies 800 used; that is worse than 700 and wins.
    expect(s.observeRateLimitRemaining("200", NOW)).toBe(800);
  });

  it("a refund of unused reservations cannot walk back below seats.aero's own floor", async () => {
    const s = new DeviceQuotaStore();
    // runFind reserves up front…
    await s.increment(U, TODAY, 40);
    // …seats.aero then tells us 600 are really gone…
    s.observeRateLimitRemaining("400", NOW);
    expect(await s.get(U, TODAY)).toBe(600);
    // …and the run settles by refunding the 13 reservations it did not use.
    expect(await s.increment(U, TODAY, -13)).toBe(600);
    expect(await s.get(U, TODAY)).toBe(600);
  });

  it("still refunds normally when no floor has been established", async () => {
    const s = new DeviceQuotaStore();
    await s.increment(U, TODAY, 40);
    expect(await s.increment(U, TODAY, -13)).toBe(27);
  });

  it("ignores a missing or unparseable header rather than guessing", async () => {
    const s = new DeviceQuotaStore();
    await s.increment(U, TODAY, 10);
    for (const bad of [null, undefined, "", "   ", "not-a-number", "-5"]) {
      expect(s.observeRateLimitRemaining(bad, NOW)).toBe(10);
    }
    expect(await s.get(U, TODAY)).toBe(10);
  });

  it("treats a zero-remaining header as a full day spent", async () => {
    const s = new DeviceQuotaStore();
    expect(s.observeRateLimitRemaining("0", NOW)).toBe(1000);
    const quota = new Quota({ store: s, now: () => NOW });
    expect(await quota.remaining(U)).toBe(0);
    await expect(quota.assertCanCall(U, 1)).rejects.toThrow(/quota reached/i);
  });

  it("keys by UTC day, so the count starts clean after midnight", async () => {
    const s = new DeviceQuotaStore();
    s.observeRateLimitRemaining("100", NOW); // used = 900 today
    const tomorrow = new Date("2026-10-02T00:30:00.000Z");
    expect(await s.get(U, utcDayKey(tomorrow))).toBe(0);
    const quota = new Quota({ store: s, now: () => tomorrow });
    expect(await quota.remaining(U)).toBe(950);
  });

  it("survives a snapshot round trip and keeps today's count", async () => {
    const a = new DeviceQuotaStore();
    await a.increment(U, TODAY, 42);
    const json = JSON.parse(JSON.stringify(a.snapshot(NOW)));

    const b = new DeviceQuotaStore();
    b.restore(json);
    expect(await b.get(U, TODAY)).toBe(42);
  });

  it("drops history older than a week so the snapshot cannot grow without bound", async () => {
    const s = new DeviceQuotaStore();
    await s.increment(U, "2026-08-01", 5); // ancient
    await s.increment(U, TODAY, 7);
    const snap = s.snapshot(NOW);
    expect(snap.days[TODAY]).toBe(7);
    expect(snap.days["2026-08-01"]).toBeUndefined();
  });

  it("discards a snapshot from another version instead of misreading it", async () => {
    const a = new DeviceQuotaStore();
    await a.increment(U, TODAY, 99);
    const stale = { ...a.snapshot(NOW), version: QUOTA_SNAPSHOT_VERSION + 1 };
    const b = new DeviceQuotaStore();
    b.restore(stale);
    expect(await b.get(U, TODAY)).toBe(0);
  });

  it("survives null, undefined and structurally broken snapshots", async () => {
    const s = new DeviceQuotaStore();
    s.restore(null);
    s.restore(undefined);
    s.restore({ version: QUOTA_SNAPSHOT_VERSION, days: null as never });
    s.restore({ version: QUOTA_SNAPSHOT_VERSION, days: { [TODAY]: "nope" as never } });
    expect(await s.get(U, TODAY)).toBe(0);
  });

  it("tracks dirtiness so the shell knows when a write is worth doing", async () => {
    const s = new DeviceQuotaStore();
    expect(s.dirty).toBe(false);
    await s.increment(U, TODAY, 1);
    expect(s.dirty).toBe(true);
    s.markClean();
    expect(s.dirty).toBe(false);
    s.observeRateLimitRemaining("1", NOW);
    expect(s.dirty).toBe(true);
  });
});
