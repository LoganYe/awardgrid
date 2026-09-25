/**
 * Saved snapshots (UI/UX v1 T13; docs/02 D04; docs/03 FavoriteV1; acceptance A23): loading reads and never writes or
 * fetches; a full store refuses with "capacity" and keeps every item; a failed write keeps the previous list; a
 * deletion can be undone; a damaged item is dropped without losing the rest, and a newer version is left alone.
 */
import { describe, expect, it, vi } from "vitest";
import { fixtureSnapshot, FIXTURE_NOW } from "@awardgrid/core/test-fixtures/uiux/factory";
import type { StoragePort } from "@awardgrid/core/workspace/types";
import { SlotFileStorage } from "../workspace/slot-storage";
import { FAVORITES_NAMESPACE, FavoritesStore, favoriteFromSnapshot } from "./favorites-store";
import { MemoryFileStore } from "./persistence";

it("read-only restore does not write or perform a network refresh", async () => {
  const storage = { read: vi.fn(async () => ({ schemaVersion: 1, items: [] })), writeAtomically: vi.fn(), remove: vi.fn() };
  const store = new FavoritesStore(storage, () => "2026-10-18T08:30:00Z");
  await store.load();
  expect(store.all()).toEqual([]);
  expect(storage.writeAtomically).not.toHaveBeenCalled();
});

class MemoryStorage implements StoragePort {
  readonly values = new Map<string, unknown>();
  writes = 0;
  failWrites = false;
  async read(name: string) {
    return this.values.has(name) ? structuredClone(this.values.get(name)) : null;
  }
  async writeAtomically(name: string, value: unknown) {
    if (this.failWrites) throw new Error("disk full");
    this.writes += 1;
    this.values.set(name, structuredClone(value));
  }
  async remove(name: string) {
    this.values.delete(name);
  }
}

const now = () => FIXTURE_NOW;
const snap = (id: string) => fixtureSnapshot({ id });

