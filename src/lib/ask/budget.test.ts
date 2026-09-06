import { describe, expect, it } from "vitest";
import { openTestDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import {
  DEFAULT_DAILY_CAP_USD,
  DEFAULT_PER_REQUEST_MAX_USD,
  askDayKey,
  dailyCapUsd,
  getAskUsage,
  holdAsk,
  perRequestBudgetUsd,
  perRequestMaxUsd,
  releaseHold,
  reserveAsk,
  settleAsk,
  settleHold,
  usdToMicro,
} from "./budget";

const T0 = new Date("2026-09-06T23:30:00Z");

function seed() {
  const db = openTestDb();
  for (const id of ["alice", "bob"])
    db.insert(users)
      .values({ id, username: id, passwordHash: "x", createdAt: T0.toISOString() })
      .run();
  return db;
}

describe("budget", () => {
  it("defaults: $2/day, $0.50/request; env overrides; garbage falls back", () => {
    expect(DEFAULT_DAILY_CAP_USD).toBe(2);
    expect(DEFAULT_PER_REQUEST_MAX_USD).toBe(0.5);
    expect(dailyCapUsd({})).toBe(2);
    expect(dailyCapUsd({ ASK_DAILY_COST_CAP_USD: "5" })).toBe(5);
    expect(dailyCapUsd({ ASK_DAILY_COST_CAP_USD: "nope" })).toBe(2);
    expect(dailyCapUsd({ ASK_DAILY_COST_CAP_USD: "-1" })).toBe(2);
    expect(perRequestMaxUsd({})).toBe(0.5);
    expect(perRequestMaxUsd({ ASK_PER_REQUEST_MAX_USD: "0.25" })).toBe(0.25);
  });

  it("day key is the UTC calendar day", () => {
    expect(askDayKey(T0)).toBe("2026-09-06");
    expect(askDayKey(new Date("2026-09-06T23:59:59.999Z"))).toBe("2026-09-06");
    expect(askDayKey(new Date("2026-09-07T00:00:00.000Z"))).toBe("2026-09-07");
    expect(usdToMicro(0.123456789)).toBe(123457);
    expect(usdToMicro(Number.NaN)).toBe(0);
    expect(usdToMicro(-1)).toBe(0);
  });

  it("reserve → settle → reserve accumulates exactly and denies at the cap", () => {
    const db = seed();
    const fresh = reserveAsk(db, "alice", { now: T0 });
    expect(fresh).toEqual({
      allowed: true,
      remainingUsd: 2,
      spentUsd: 0,
      capUsd: 2,
      day: "2026-09-06",
      requests: 0,
    });

    const settled = settleAsk(db, "alice", 0.4, { now: T0 });
    const after1 = getAskUsage(db, "alice", "2026-09-06");
    expect(settled).toEqual(after1);
    expect(after1).toEqual({
      userId: "alice",
      day: "2026-09-06",
      costMicroUsd: 400000,
      costUsd: 0.4,
      requests: 1,
    });

    settleAsk(db, "alice", 0.1, { now: T0 });
    settleAsk(db, "alice", 0.2, { now: T0 });
    const after3 = getAskUsage(db, "alice", "2026-09-06");
    expect(after3.costMicroUsd).toBe(700000);
    expect(after3.requests).toBe(3);

    const mid = reserveAsk(db, "alice", { now: T0 });
    expect(mid.allowed).toBe(true);
    expect(mid.remainingUsd).toBeCloseTo(1.3, 6);

    settleAsk(db, "alice", 1.3, { now: T0 });
    const capped = reserveAsk(db, "alice", { now: T0 });
    expect(capped).toMatchObject({
      allowed: false,
      remainingUsd: 0,
      spentUsd: 2,
      capUsd: 2,
      requests: 4,
    });

    // over the cap (e.g. maxBudgetUsd overshoot) still denies, still records
    settleAsk(db, "alice", 0.05, { now: T0 });
    expect(reserveAsk(db, "alice", { now: T0 }).allowed).toBe(false);
  });

  it("is per user and per UTC day; a custom cap applies", () => {
    const db = seed();
    settleAsk(db, "alice", 1.99, { now: T0 });
    expect(reserveAsk(db, "bob", { now: T0 })).toMatchObject({
      allowed: true,
      remainingUsd: 2,
      spentUsd: 0,
    });
    expect(reserveAsk(db, "alice", { now: T0, capUsd: 1 })).toMatchObject({ allowed: false });
    expect(reserveAsk(db, "alice", { now: T0 }).remainingUsd).toBeCloseTo(0.01, 6);
    // 30 minutes later it is a new UTC day
    const tomorrow = new Date("2026-09-07T00:00:00Z");
    expect(reserveAsk(db, "alice", { now: tomorrow })).toMatchObject({
      allowed: true,
      remainingUsd: 2,
      day: "2026-09-07",
    });
    expect(getAskUsage(db, "alice", "2026-09-06").requests).toBe(1);
    expect(getAskUsage(db, "alice", "2026-09-07").requests).toBe(0);
    expect(getAskUsage(db, "nobody", "2026-09-06")).toEqual({
      userId: "nobody",
      day: "2026-09-06",
      costMicroUsd: 0,
      costUsd: 0,
      requests: 0,
    });
  });

  it("holdAsk charges the ceiling up front; settleHold replaces it with the actual cost; releaseHold undoes it", () => {
    const db = seed();
    const h1 = holdAsk(db, "alice", { now: T0 });
    expect(h1.allowed).toBe(true);
    expect(h1).toMatchObject({ remainingUsd: 2, spentUsd: 0, requests: 0 });
    expect(h1.hold).toEqual({ userId: "alice", day: "2026-09-06", budgetUsd: 0.5, budgetMicroUsd: 500000 });
    expect(getAskUsage(db, "alice", "2026-09-06")).toMatchObject({ costMicroUsd: 500000, requests: 1 });
    // read-only check sees the hold
    expect(reserveAsk(db, "alice", { now: T0 })).toMatchObject({ spentUsd: 0.5, remainingUsd: 1.5, requests: 1 });

    // actual cost below the ceiling → refund the difference; request stays counted
    expect(settleHold(db, h1.hold!, 0.0731)).toMatchObject({ costMicroUsd: 73100, requests: 1 });
    // actual cost above the ceiling (SDK overshoot) → charged in full
    const h2 = holdAsk(db, "alice", { now: T0 });
    expect(settleHold(db, h2.hold!, 0.52)).toMatchObject({ costMicroUsd: 73100 + 520000, requests: 2 });
    // release: ceiling and request both gone
    const h3 = holdAsk(db, "alice", { now: T0 });
    expect(getAskUsage(db, "alice", "2026-09-06")).toMatchObject({ costMicroUsd: 73100 + 520000 + 500000, requests: 3 });
    expect(releaseHold(db, h3.hold!)).toMatchObject({ costMicroUsd: 73100 + 520000, requests: 2 });
    // custom per-request ceiling, and the ceiling never exceeds what is left
    expect(holdAsk(db, "bob", { now: T0, perRequestUsd: 0.25 }).hold).toMatchObject({ budgetUsd: 0.25 });
    expect(holdAsk(db, "bob", { now: T0, capUsd: 0.3 }).hold?.budgetUsd).toBeCloseTo(0.05, 6);
    expect(perRequestBudgetUsd(0.2)).toBe(0.2);
    expect(perRequestBudgetUsd(5)).toBe(0.5);
    expect(perRequestBudgetUsd(0)).toBe(0.01);
  });

  it("concurrent holds each see the previous one and the day is capped", () => {
    const db = seed();
    settleAsk(db, "alice", 0.9, { now: T0 }); // $1.10 left
    const a = holdAsk(db, "alice", { now: T0 });
    const b = holdAsk(db, "alice", { now: T0 });
    const c = holdAsk(db, "alice", { now: T0 });
    const d = holdAsk(db, "alice", { now: T0 });
    expect(a.hold?.budgetUsd).toBeCloseTo(0.5, 6);
    expect(b.hold?.budgetUsd).toBeCloseTo(0.5, 6);
    expect(c.hold?.budgetUsd).toBeCloseTo(0.1, 6);
    expect(d).toMatchObject({ allowed: false, hold: null, remainingUsd: 0 });
    expect(getAskUsage(db, "alice", "2026-09-06")).toMatchObject({ costMicroUsd: 2_000_000, requests: 4 });
    // unsettled holds (timed-out sessions) stay charged: still denied
    expect(reserveAsk(db, "alice", { now: T0 }).allowed).toBe(false);
    // a refund frees room again
    settleHold(db, a.hold!, 0.05);
    const again = reserveAsk(db, "alice", { now: T0 });
    expect(again.allowed).toBe(true);
    expect(again.remainingUsd).toBeCloseTo(0.45, 6);
  });

  it("zero-cost settle still counts a request", () => {
    const db = seed();
    settleAsk(db, "bob", 0, { now: T0 });
    expect(getAskUsage(db, "bob", "2026-09-06")).toMatchObject({ costMicroUsd: 0, requests: 1 });
  });
});
