/**
 * The versioned workspace (plan 01 T05; acceptance A08): one query revision per run, only the matching run may
 * publish, a failure keeps the old query and data, view changes and history switches never fetch, and a restored
 * workspace never runs a query.
 */
import { describe, expect, it } from "vitest";
import { fixtureQuery, fixtureSnapshot, FIXTURE_NOW } from "@awardgrid/core/test-fixtures/uiux/factory";
import type { QueryObject } from "@awardgrid/core/query/schema";
import type { ResultSnapshot, SearchPort, SearchRun, StoragePort } from "@awardgrid/core/workspace/types";
import { SearchRunError, WORKSPACE_NAMESPACE, WorkspaceStore } from "./workspace-store";

/** A search port whose calls are resolved by the test, in any order. */
function manualPort() {
  const calls: Array<{ query: QueryObject; run: SearchRun; resolve: (s: ResultSnapshot) => void; reject: (e: unknown) => void }> = [];
  const search: SearchPort = {
    execute: (query, run) =>
      new Promise<ResultSnapshot>((resolve, reject) => {
        calls.push({ query, run, resolve, reject });
      }),
  };
  return { search, calls };
}

/** A snapshot answering one call: its revision and query are the call's. */
function answer(call: { query: QueryObject; run: { id: string; revision: number } }, id: string): ResultSnapshot {
  return fixtureSnapshot({ id, revision: call.run.revision, query: call.query });
}

class MemoryStorage implements StoragePort {
  readonly values = new Map<string, unknown>();
  writes: string[] = [];
  failWrites = false;
  async read(name: string) {
    return this.values.has(name) ? structuredClone(this.values.get(name)) : null;
  }
  async writeAtomically(name: string, value: unknown) {
    if (this.failWrites) throw new Error("disk full");
    this.writes.push(name);
    this.values.set(name, structuredClone(value));
  }
  async remove(name: string) {
    this.values.delete(name);
  }
}

const later = { ...fixtureQuery(), date_to: "2026-10-31" };

it("late response cannot replace a newer run", async () => {
  const pending: Array<(x: ResultSnapshot) => void> = [];
  const store = new WorkspaceStore({
    now: () => "2026-10-18T08:30:00Z",
    search: {
      execute: () => new Promise<ResultSnapshot>((resolve) => pending.push(resolve)),
    },
  });
  const first = store.run(fixtureSnapshot().query);
  const second = store.run({ ...fixtureSnapshot().query, date_to: "2026-10-31" });
  pending[1]!(fixtureSnapshot({ id: "second", revision: 2 }));
  await second;
  pending[0]!(fixtureSnapshot({ id: "first", revision: 1 }));
  await first;
  expect(store.getState().displayedSnapshot?.id).toBe("second");
});

it("each caller learns how its own run ended: published, failed, or superseded", async () => {
  const { search, calls } = manualPort();
  const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
  const a = store.run(fixtureQuery());
  const b = store.run(later);
  calls[1]!.resolve(answer(calls[1]!, "b"));
  calls[0]!.resolve(answer(calls[0]!, "a"));
  expect(await a).toMatchObject({ kind: "superseded", revision: 1 });
  expect(await b).toMatchObject({ kind: "published", revision: 2, snapshotId: "b" });
  const c = store.run(later);
  calls[2]!.reject(new SearchRunError("quota"));
  expect(await c).toMatchObject({ kind: "failed", revision: 3, code: "quota" });
  expect(store.history().map((s) => s.id)).toEqual(["b"]);
});

