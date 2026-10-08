/**
 * Short-term caching (./short-term.ts) and the Saved methods it relies on (core FavoritesStore.removeRows,
 * replaceRows, savedOptionIdentity): nothing from seats.aero older than 24 hours stays in the cache, the workspace's
 * snapshots (in either slot), Saved or a watch, and what is kept instead is what the plan names — the query and a
 * summary for Saved, the conditions for a watch.
 */
import { describe, expect, it } from "vitest";
import { FIXTURE_NOW, fixtureSnapshot } from "@awardgrid/core/test-fixtures/uiux/factory";
import { CACHE_SNAPSHOT_VERSION, type CacheSnapshot } from "@awardgrid/core/seatsaero/cache";
import type { Watch } from "@awardgrid/core/watch";
import { FAVORITES_NAMESPACE, FavoritesStore, favoriteFromOption, favoriteFromSnapshot, savedOptionIdentity } from "@awardgrid/core/workspace/favorites-store";
import type { ResultSnapshot, StoragePort } from "@awardgrid/core/workspace/types";
import { WORKSPACE_NAMESPACE } from "@awardgrid/core/workspace/workspace-store";
import { MemoryFileStore } from "../store/persistence";
import { SlotFileStorage } from "../workspace/slot-storage";
import {
  SHORT_TERM_MAX_AGE_MS,
  favoriteExpired,
  favoriteFetchedAt,
  pruneCacheSnapshot,
  pruneWorkspace,
  shortTermStorage,
  snapshotFetchedAt,
  watchExpiry,
  watchReset,
} from "./short-term";

const DAY = SHORT_TERM_MAX_AGE_MS;
const FETCHED = Date.parse("2026-10-18T08:00:00Z"); // the fixture rows' fetched_at
const FRESH_CUTOFF = FETCHED - 1000; // rows fetched after this are within the limit
const OLD_CUTOFF = FETCHED + 1000; // rows fetched before this are past it

function row(fetchedAt: string) {
  return { program: "aeroplan", origin: "HKG", dest: "SEA", date: "2026-10-20", cabin: "J", miles: 70000, airlines: ["AC"], fetched_at: fetchedAt, source_id: `id-${fetchedAt}` };
}