describe("FavoritesStore", () => {
  it("saves the snapshot's query, rows and coverage, newest first, and reads them back after a cold start", async () => {
    const storage = new MemoryStorage();
    const store = new FavoritesStore(storage, now);
    await store.load();
    const a = await store.save(favoriteFromSnapshot(snap("s1"), now(), "fav-1"));
    const b = await store.save(favoriteFromSnapshot(snap("s2"), now(), "fav-2"));
    expect(a.ok && b.ok).toBe(true);
    expect(store.all().map((f) => f.id)).toEqual(["fav-2", "fav-1"]);
    const saved = store.all()[1]!;
    expect(saved).toMatchObject({ schemaVersion: 1, id: "fav-1", savedAt: FIXTURE_NOW, originalSnapshotId: "s1" });
    expect(saved.rows).toEqual(snap("s1").rows);
    expect(saved.query).toEqual(snap("s1").query);

    const cold = new FavoritesStore(storage, now);
    await cold.load();
    expect(cold.all().map((f) => f.id)).toEqual(["fav-2", "fav-1"]);
    // Nothing that is saved holds a key or secret-looking header.
    expect(JSON.stringify(storage.values.get(FAVORITES_NAMESPACE))).not.toMatch(/partner-authorization|x-api-key|sk-ant-|apiKey/i);
  });

  it("the same snapshot saved twice is one item, and says it was already saved", async () => {
    const store = new FavoritesStore(new MemoryStorage(), now);
    await store.load();
    await store.save(favoriteFromSnapshot(snap("s1"), now(), "fav-1"));
    const again = await store.save(favoriteFromSnapshot(snap("s1"), now(), "fav-2"));
    expect(again).toMatchObject({ ok: true, already: true, item: { id: "fav-1" } });
    expect(store.all()).toHaveLength(1);
  });

  it("at the item limit a new save is refused as 'capacity', nothing is written, and every item is kept", async () => {
    const storage = new MemoryStorage();
    const store = new FavoritesStore(storage, now, { maxItems: 2 });
    await store.load();
    await store.save(favoriteFromSnapshot(snap("s1"), now(), "fav-1"));
    await store.save(favoriteFromSnapshot(snap("s2"), now(), "fav-2"));
    const writes = storage.writes;
    expect(await store.save(favoriteFromSnapshot(snap("s3"), now(), "fav-3"))).toEqual({ ok: false, reason: "capacity" });
    expect(storage.writes).toBe(writes);
    expect(store.all().map((f) => f.id)).toEqual(["fav-2", "fav-1"]);
    expect(store.usage()).toMatchObject({ count: 2, maxItems: 2 });
  });

  it("over the size limit a new save is refused as 'capacity' too", async () => {
    const store = new FavoritesStore(new MemoryStorage(), now, { maxBytes: 3000 });
    await store.load();
    expect(await store.save(favoriteFromSnapshot(snap("s1"), now(), "fav-1"))).toEqual({ ok: false, reason: "capacity" });
    expect(store.all()).toEqual([]);
  });

  it("a failed write keeps the previous list, on disk and on screen, and says so", async () => {
    const storage = new MemoryStorage();
    const store = new FavoritesStore(storage, now);
    await store.load();
    await store.save(favoriteFromSnapshot(snap("s1"), now(), "fav-1"));
    storage.failWrites = true;
    expect(await store.save(favoriteFromSnapshot(snap("s2"), now(), "fav-2"))).toEqual({ ok: false, reason: "write_failed", message: "disk full" });
    expect(store.all().map((f) => f.id)).toEqual(["fav-1"]);
    expect(await store.remove("fav-1")).toEqual({ ok: false, reason: "write_failed", message: "disk full" });
    expect(store.all().map((f) => f.id)).toEqual(["fav-1"]);
    expect((storage.values.get(FAVORITES_NAMESPACE) as { items: unknown[] }).items).toHaveLength(1);
  });

  it("a deletion can be undone, back in its place; an undo after the item is saved again does nothing", async () => {
    const store = new FavoritesStore(new MemoryStorage(), now);
    await store.load();
    for (const id of ["s1", "s2", "s3"]) await store.save(favoriteFromSnapshot(snap(id), now(), `fav-${id}`));
    const removed = await store.remove("fav-s2");
    if (!removed.ok) throw new Error("not removed");
    expect(store.all().map((f) => f.id)).toEqual(["fav-s3", "fav-s1"]);
    expect(await store.undo(removed.undo)).toEqual({ ok: true });
    expect(store.all().map((f) => f.id)).toEqual(["fav-s3", "fav-s2", "fav-s1"]);
    expect(await store.undo(removed.undo)).toEqual({ ok: false, reason: "gone" });
  });

  it("an item this build cannot read is not shown, not lost: it is written back as it was, and counted", async () => {
    const storage = new MemoryStorage();
    const good = favoriteFromSnapshot(snap("s1"), now(), "fav-1");
    const broken = [{ schemaVersion: 1, id: "broken" }, "nonsense"];
    storage.values.set(FAVORITES_NAMESPACE, { schemaVersion: 1, items: [good, ...broken] });
    const store = new FavoritesStore(storage, now);
    expect(await store.load()).toEqual({ loaded: 1, dropped: 2, readOnly: false });
    expect(store.all().map((f) => f.id)).toEqual(["fav-1"]);
    expect(store.unreadableCount()).toBe(2);
    expect(store.usage().count).toBe(3);
    expect(storage.writes).toBe(0);
    // A change keeps them: two writes later (both slots rewritten on a device) they are still there.
    await store.save(favoriteFromSnapshot(snap("s2"), now(), "fav-2"));
    await store.remove("fav-1");
    const written = storage.values.get(FAVORITES_NAMESPACE) as { items: unknown[] };
    expect(written.items.slice(-2)).toEqual(broken);
  });

  it("over the storage the app uses: a file that cannot be read makes the store read-only, and nothing is written", async () => {
    const files = new MemoryFileStore();
    const slots = new SlotFileStorage(files);
    const first = new FavoritesStore(slots, now);
    await first.load();
    await first.save(favoriteFromSnapshot(snap("s1"), now(), "fav-1"));
    await first.save(favoriteFromSnapshot(snap("s2"), now(), "fav-2"));
    const before = new Map(files.files);
    const read = files.read.bind(files);
    files.read = async (path) => {
      if (path.startsWith(FAVORITES_NAMESPACE)) throw new Error("EIO");
      return read(path);
    };
    const store = new FavoritesStore(new SlotFileStorage(files), now);
    expect(await store.load()).toEqual({ loaded: 0, dropped: 0, readOnly: true });
    expect(await store.save(favoriteFromSnapshot(snap("s3"), now(), "fav-3"))).toEqual({ ok: false, reason: "read_only" });
    expect(files.files).toEqual(before);
    // Torn in both slots: the same.
    files.read = read;
    files.files.set(`${FAVORITES_NAMESPACE}.a.json`, '{"generation":1,"va');
    files.files.set(`${FAVORITES_NAMESPACE}.b.json`, '{"generation":2,"va');
    const torn = new FavoritesStore(new SlotFileStorage(files), now);
    expect(await torn.load()).toMatchObject({ readOnly: true });
  });

  it("a file from a newer version is left as it is: nothing shown is invented, and nothing is written over it", async () => {
    const storage = new MemoryStorage();
    storage.values.set(FAVORITES_NAMESPACE, { schemaVersion: 2, items: [{ anything: true }] });
    const store = new FavoritesStore(storage, now);
    expect(await store.load()).toEqual({ loaded: 0, dropped: 0, readOnly: true });
    expect(await store.save(favoriteFromSnapshot(snap("s1"), now(), "fav-1"))).toEqual({ ok: false, reason: "read_only" });
    expect(storage.values.get(FAVORITES_NAMESPACE)).toEqual({ schemaVersion: 2, items: [{ anything: true }] });
  });

  it("a storage that cannot be read gives an empty list and no write", async () => {
    const storage = { read: vi.fn(async () => Promise.reject(new Error("unreadable"))), writeAtomically: vi.fn(), remove: vi.fn() };
    const store = new FavoritesStore(storage, now);
    expect(await store.load()).toEqual({ loaded: 0, dropped: 0, readOnly: true });
    expect(store.all()).toEqual([]);
    expect(storage.writeAtomically).not.toHaveBeenCalled();
  });

  it("subscribers hear every change", async () => {
    const store = new FavoritesStore(new MemoryStorage(), now);
    await store.load();
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    await store.save(favoriteFromSnapshot(snap("s1"), now(), "fav-1"));
    await store.remove("fav-1");
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });
});