describe("WorkspaceStore runs", () => {
  it("each run takes the next revision and is handed its own id and revision", async () => {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    expect(store.getState().revision).toBe(0);
    expect(store.getState().run).toEqual({ kind: "idle" });
    const done = store.run(fixtureQuery());
    expect(store.getState().revision).toBe(1);
    const run = store.getState().run;
    expect(run.kind).toBe("running");
    if (run.kind !== "running") return;
    expect(calls[0]!.run).toMatchObject({ id: run.runId, revision: 1 });
    expect(run.startedAt).toBe(FIXTURE_NOW);
    calls[0]!.resolve(answer(calls[0]!, "s1"));
    await done;
    expect(store.getState().run).toEqual({ kind: "finished", runId: run.runId, revision: 1, snapshotId: "s1" });
    expect(store.getState().displayedSnapshot?.id).toBe("s1");
  });

  it("a failed new run keeps the old snapshot and its query, and says which run failed", async () => {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    const a = store.run(fixtureQuery());
    calls[0]!.resolve(answer(calls[0]!, "old"));
    await a;
    const b = store.run(later);
    calls[1]!.reject(new SearchRunError("network", "stopped waiting"));
    await b;
    const state = store.getState();
    expect(state.displayedSnapshot?.id).toBe("old");
    expect(state.displayedSnapshot?.query.date_to).toBe(fixtureQuery().date_to);
    expect(state.run).toMatchObject({ kind: "failed", revision: 2, code: "network" });
    expect(state.revision).toBe(2);
  });

  it("an unexpected error is a failure with code internal, never a throw at the caller", async () => {
    const store = new WorkspaceStore({ search: { execute: async () => Promise.reject(new TypeError("boom")) }, now: () => FIXTURE_NOW });
    await expect(store.run(fixtureQuery())).resolves.toMatchObject({ kind: "failed", code: "internal" });
    expect(store.getState().run).toMatchObject({ kind: "failed", code: "internal" });
  });

  it("a late failure of an older run does not mark the newer run failed", async () => {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    const a = store.run(fixtureQuery());
    const b = store.run(later);
    calls[0]!.reject(new SearchRunError("seatsaero", "500"));
    await a;
    expect(store.getState().run).toMatchObject({ kind: "running", revision: 2 });
    calls[1]!.resolve(answer(calls[1]!, "new"));
    await b;
    expect(store.getState().run).toMatchObject({ kind: "finished", revision: 2, snapshotId: "new" });
  });

  it("a snapshot stamped with another revision is refused, not shown", async () => {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    const a = store.run(fixtureQuery());
    calls[0]!.resolve(fixtureSnapshot({ id: "wrong", revision: 7 }));
    await a;
    expect(store.getState().displayedSnapshot).toBeNull();
    expect(store.getState().run).toMatchObject({ kind: "failed", code: "invalid_snapshot" });
  });

  it("an invalid QueryObject makes no search call and fails as invalid_query", async () => {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    await store.run({ ...fixtureQuery(), date_from: "2026-02-30" } as QueryObject);
    await store.run({ ...fixtureQuery(), origins: [] } as QueryObject);
    expect(calls).toHaveLength(0);
    expect(store.getState().run).toMatchObject({ kind: "failed", code: "invalid_query" });
    expect(store.getState().displayedSnapshot).toBeNull();
  });
});

describe("WorkspaceStore run handles", () => {
  it("hands the port the caller's meta, and aborts a run's signal as soon as a newer run starts", async () => {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    const a = store.run(fixtureQuery(), { text: "first" });
    expect(calls[0]!.run.meta).toEqual({ text: "first" });
    expect(calls[0]!.run.signal?.aborted).toBe(false);
    const b = store.run(later);
    expect(calls[0]!.run.signal?.aborted).toBe(true);
    expect(calls[1]!.run.signal?.aborted).toBe(false);
    calls[0]!.reject(new SearchRunError("superseded"));
    calls[1]!.resolve(answer(calls[1]!, "b"));
    expect(await a).toMatchObject({ kind: "superseded" });
    expect(await b).toMatchObject({ kind: "published" });
    expect(store.getState().run).toMatchObject({ kind: "finished", revision: 2 });
  });
});