describe("the availability cache", () => {
  it("drops rows and coverage fetched before the cutoff, and counts them", () => {
    const snapshot = {
      version: CACHE_SNAPSHOT_VERSION,
      users: [
        {
          userId: "local",
          rows: [row("2026-10-17T07:00:00Z"), row("2026-10-18T07:00:00Z"), { ...row("garbage"), fetched_at: "not a time" }],
          coverage: [
            { origin: "HKG", dest: "SEA", date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J"], programs: null, direct_only: false, fetched_at: "2026-10-17T07:00:00Z" },
            { origin: "HKG", dest: "SEA", date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J"], programs: null, direct_only: false, fetched_at: "2026-10-18T07:00:00Z" },
          ],
        },
      ],
    } as unknown as CacheSnapshot;
    const cutoff = Date.parse("2026-10-18T00:00:00Z");
    const pruned = pruneCacheSnapshot(snapshot, cutoff);
    expect(pruned.dropped).toBe(3);
    expect(pruned.snapshot!.users[0]!.rows.map((r) => r.fetched_at)).toEqual(["2026-10-18T07:00:00Z"]);
    expect(pruned.snapshot!.users[0]!.coverage.map((c) => c.fetched_at)).toEqual(["2026-10-18T07:00:00Z"]);
    expect(pruneCacheSnapshot(null, cutoff)).toEqual({ snapshot: null, dropped: 0 });
  });
});

describe("the workspace's snapshots", () => {
  const saved = (snapshots: ResultSnapshot[], displayedId: string | null, previousId: string | null = null) => ({ schemaVersion: 1, revision: 3, displayedId, previousId, preferences: {}, snapshots });

  it("a snapshot's data time is the oldest of its creation and its rows' fetch times", () => {
    expect(snapshotFetchedAt(fixtureSnapshot())).toBe(FETCHED);
    expect(snapshotFetchedAt({ createdAt: "2026-10-18T08:00:00Z", rows: [{ value: {} }] })).toBeNull();
  });

  it("drops snapshots past the cutoff and clears the shown and previous ids that pointed at them", () => {
    const old = fixtureSnapshot({ id: "old" });
    const fresh = { ...fixtureSnapshot({ id: "fresh" }), createdAt: "2026-10-19T08:00:00Z", rows: fixtureSnapshot().rows.map((r) => ({ ...r, value: { ...r.value, fetched_at: "2026-10-19T08:00:00Z" } })) };
    const cutoff = Date.parse("2026-10-19T00:00:00Z");
    const pruned = pruneWorkspace(saved([old, fresh], "old", "fresh"), cutoff);
    expect(pruned.dropped).toBe(1);
    expect(pruned.value).toMatchObject({ displayedId: null, previousId: "fresh", snapshots: [{ id: "fresh" }] });
    expect(pruneWorkspace(saved([fresh], "fresh"), cutoff)).toEqual({ value: saved([fresh], "fresh"), dropped: 0 });
    expect(pruneWorkspace("not a workspace", cutoff)).toEqual({ value: "not a workspace", dropped: 0 });
  });

  it("the storage drops them on read and write, writes the pruned file back, and leaves no older version in the other slot", async () => {
    const files = new MemoryFileStore();
    const slots = new SlotFileStorage(files);
    const writes: string[] = [];
    const counting: StoragePort = {
      read: (n) => slots.read(n),
      writeAtomically: async (n, v) => {
        writes.push(n);
        await slots.writeAtomically(n, v);
      },
      remove: (n) => slots.remove(n),
    };
    let cutoff = FRESH_CUTOFF;
    const storage = shortTermStorage(counting, () => cutoff);
    await storage.writeAtomically(WORKSPACE_NAMESPACE, saved([fixtureSnapshot()], "fixture-snapshot-1"));
    // Both slots now hold it: no previous version lingers in the second one.
    expect(writes).toEqual([WORKSPACE_NAMESPACE, WORKSPACE_NAMESPACE]);
    expect([...files.files.keys()].filter((k) => k.includes(WORKSPACE_NAMESPACE))).toHaveLength(2);
    expect(((await storage.read(WORKSPACE_NAMESPACE)) as { snapshots: unknown[] }).snapshots).toHaveLength(1);
    // A day later the snapshot is past the limit: the read drops it and writes the pruned workspace to both slots.
    cutoff = OLD_CUTOFF;
    writes.length = 0;
    expect(((await storage.read(WORKSPACE_NAMESPACE)) as { snapshots: unknown[] }).snapshots).toEqual([]);
    expect(writes).toEqual([WORKSPACE_NAMESPACE, WORKSPACE_NAMESPACE]);
    for (const [name, raw] of files.files) if (name.includes(WORKSPACE_NAMESPACE)) expect(raw).not.toContain("aeroplan");
    // Saved is written to both slots too; another namespace once, untouched.
    writes.length = 0;
    await storage.writeAtomically(FAVORITES_NAMESPACE, { schemaVersion: 1, items: [] });
    await storage.writeAtomically("settings-v1", { theme: "dark" });
    expect(writes).toEqual([FAVORITES_NAMESPACE, FAVORITES_NAMESPACE, "settings-v1"]);
    expect(await storage.read("settings-v1")).toEqual({ theme: "dark" });
  });
});

describe("Saved", () => {
  const snapshot = fixtureSnapshot();

  it("an item's data time is its oldest row's fetch time; an item without rows has nothing to expire", () => {
    const item = favoriteFromSnapshot(snapshot, FIXTURE_NOW, "f1");
    expect(favoriteFetchedAt(item)).toBe(FETCHED);
    expect(favoriteExpired(item, FRESH_CUTOFF)).toBe(false);
    expect(favoriteExpired(item, OLD_CUTOFF)).toBe(true);
    expect(favoriteExpired({ ...item, rows: [] }, OLD_CUTOFF)).toBe(false);
  });

  it("removeRows keeps the query, saved time, origin and how many options it showed; nothing else of seats.aero's", async () => {
    const files = new MemoryFileStore();
    // Through the short-term storage, as the OAuth flavour saves it: both slots are written each time.
    const store = new FavoritesStore(shortTermStorage(new SlotFileStorage(files), () => OLD_CUTOFF), () => FIXTURE_NOW);
    await store.save(favoriteFromSnapshot(snapshot, FIXTURE_NOW, "f1"));
    const option = favoriteFromOption(snapshot, snapshot.rows[0]!.key, FIXTURE_NOW, "f2")!;
    await store.save(option);
    const result = await store.removeRows((item) => favoriteExpired(item, OLD_CUTOFF), "2026-10-19T09:00:00Z", (item) => item.rows.length);
    expect(result).toEqual({ ok: true, removed: 2 });
    const [opt, whole] = store.all();
    expect(whole).toMatchObject({ id: "f1", savedAt: FIXTURE_NOW, query: snapshot.query, rows: [], coverage: { state: "unknown" }, rowsRemoved: { at: "2026-10-19T09:00:00Z", options: snapshot.rows.length } });
    expect(opt).toMatchObject({ id: "f2", originalSnapshotId: option.originalSnapshotId, rows: [], rowsRemoved: { options: 1 } });
    // Read back from disk exactly so; and a second pass removes nothing more.
    const reread = new FavoritesStore(new SlotFileStorage(files), () => FIXTURE_NOW);
    await reread.load();
    expect(reread.all()).toEqual(store.all());
    expect(await store.removeRows(() => true, "2026-10-20T00:00:00Z", () => 0)).toEqual({ ok: true, removed: 0 });
    // Neither slot still holds a row: the previous version is not left behind in the second one.
    for (const raw of files.files.values()) expect(raw).not.toContain("75000");
  });

  it("a saved option is still named after its row is gone: program, route, day and cabin from its origin", () => {
    const option = favoriteFromOption(snapshot, snapshot.rows[0]!.key, FIXTURE_NOW, "f2")!;
    const v = snapshot.rows[0]!.value;
    expect(savedOptionIdentity(option)).toEqual({ program: v.program, origin: v.origin, dest: v.dest, date: v.date, cabin: v.cabin });
    expect(savedOptionIdentity(favoriteFromSnapshot(snapshot, FIXTURE_NOW, "f1"))).toBeNull();
    expect(savedOptionIdentity({ originalSnapshotId: "s#not~a~key" })).toBeNull();
  });

  it("replaceRows puts a fresh search of the item's own query back, and refuses another query's", async () => {
    const store = new FavoritesStore(new SlotFileStorage(new MemoryFileStore()), () => FIXTURE_NOW);
    await store.save(favoriteFromSnapshot(snapshot, FIXTURE_NOW, "f1"));
    const option = favoriteFromOption(snapshot, snapshot.rows[0]!.key, FIXTURE_NOW, "f2")!;
    await store.save(option);
    await store.removeRows(() => true, "2026-10-19T09:00:00Z", (item) => item.rows.length);
    const later = { ...snapshot, id: "saved-f1@later", createdAt: "2026-10-19T10:00:00Z", rows: snapshot.rows.map((r) => ({ ...r, value: { ...r.value, fetched_at: "2026-10-19T10:00:00Z", source_id: "renewed" } })) };
    const whole = await store.replaceRows("f1", later);
    expect(whole.ok && whole.item).toMatchObject({ id: "f1", savedAt: FIXTURE_NOW, rows: later.rows, coverage: later.coverage });
    expect(whole.ok && "rowsRemoved" in whole.item).toBe(false);
    // The option keeps only the same program, route, day and cabin, whatever its new source id.
    const one = await store.replaceRows("f2", later);
    expect(one.ok && one.item.rows.map((r) => [r.value.program, r.value.date, r.value.cabin, r.value.source_id])).toEqual([[snapshot.rows[0]!.value.program, snapshot.rows[0]!.value.date, snapshot.rows[0]!.value.cabin, "renewed"]]);
    expect(one.ok && one.item.originalSnapshotId).toBe(option.originalSnapshotId);
    const other = fixtureSnapshot({ query: { ...snapshot.query, cabins: ["F"] } });
    expect(await store.replaceRows("f1", other)).toEqual({ ok: false, reason: "mismatch" });
    expect(await store.replaceRows("nope", later)).toEqual({ ok: false, reason: "unknown" });
  });

  it("an item without rowsRemoved reads exactly as before; a damaged rowsRemoved is ignored, not the item", async () => {
    const files = new MemoryFileStore();
    const storage = new SlotFileStorage(files);
    const item = favoriteFromSnapshot(snapshot, FIXTURE_NOW, "f1");
    await storage.writeAtomically(FAVORITES_NAMESPACE, { schemaVersion: 1, items: [item, { ...item, id: "f2", originalSnapshotId: "x", rowsRemoved: { at: "yesterday", options: -1 } }] });
    const store = new FavoritesStore(storage, () => FIXTURE_NOW);
    await store.load();
    expect(store.all()[0]).toEqual(item);
    expect("rowsRemoved" in store.all()[1]!).toBe(false);
    expect(store.all()[1]!.rows).toEqual(item.rows);
  });
});

describe("watches", () => {
  const NOW = Date.parse("2026-10-06T12:00:00Z");
  const cutoff = NOW - DAY;
  const cell = { key: "aeroplan|HKG|SEA|2026-10-20|J", miles: 70000, fees_cents: null, seats_left: 2, computed_last_seen: "2026-10-05T00:00:00Z" };
  const watch = (over: Partial<Watch>): Watch => ({ id: "w", name: "w", text: "t", lastCheckedAt: null, baseline: [], dropThresholdPct: 10, enabled: true, createdAt: "2026-10-01T00:00:00Z", ...over });

  it("purges a baseline taken before the cutoff, and change details found before it; the counts and conditions stay", () => {
    const old = new Date(NOW - DAY - 60_000).toISOString();
    const recent = new Date(NOW - 60_000).toISOString();
    const w = watch({
      lastCheckedAt: old,
      baseline: [cell],
      baselineWindow: { date_from: "2026-10-01", date_to: "2026-10-30" },
      unseen: { new: 2, dropped: 0, cheaper: 1, since: old },
      unseenChanges: [
        { kind: "new", key: cell.key, before: null, after: { miles: 70000, fees_cents: null }, at: old },
        { kind: "cheaper", key: cell.key, before: { miles: 80000, fees_cents: null }, after: { miles: 70000, fees_cents: null }, at: recent },
      ],
    });
    expect(watchExpiry(w, cutoff)).toEqual({ baseline: [], baselineWindow: null, unseenChanges: [w.unseenChanges![1]] });
    expect(watchExpiry(watch({ lastCheckedAt: recent, baseline: [cell] }), cutoff)).toBeNull();
    expect(watchExpiry(watch({ lastCheckedAt: old, baseline: [], baselineWindow: null }), cutoff)).toBeNull();
    expect(watchExpiry(watch({ lastCheckedAt: recent, unseenChanges: [{ ...w.unseenChanges![0]! }] }), cutoff)).toEqual({ unseenChanges: null });
  });

  it("a reset (Disconnect) leaves a watch as a new one: no baseline, changes or history, its conditions untouched", () => {
    expect(watchReset()).toEqual({ baseline: [], baselineWindow: null, unseen: null, unseenChanges: null, lastCheckedAt: null, lastAttemptAt: null, lastResult: null });
  });
});
