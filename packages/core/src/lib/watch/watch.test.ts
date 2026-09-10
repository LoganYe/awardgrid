/**
 * The rules that keep a watch from being either useless or expensive.
 *
 * A NEW file. `diff.test.ts` moved into this directory in Phase 4 and is untouchable; anything
 * added after the move gets its own file rather than a line appended to it.
 *
 * TZ is pinned by the package's vitest config and every clock is injected, so nothing here depends
 * on what time it runs.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_MIN_QUOTA, type DueOptions, type Watch, dueForCheck, isChanged, sinceLastCheck } from "./watch";
import type { CellSnapshot, SnapshotDiff } from "./types";

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

function opts(over: Partial<DueOptions> = {}): DueOptions {
  return { now: NOW, ttlMinutes: 45, quotaRemaining: 900, hasKey: true, ...over };
}

const emptyDiff: SnapshotDiff = { new: [], dropped: [], price_drops: [], unchanged: 0 };
const cell = (key: string): CellSnapshot => ({
  key,
  miles: 80_000,
  fees_cents: 5_600,
  seats_left: 2,
  computed_last_seen: "2026-10-01T00:00:00.000Z",
});

describe("dueForCheck", () => {
  it("lets a never-checked watch run", () => {
    expect(dueForCheck(watch(), opts())).toBeNull();
  });

  it("refuses a watch checked inside the cache TTL, because a fetch could not return fresher data", () => {
    const justChecked = watch({ lastCheckedAt: "2026-10-01T11:30:00.000Z" }); // 30 min ago, TTL 45
    expect(dueForCheck(justChecked, opts())).toBe("checked_recently");
  });

  it("lets it run once the TTL has passed", () => {
    const stale = watch({ lastCheckedAt: "2026-10-01T11:00:00.000Z" }); // 60 min ago
    expect(dueForCheck(stale, opts())).toBeNull();
  });

  it("treats the TTL boundary as due, not as recent", () => {
    const exactly = watch({ lastCheckedAt: "2026-10-01T11:15:00.000Z" }); // exactly 45 min
    expect(dueForCheck(exactly, opts())).toBeNull();
  });

  it("never runs a disabled watch, whatever else is true", () => {
    expect(dueForCheck(watch({ enabled: false }), opts())).toBe("disabled");
  });

  it("does not run without a key", () => {
    expect(dueForCheck(watch(), opts({ hasKey: false }))).toBe("no_key");
  });

  it("reserves headroom so a watch cannot spend the day's last call", () => {
    expect(dueForCheck(watch(), opts({ quotaRemaining: DEFAULT_MIN_QUOTA - 1 }))).toBe("quota_low");
    expect(dueForCheck(watch(), opts({ quotaRemaining: DEFAULT_MIN_QUOTA }))).toBeNull();
  });

  it("checks disabled before quota, so a paused watch says paused rather than blaming quota", () => {
    expect(dueForCheck(watch({ enabled: false }), opts({ quotaRemaining: 0, hasKey: false }))).toBe("disabled");
  });

  it("treats an unparseable timestamp as never checked rather than freezing the watch", () => {
    expect(dueForCheck(watch({ lastCheckedAt: "not a date" }), opts())).toBeNull();
  });

  it("survives a clock that moved backwards instead of freezing until it catches up", () => {
    // lastCheckedAt in the future: an NTP correction or a timezone change, not a real check.
    const future = watch({ lastCheckedAt: "2026-10-02T12:00:00.000Z" });
    expect(dueForCheck(future, opts())).toBeNull();
  });
});

describe("isChanged", () => {
  it("is false for an empty diff", () => {
    expect(isChanged(emptyDiff)).toBe(false);
  });

  it("is false when cells merely stayed the same", () => {
    expect(isChanged({ ...emptyDiff, unchanged: 12 })).toBe(false);
  });

  it("is true for a new cell, a dropped cell, or a price drop", () => {
    expect(isChanged({ ...emptyDiff, new: [cell("a|X|Y|2026-10-01|J")] })).toBe(true);
    expect(isChanged({ ...emptyDiff, dropped: [cell("a|X|Y|2026-10-01|J")] })).toBe(true);
    expect(
      isChanged({
        ...emptyDiff,
        price_drops: [{ key: "a|X|Y|2026-10-01|J", before: cell("a"), after: cell("a"), pct: 12.5 }],
      }),
    ).toBe(true);
  });
});

describe("sinceLastCheck", () => {
  it("is null when the watch has never run", () => {
    expect(sinceLastCheck(null, NOW)).toBeNull();
  });

  it("reports minutes, then hours, then days", () => {
    expect(sinceLastCheck("2026-10-01T11:58:00.000Z", NOW)).toEqual({ value: 2, unit: "minute" });
    expect(sinceLastCheck("2026-10-01T09:00:00.000Z", NOW)).toEqual({ value: 3, unit: "hour" });
    expect(sinceLastCheck("2026-09-28T12:00:00.000Z", NOW)).toEqual({ value: 3, unit: "day" });
  });

  it("crosses each boundary the way a reader expects", () => {
    expect(sinceLastCheck("2026-10-01T11:01:00.000Z", NOW)).toEqual({ value: 59, unit: "minute" });
    expect(sinceLastCheck("2026-10-01T11:00:00.000Z", NOW)).toEqual({ value: 1, unit: "hour" });
    expect(sinceLastCheck("2026-09-30T13:00:00.000Z", NOW)).toEqual({ value: 23, unit: "hour" });
    expect(sinceLastCheck("2026-09-30T12:00:00.000Z", NOW)).toEqual({ value: 1, unit: "day" });
  });

  it("says 'just now' rather than a negative age when the clock moved backwards", () => {
    expect(sinceLastCheck("2026-10-01T12:05:00.000Z", NOW)).toEqual({ value: 0, unit: "minute" });
  });

  it("is null for an unparseable timestamp", () => {
    expect(sinceLastCheck("yesterday-ish", NOW)).toBeNull();
  });
});