describe("WorkspaceStore history and view state", () => {
  async function withTwo() {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    const a = store.run(fixtureQuery());
    calls[0]!.resolve(answer(calls[0]!, "first"));
    await a;
    const b = store.run(later);
    calls[1]!.resolve(answer(calls[1]!, "second"));
    await b;
    return { store, calls };
  }

  it("a new snapshot moves the shown one to previous", async () => {
    const { store } = await withTwo();
    expect(store.getState().displayedSnapshot?.id).toBe("second");
    expect(store.getState().previousSnapshot?.id).toBe("first");
  });

  it("going back to an earlier snapshot only changes what is shown: no request, no new revision", async () => {
    const { store, calls } = await withTwo();
    const revision = store.getState().revision;
    store.showSnapshot("first");
    expect(store.getState().displayedSnapshot?.id).toBe("first");
    expect(store.getState().previousSnapshot?.id).toBe("second");
    expect(store.getState().revision).toBe(revision);
    expect(calls).toHaveLength(2);
    expect(() => store.showSnapshot("never-existed")).toThrow(/unknown snapshot/i);
    expect(store.getState().displayedSnapshot?.id).toBe("first");
  });

  it("changing the view, sort or local filter never fetches", async () => {
    const { store, calls } = await withTwo();
    store.setPreferences({ kind: "calendar" });
    store.setPreferences({ sort: "date_asc", localFilter: { maxMiles: 80000 } });
    expect(store.getState().preferences).toMatchObject({ kind: "calendar", sort: "date_asc", localFilter: { maxMiles: 80000 } });
    expect(calls).toHaveLength(2);
  });

  it("a search that asks for a sort sets the view's sort; one that does not keeps the sort chosen (U-030)", async () => {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    store.setPreferences({ sort: "seats_desc" });
    const plain = store.run(fixtureQuery());
    calls[0]!.resolve(answer(calls[0]!, "plain"));
    await plain;
    expect(store.getState().preferences.sort).toBe("seats_desc");
    const byFees = store.run({ ...fixtureQuery(), sort_by: "fees_asc" });
    calls[1]!.resolve(answer(calls[1]!, "fees"));
    await byFees;
    expect(store.getState().preferences.sort).toBe("fees_asc");
    // A failed or superseded run changes nothing.
    const failed = store.run({ ...fixtureQuery(), sort_by: "date_asc" });
    calls[2]!.reject(new SearchRunError("quota"));
    await failed;
    expect(store.getState().preferences.sort).toBe("fees_asc");
    const superseded = store.run({ ...fixtureQuery(), sort_by: "date_asc" });
    const newer = store.run(fixtureQuery());
    calls[4]!.resolve(answer(calls[4]!, "newer"));
    calls[3]!.resolve(answer(calls[3]!, "late"));
    expect(await superseded).toMatchObject({ kind: "superseded" });
    await newer;
    expect(store.getState().preferences.sort).toBe("fees_asc");
  });

  it("running the same search again keeps the sort the user chose after it (U-030)", async () => {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    const typed = store.run({ ...fixtureQuery(), sort_by: "fees_asc" });
    calls[0]!.resolve(answer(calls[0]!, "fees"));
    await typed;
    expect(store.getState().preferences.sort).toBe("fees_asc");
    store.setPreferences({ sort: "seats_desc" });
    // Search again re-reads the same words, which still ask for the fee order the search on screen asked for.
    const again = store.run({ ...fixtureQuery(), sort_by: "fees_asc" });
    calls[1]!.resolve(answer(calls[1]!, "again"));
    await again;
    expect(store.getState().preferences.sort).toBe("seats_desc");
  });

  it("subscribers hear every change, and an unsubscribed listener hears nothing", async () => {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    let heard = 0;
    const off = store.subscribe(() => heard++);
    const a = store.run(fixtureQuery());
    calls[0]!.resolve(answer(calls[0]!, "s"));
    await a;
    expect(heard).toBe(2);
    off();
    store.setPreferences({ kind: "matrix" });
    expect(heard).toBe(2);
  });

  it("under the size limit it drops the previous snapshot too, but never the shown one", async () => {
    const { search, calls } = manualPort();
    const one = JSON.stringify(fixtureSnapshot({ id: "x" })).length;
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW, limits: { maxBytes: Math.floor(one * 1.5) } });
    for (const id of ["a", "b", "c"]) {
      const done = store.run(fixtureQuery());
      calls.at(-1)!.resolve(answer(calls.at(-1)!, id));
      await done;
    }
    expect(store.history().map((s) => s.id)).toEqual(["c"]);
    expect(store.getState().displayedSnapshot?.id).toBe("c");
    expect(store.getState().previousSnapshot).toBeNull();
    // A single snapshot larger than the limit stays while it is shown.
    const port = manualPort();
    const alone = new WorkspaceStore({ search: port.search, now: () => FIXTURE_NOW, limits: { maxBytes: 10 } });
    const done = alone.run(fixtureQuery());
    port.calls[0]!.resolve(answer(port.calls[0]!, "big"));
    await done;
    expect(alone.history().map((s) => s.id)).toEqual(["big"]);
  });

  it("keeps at most ten snapshots, dropping the oldest that is neither shown nor previous", async () => {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    for (let i = 1; i <= 12; i++) {
      const done = store.run(fixtureQuery());
      calls[i - 1]!.resolve(answer(calls[i - 1]!, `s${i}`));
      await done;
    }
    const ids = store.history().map((s) => s.id);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain("s1");
    expect(ids).not.toContain("s2");
    expect(ids).toContain("s12");
    expect(ids).toContain("s11");
  });
});

