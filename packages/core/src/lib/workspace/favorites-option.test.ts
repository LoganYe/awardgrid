/**
 * One option saved on its own (UI/UX v1 T18, the Web's "Save option"): the same option once, another option of the
 * same search as its own item, and an option the snapshot does not hold never saved.
 */
import { describe, expect, it } from "vitest";
import { fixtureSnapshot } from "../../../test/fixtures/uiux/factory";
import { FavoritesStore, favoriteFromOption, optionOrigin } from "./favorites-store";
import type { StoragePort } from "./types";

function memory(): StoragePort {
  const files = new Map<string, unknown>();
  return {
    read: async (name) => structuredClone(files.get(name) ?? null),
    writeAtomically: async (name, value) => void files.set(name, structuredClone(value)),
    remove: async (name) => void files.delete(name),
  };
}

describe("favoriteFromOption", () => {
  const snapshot = fixtureSnapshot();
  const [a, b] = snapshot.rows;

  it("keeps the query, the coverage and that one row, and names its origin", () => {
    const item = favoriteFromOption(snapshot, a!.key, "2026-10-18T12:00:00.000Z", "f1")!;
    expect(item).toMatchObject({ id: "f1", query: snapshot.query, coverage: snapshot.coverage, originalSnapshotId: optionOrigin(snapshot.id, a!.key) });
    expect(item.rows).toEqual([a]);
    expect(favoriteFromOption(snapshot, "not-a-row", "2026-10-18T12:00:00.000Z", "f2")).toBeNull();
  });

  it("the same option saves once; another option of the same search is its own item", async () => {
    const store = new FavoritesStore(memory(), () => "2026-10-18T12:00:00.000Z");
    await store.load();
    expect(await store.save(favoriteFromOption(snapshot, a!.key, "2026-10-18T12:00:00.000Z", "f1")!)).toMatchObject({ ok: true });
    expect(await store.save(favoriteFromOption(snapshot, a!.key, "2026-10-18T12:00:00.000Z", "f2")!)).toMatchObject({ ok: true, already: true });
    expect(await store.save(favoriteFromOption(snapshot, b!.key, "2026-10-18T12:00:00.000Z", "f3")!)).toMatchObject({ ok: true });
    expect(store.all().map((f) => f.id)).toEqual(["f3", "f1"]);
  });
});
