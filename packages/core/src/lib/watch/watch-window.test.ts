/**
 * Two rules that decide whether a watch can be trusted: the attempt clock, and diffing only over
 * the dates two checks both covered.
 *
 * The second is the one worth reading. A watch re-parses its text every check — which is how it
 * avoids the web app's issue #47, where absolute dates freeze and a standing query goes silent —
 * so "next 30 days" slides with the calendar. Without the overlap rule, every date that aged out
 * would be reported as a dropped seat and every date that entered as a new one, on every check.
 */
import { describe, expect, it } from "vitest";
import { type DueOptions, type Watch, diffWithinOverlap, dueForCheck, isChanged } from "./watch";
import type { CellSnapshot } from "./types";

const NOW = new Date("2026-10-01T12:00:00.000Z");

function watch(over: Partial<Watch> = {}): Watch {
  return {
    id: "w1",
    name: "HKG to SEA",
    text: "HKG to SEA next 30 days business",
    lastCheckedAt: null,
    baseline: [],
    dropThresholdPct: 10,
    enabled: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

const opts = (over: Partial<DueOptions> = {}): DueOptions => ({
  now: NOW,
  ttlMinutes: 45,
  quotaRemaining: 900,
  hasKey: true,
  ...over,
});

const cell = (date: string, miles = 80_000, program = "alaska"): CellSnapshot => ({
  key: `${program}|HKG|SEA|${date}|J`,
  miles,
  fees_cents: 5_600,
  seats_left: 2,
  computed_last_seen: "2026-10-01T00:00:00.000Z",
});

const diffOpts = { dropThresholdPct: 10 };

describe("dueForCheck and the attempt clock", () => {
  it("waits out the TTL after a failed check that may have spent a call", () => {
    // Last success was long ago, but a costly attempt failed 10 minutes ago.
    const w = watch({ lastCheckedAt: "2026-09-30T00:00:00.000Z", lastAttemptAt: "2026-10-01T11:50:00.000Z" });
    expect(dueForCheck(w, opts())).toBe("checked_recently");
  });

  it("falls back to lastCheckedAt when no attempt has been recorded", () => {
    expect(dueForCheck(watch({ lastCheckedAt: "2026-10-01T11:50:00.000Z" }), opts())).toBe("checked_recently");
    expect(dueForCheck(watch({ lastCheckedAt: "2026-10-01T10:00:00.000Z" }), opts())).toBeNull();
  });

  it("runs once the failed attempt is older than the TTL", () => {
    const w = watch({ lastCheckedAt: null, lastAttemptAt: "2026-10-01T10:00:00.000Z" });
    expect(dueForCheck(w, opts())).toBeNull();
  });
});

describe("diffWithinOverlap", () => {
  const oct1 = { date_from: "2026-10-01", date_to: "2026-10-30" };
  const oct8 = { date_from: "2026-10-08", date_to: "2026-11-06" };

  it("does NOT report a date that merely aged out of a sliding window as a dropped seat", () => {
    const prev = [cell("2026-10-05"), cell("2026-10-25")];
    const next = [cell("2026-10-25")]; // Oct 5 is simply no longer inside "next 30 days"
    const diff = diffWithinOverlap(prev, oct1, next, oct8, diffOpts);
    expect(diff.dropped).toEqual([]);
    expect(isChanged(diff)).toBe(false);
  });

  it("does NOT report a date that merely entered the window as a new seat", () => {
    const prev = [cell("2026-10-25")];
    const next = [cell("2026-10-25"), cell("2026-11-03")]; // Nov 3 was never in the old window
    const diff = diffWithinOverlap(prev, oct1, next, oct8, diffOpts);
    expect(diff.new).toEqual([]);
    expect(isChanged(diff)).toBe(false);
  });

  it("DOES report a seat that disappeared inside the overlap", () => {
    const prev = [cell("2026-10-25")];
    const next: CellSnapshot[] = [];
    const diff = diffWithinOverlap(prev, oct1, next, oct8, diffOpts);
    expect(diff.dropped.map((c) => c.key)).toEqual(["alaska|HKG|SEA|2026-10-25|J"]);
    expect(isChanged(diff)).toBe(true);
  });

  it("DOES report a seat that appeared inside the overlap", () => {
    const prev = [cell("2026-10-25")];
    const next = [cell("2026-10-25"), cell("2026-10-20")];
    const diff = diffWithinOverlap(prev, oct1, next, oct8, diffOpts);
    expect(diff.new.map((c) => c.key)).toEqual(["alaska|HKG|SEA|2026-10-20|J"]);
  });

  it("DOES report a price drop inside the overlap", () => {
    const prev = [cell("2026-10-25", 80_000)];
    const next = [cell("2026-10-25", 60_000)];
    const diff = diffWithinOverlap(prev, oct1, next, oct8, diffOpts);
    expect(diff.price_drops).toHaveLength(1);
    expect(diff.price_drops[0]!.pct).toBe(25);
  });

  it("says nothing across a gap with no overlap, rather than inventing changes", () => {
    const later = { date_from: "2026-12-01", date_to: "2026-12-30" };
    const diff = diffWithinOverlap([cell("2026-10-05")], oct1, [cell("2026-12-10")], later, diffOpts);
    expect(diff).toEqual({ new: [], dropped: [], price_drops: [], unchanged: 0 });
  });

  it("uses the current window for both sides when the baseline window is unknown", () => {
    // A baseline taken before windows were recorded: an aged-out date must still not count.
    const diff = diffWithinOverlap([cell("2026-10-05"), cell("2026-10-25")], null, [cell("2026-10-25")], oct8, diffOpts);
    expect(diff.dropped).toEqual([]);
    expect(diff.unchanged).toBe(1);
  });

  it("is identical to a plain diff when the window did not move", () => {
    const prev = [cell("2026-10-05"), cell("2026-10-25")];
    const next = [cell("2026-10-05")];
    const diff = diffWithinOverlap(prev, oct1, next, oct1, diffOpts);
    expect(diff.dropped.map((c) => c.key)).toEqual(["alaska|HKG|SEA|2026-10-25|J"]);
    expect(diff.unchanged).toBe(1);
  });

  it("leaves out a cell whose key cannot be placed in time rather than guessing", () => {
    const junk: CellSnapshot = { ...cell("2026-10-25"), key: "not-a-key" };
    const diff = diffWithinOverlap([junk], oct1, [], oct1, diffOpts);
    expect(diff.dropped).toEqual([]);
  });
});
