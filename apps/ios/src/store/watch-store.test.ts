/**
 * Device-local watches: the store, and its snapshot round trip.
 *
 * What these protect is mostly what the record must NOT do. There is no schedule field to test,
 * because there is none: a field that does not exist cannot be rendered as a next-run time.
 */
import { describe, expect, it } from "vitest";
import type { Watch } from "@awardgrid/core/watch";
import { MAX_WATCHES, WATCH_SNAPSHOT_VERSION, WatchStore } from "./watch-store";

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

describe("WatchStore", () => {
  it("adds, reads and removes", () => {
    const s = new WatchStore();
    expect(s.add(watch())).toEqual({ ok: true });
    expect(s.get("w1")?.name).toBe("HKG to SEA");
    expect(s.remove("w1")).toBe(true);
    expect(s.all()).toHaveLength(0);
  });

  it("refuses the same query text twice, because it would double the quota cost of every check", () => {
    const s = new WatchStore();
    s.add(watch());
    expect(s.add(watch({ id: "w2", text: "  HKG to SEA next 30 days business  " }))).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("caps the number of watches", () => {
    const s = new WatchStore();
    for (let i = 0; i < MAX_WATCHES; i++) s.add(watch({ id: `w${i}`, text: `query ${i}` }));
    expect(s.add(watch({ id: "one-too-many", text: "another" }))).toEqual({ ok: false, reason: "limit" });
  });

  it("updates in place and ignores an unknown id rather than inserting it", () => {
    const s = new WatchStore();
    s.add(watch());
    expect(s.update("w1", { enabled: false })?.enabled).toBe(false);
    expect(s.update("nope", { enabled: false })).toBeUndefined();
    expect(s.all()).toHaveLength(1);
  });

  it("cannot rewrite an id through update", () => {
    const s = new WatchStore();
    s.add(watch());
    s.update("w1", { id: "hijacked" } as Partial<Watch>);
    expect(s.get("w1")).toBeDefined();
    expect(s.get("hijacked")).toBeUndefined();
  });

  it("survives a JSON round trip with its baseline", () => {
    const a = new WatchStore();
    a.add(
      watch({
        lastCheckedAt: "2026-10-01T10:00:00.000Z",
        baseline: [{ key: "alaska|HKG|SEA|2026-10-05|J", miles: 80_000, fees_cents: 5_600, seats_left: 2, computed_last_seen: "x" }],
      }),
    );
    const b = new WatchStore();
    expect(b.restore(JSON.parse(JSON.stringify(a.snapshot())))).toBe(1);
    expect(b.get("w1")?.baseline).toHaveLength(1);
    expect(b.get("w1")?.lastCheckedAt).toBe("2026-10-01T10:00:00.000Z");
  });

  it("discards another version's snapshot rather than misreading a baseline into false changes", () => {
    const a = new WatchStore();
    a.add(watch());
    const b = new WatchStore();
    expect(b.restore({ ...a.snapshot(), version: WATCH_SNAPSHOT_VERSION + 1 })).toBe(0);
  });

  it("survives null, undefined and structurally broken input", () => {
    const s = new WatchStore();
    expect(s.restore(null)).toBe(0);
    expect(s.restore(undefined)).toBe(0);
    expect(s.restore({ version: WATCH_SNAPSHOT_VERSION, watches: null as never })).toBe(0);
    expect(s.restore({ version: WATCH_SNAPSHOT_VERSION, watches: [{ id: 5 } as never, watch()] })).toBe(1);
  });

  it("restores a missing baseline as empty rather than crashing the first diff", () => {
    const s = new WatchStore();
    s.restore({ version: WATCH_SNAPSHOT_VERSION, watches: [{ ...watch(), baseline: undefined as never }] });
    expect(s.get("w1")?.baseline).toEqual([]);
  });

  it("tracks dirtiness so the shell only writes when something changed", () => {
    const s = new WatchStore();
    expect(s.dirty).toBe(false);
    s.add(watch());
    expect(s.dirty).toBe(true);
    s.markClean();
    expect(s.dirty).toBe(false);
    s.remove("nope");
    expect(s.dirty).toBe(false);
  });

  it("has no schedule field at all — the absence is the design", () => {
    const record = watch() as unknown as Record<string, unknown>;
    for (const forbidden of ["scheduleCron", "nextRunAt", "nextCheckAt", "dueAt", "cron"]) {
      expect(record, `${forbidden} must not exist on a Watch`).not.toHaveProperty(forbidden);
    }
  });
});