describe("WorkspaceStore selection (T12)", () => {
  async function runs(n: number) {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    for (let i = 1; i <= n; i++) {
      const done = store.run(fixtureQuery());
      calls[i - 1]!.resolve(answer(calls[i - 1]!, `s${i}`));
      await done;
    }
    return store;
  }

  it("four at most: a fifth is refused and nothing is swapped out; choosing one again clears it", async () => {
    // Two snapshots: four options chosen from the first, the fifth tried from the second.
    const store = await runs(2);
    const rows = store.history().find((x) => x.id === "s1")!.rows;
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows.slice(0, 4)) expect(store.setSelected({ snapshotId: "s1", rowKey: row.key }, true)).toEqual({ ok: true });
    const four = store.getState().selected;
    expect(store.setSelected({ snapshotId: "s2", rowKey: rows[0]!.key }, true)).toEqual({ ok: false, reason: "limit" });
    expect(store.getState().selected).toEqual(four);
    store.setSelected({ snapshotId: "s1", rowKey: rows[0]!.key }, false);
    expect(store.getState().selected.map((r) => r.rowKey)).toEqual(rows.slice(1, 4).map((r) => r.key));
    store.clearSelection();
    expect(store.getState().selected).toEqual([]);
  });

  it("a reference to no kept row cannot be chosen", async () => {
    const store = await runs(1);
    expect(store.setSelected({ snapshotId: "s1", rowKey: "not-a-row" }, true)).toEqual({ ok: false, reason: "unknown" });
    expect(store.setSelected({ snapshotId: "nope", rowKey: store.getState().displayedSnapshot!.rows[0]!.key }, true)).toEqual({ ok: false, reason: "unknown" });
    expect(store.getState().selected).toEqual([]);
  });

  it("a newer search keeps the chosen reference to its own snapshot, and the same row in the new one is another option", async () => {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    const a = store.run(fixtureQuery());
    calls[0]!.resolve(answer(calls[0]!, "s1"));
    await a;
    const key = store.getState().displayedSnapshot!.rows[0]!.key;
    store.setSelected({ snapshotId: "s1", rowKey: key }, true);
    const b = store.run(fixtureQuery());
    calls[1]!.resolve(answer(calls[1]!, "s2"));
    await b;
    // The new snapshot has the same row; the choice still names s1 and is read from s1.
    expect(store.getState().displayedSnapshot!.rows.some((r) => r.key === key)).toBe(true);
    expect(store.getState().selected).toEqual([{ snapshotId: "s1", rowKey: key }]);
    expect(store.selectionEntries()[0]).toMatchObject({ source: "snapshot", ref: { snapshotId: "s1", rowKey: key } });
    // Choosing the same row in s2 adds a second option; it does not replace the first.
    store.setSelected({ snapshotId: "s2", rowKey: key }, true);
    expect(store.getState().selected).toEqual([
      { snapshotId: "s1", rowKey: key },
      { snapshotId: "s2", rowKey: key },
    ]);
  });

  it("once its snapshot is evicted, a chosen option is read from the copy kept when it was chosen", async () => {
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW });
    const first = store.run(fixtureQuery());
    calls[0]!.resolve(answer(calls[0]!, "s1"));
    await first;
    const chosen = store.getState().displayedSnapshot!.rows[1]!;
    store.setSelected({ snapshotId: "s1", rowKey: chosen.key }, true);
    for (let i = 2; i <= 12; i++) {
      const done = store.run(fixtureQuery());
      calls[i - 1]!.resolve(answer(calls[i - 1]!, `s${i}`));
      await done;
    }
    expect(store.history().map((s) => s.id)).not.toContain("s1");
    const [entry] = store.selectionEntries();
    expect(entry).toMatchObject({ source: "kept_copy", ref: { snapshotId: "s1", rowKey: chosen.key } });
    expect(entry!.row).toEqual(chosen);
    // Choosing and clearing never ran a search: the twelve calls are the twelve runs.
    store.clearSelection();
    expect(store.selectionEntries()).toEqual([]);
    expect(calls).toHaveLength(12);
  });
});

describe("WorkspaceStore persistence", () => {
  async function persisted() {
    const storage = new MemoryStorage();
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW, storage });
    const a = store.run(fixtureQuery());
    calls[0]!.resolve(answer(calls[0]!, "kept"));
    await a;
    store.setPreferences({ kind: "calendar" });
    expect(await store.persist()).toEqual({ ok: true });
    return storage;
  }

  it("writes only its own versioned namespace", async () => {
    const storage = await persisted();
    expect(WORKSPACE_NAMESPACE).toBe("workspace-v1");
    expect(new Set(storage.writes)).toEqual(new Set([WORKSPACE_NAMESPACE]));
  });

  it("restoring shows the saved snapshot and preferences and never runs a query", async () => {
    const storage = await persisted();
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW, storage });
    await store.restore();
    expect(calls).toHaveLength(0);
    expect(store.getState().displayedSnapshot?.id).toBe("kept");
    expect(store.getState().preferences.kind).toBe("calendar");
    expect(store.getState().run).toEqual({ kind: "idle" });
  });

  it("a restored run continues the revision count, so an old response can never match a new run", async () => {
    const storage = await persisted();
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW, storage });
    await store.restore();
    const done = store.run(later);
    expect(calls[0]!.run.revision).toBeGreaterThan(1);
    calls[0]!.resolve(answer(calls[0]!, "next"));
    await done;
    expect(store.getState().displayedSnapshot?.id).toBe("next");
  });

  it("restored coverage is re-derived, never trusted: a 'complete' claim for another scope becomes unknown", async () => {
    const storage = await persisted();
    const saved = (await storage.read(WORKSPACE_NAMESPACE)) as { snapshots: ResultSnapshot[] };
    saved.snapshots[0]!.coverage.scopeKey = "v1|forged";
    await storage.writeAtomically(WORKSPACE_NAMESPACE, saved);
    const store = new WorkspaceStore({ search: manualPort().search, now: () => FIXTURE_NOW, storage });
    await store.restore();
    expect(store.getState().displayedSnapshot?.coverage.state).toBe("unknown");
  });

  it("a snapshot whose creation time is not a real instant is dropped, not restored", async () => {
    const storage = await persisted();
    const saved = (await storage.read(WORKSPACE_NAMESPACE)) as { snapshots: Array<{ createdAt: string }> };
    saved.snapshots[0]!.createdAt = "yesterday";
    await storage.writeAtomically(WORKSPACE_NAMESPACE, saved);
    const store = new WorkspaceStore({ search: manualPort().search, now: () => FIXTURE_NOW, storage });
    expect(await store.restore()).toEqual({ restored: 0, dropped: 1 });
    expect(store.getState().displayedSnapshot).toBeNull();
  });

  it("knows which snapshots came back from disk", async () => {
    const storage = await persisted();
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW, storage });
    await store.restore();
    expect(store.wasRestored("kept")).toBe(true);
    const done = store.run(later);
    calls[0]!.resolve(answer(calls[0]!, "fresh"));
    await done;
    expect(store.wasRestored("fresh")).toBe(false);
  });

  it("a damaged or foreign file restores as an empty workspace, without throwing and without a query", async () => {
    for (const junk of [null, 42, "x", { schemaVersion: 99 }, { schemaVersion: 1, snapshots: "nope" }, { schemaVersion: 1, snapshots: [{ id: 1 }] }]) {
      const storage = new MemoryStorage();
      storage.values.set(WORKSPACE_NAMESPACE, junk);
      const { search, calls } = manualPort();
      const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW, storage });
      await expect(store.restore()).resolves.toBeDefined();
      expect(store.getState().displayedSnapshot).toBeNull();
      expect(calls).toHaveLength(0);
    }
  });

  it("a failed write is reported, keeps the last good version, and does not change what is shown", async () => {
    const storage = await persisted();
    const before = structuredClone(storage.values.get(WORKSPACE_NAMESPACE));
    const { search, calls } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW, storage });
    await store.restore();
    const done = store.run(later);
    calls[0]!.resolve(answer(calls[0]!, "unsaved"));
    await done;
    storage.failWrites = true;
    const result = await store.persist();
    expect(result).toMatchObject({ ok: false });
    expect(storage.values.get(WORKSPACE_NAMESPACE)).toEqual(before);
    expect(store.getState().displayedSnapshot?.id).toBe("unsaved");
  });

  it("writes nothing when nothing that is saved has changed since the last save or restore", async () => {
    const storage = await persisted();
    const writes = storage.writes.length;
    const { search } = manualPort();
    const store = new WorkspaceStore({ search, now: () => FIXTURE_NOW, storage });
    expect(await store.persist()).toEqual({ ok: true });
    await store.restore();
    expect(await store.persist()).toEqual({ ok: true });
    expect(storage.writes).toHaveLength(writes);
    store.setPreferences({ kind: "matrix" });
    await store.persist();
    expect(storage.writes).toHaveLength(writes + 1);
    await store.persist();
    expect(storage.writes).toHaveLength(writes + 1);
  });

  it("after a failed write the next save tries again", async () => {
    const storage = await persisted();
    const store = new WorkspaceStore({ search: manualPort().search, now: () => FIXTURE_NOW, storage });
    await store.restore();
    store.setPreferences({ kind: "matrix" });
    storage.failWrites = true;
    expect(await store.persist()).toMatchObject({ ok: false });
    storage.failWrites = false;
    const writes = storage.writes.length;
    expect(await store.persist()).toEqual({ ok: true });
    expect(storage.writes).toHaveLength(writes + 1);
  });

  it("the saved file holds no key or secret-looking header", async () => {
    const storage = await persisted();
    const text = JSON.stringify(storage.values.get(WORKSPACE_NAMESPACE));
    expect(text).not.toMatch(/partner-authorization|x-api-key|pro_|sk-ant/i);
  });
});
