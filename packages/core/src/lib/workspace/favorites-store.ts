/**
 * Saved snapshots — "Saved" (UI/UX v1 T13; docs/02 D04; docs/03 FavoriteV1; docs/04 S06; acceptance A23).
 *
 * A favourite is a copy of what a search showed when it was saved: its query, its rows and their coverage evidence, the
 * time it was saved and the snapshot it came from. It is not a booking, and it is not kept up to date: opening one
 * reads it from this device and fetches nothing, and a new search from it is the person's explicit choice elsewhere.
 * Because it is a copy, the workspace evicting its snapshot never breaks it.
 *
 *   - **Own namespace** (`favorites-v1`), written whole through the two-slot atomic storage (workspace/slot-storage):
 *     a failed or torn write leaves the previous list readable. A change is shown only after it is written.
 *   - **Limits** (D04: 100 items, 5 MiB of JSON): a save that would pass either is refused as "capacity", and nothing
 *     already saved is dropped or overwritten to make room.
 *   - **Loading never writes, and nothing it cannot read is lost.** An item this build cannot read (damaged, or
 *     written by another build) is not shown, and is carried unchanged in every later write, counted against the
 *     limits; the screen says how many there are. A whole file from a newer version, or one that cannot be read at
 *     all (the storage says so; it never passes an unreadable file off as absent), makes the store read-only: nothing
 *     is shown from it and nothing is written over it.
 *   - **Deleting can be undone** (the screen offers it for 5 seconds): the item goes back in its place.
 *   - Nothing saved holds a key, a header or a prompt: only what the results showed.
 *   - **Short-term caching** (the iOS OAuth flavour, where seats.aero's results may be kept for 24 hours at most):
 *     `removeRows` takes the rows out of the items a rule names, keeping each one's query, saved time, origin and how
 *     many options it showed (`rowsRemoved`); `replaceRows` puts fresh rows from a search of the item's own query back.
 *     Neither is used where no such limit applies, and an item without `rowsRemoved` reads exactly as before.
 */
import { QueryObject } from "../query/schema";
import { restoreCoverage } from "./coverage";
import { scopeKey } from "./identity";
import { isRealDate, parseInstant } from "./semantics";
import type { FavoriteV1, ResultSnapshot, StoragePort } from "./types";
import { isWorkspaceRow } from "./workspace-store";

export const FAVORITES_NAMESPACE = "favorites-v1";

/** docs/02 D04: engineering defaults, adjustable here, not a claim about the design. */
export const FAVORITES_LIMITS = { maxItems: 100, maxBytes: 5 * 1024 * 1024 } as const;

export type FavoriteWrite =
  | { ok: true; item: FavoriteV1; already?: true }
  | { ok: false; reason: "capacity" | "read_only" }
  | { ok: false; reason: "write_failed"; message: string };

export type FavoriteRemoval = { ok: true; undo: string } | { ok: false; reason: "unknown" | "read_only" } | { ok: false; reason: "write_failed"; message: string };
export type FavoriteUndo = { ok: true } | { ok: false; reason: "gone" | "capacity" | "read_only" } | { ok: false; reason: "write_failed"; message: string };
export type FavoriteRowsRemoval = { ok: true; removed: number } | { ok: false; reason: "read_only" } | { ok: false; reason: "write_failed"; message: string };
export type FavoriteRowsReplacement = { ok: true; item: FavoriteV1 } | { ok: false; reason: "unknown" | "read_only" | "capacity" | "mismatch" } | { ok: false; reason: "write_failed"; message: string };

export interface FavoritesLoad {
  loaded: number;
  dropped: number;
  /** A newer version's file, or one that could not be read: shown as empty and never written over. */
  readOnly: boolean;
}

/** A favourite of the snapshot on screen: a copy of its query, rows and coverage. */
export function favoriteFromSnapshot(snapshot: ResultSnapshot, savedAt: string, id: string): FavoriteV1 {
  return structuredClone({
    schemaVersion: 1 as const,
    id,
    savedAt,
    query: snapshot.query,
    rows: snapshot.rows,
    coverage: snapshot.coverage,
    originalSnapshotId: snapshot.id,
  });
}

/**
 * T18: one option saved on its own (the Web's "Save option"): the snapshot's query and coverage, with that one row.
 * Its origin names the snapshot and the row together, so the same option is saved once (`save` dedupes on it), and a
 * different option from the same search is its own item. Null when the snapshot has no such row.
 */
export function favoriteFromOption(snapshot: ResultSnapshot, rowKey: string, savedAt: string, id: string): FavoriteV1 | null {
  const row = snapshot.rows.find((r) => r.key === rowKey);
  if (!row) return null;
  return structuredClone({
    schemaVersion: 1 as const,
    id,
    savedAt,
    query: snapshot.query,
    rows: [row],
    coverage: snapshot.coverage,
    originalSnapshotId: optionOrigin(snapshot.id, rowKey),
  });
}

/** Where a saved option came from: its snapshot and row (favoriteFromOption). */
export function optionOrigin(snapshotId: string, rowKey: string): string {
  return `${snapshotId}#${rowKey}`;
}

/**
 * Which option a saved option is (program, route, day and cabin), read from its origin's row key (identity.ts rowKey:
 * digest~program~source~origin~dest~date~cabin~scope), so it can be named and found again once its row is removed.
 * Null for a saved search, or an origin that is not one.
 */
export function savedOptionIdentity(item: Pick<FavoriteV1, "originalSnapshotId">): { program: string; origin: string; dest: string; date: string; cabin: string } | null {
  const hash = item.originalSnapshotId.indexOf("#");
  if (hash < 0) return null;
  const parts = item.originalSnapshotId.slice(hash + 1).split("~");
  if (parts.length !== 8) return null;
  try {
    const [, program, , origin, dest, date, cabin] = parts.map((p) => decodeURIComponent(p)) as [string, string, string, string, string, string, string, string];
    return isRealDate(date) && /^[YWJF]$/.test(cabin) ? { program, origin, dest, date, cabin } : null;
  } catch {
    return null;
  }
}

/**
 * A favourite read back as the snapshot it copied, so it is shown and counted exactly as the Search screen showed it
 * (core `projectResults`: only the rows the query asked for, in its order).
 */
export function favoriteSnapshot(item: FavoriteV1): ResultSnapshot {
  return {
    schemaVersion: 1,
    id: item.originalSnapshotId,
    revision: 0,
    query: item.query,
    scopeKey: scopeKey(item.query),
    createdAt: item.savedAt,
    rows: item.rows,
    coverage: item.coverage,
    receipt: { sentCalls: null, fromCache: false },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A saved favourite, re-checked field by field; null if any part is unreadable. Coverage is re-derived, never trusted. */
function readFavorite(value: unknown): FavoriteV1 | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  if (typeof value.id !== "string" || value.id === "" || typeof value.originalSnapshotId !== "string") return null;
  if (typeof value.savedAt !== "string" || parseInstant(value.savedAt) === null) return null;
  const query = QueryObject.safeParse(value.query);
  if (!query.success || !isRealDate(query.data.date_from) || !isRealDate(query.data.date_to)) return null;
  if (!Array.isArray(value.rows) || !value.rows.every(isWorkspaceRow)) return null;
  const removed = readRowsRemoved(value.rowsRemoved);
  return {
    schemaVersion: 1,
    id: value.id,
    savedAt: value.savedAt,
    query: query.data,
    rows: removed ? [] : value.rows,
    coverage: restoreCoverage(removed ? null : value.coverage, scopeKey(query.data)),
    originalSnapshotId: value.originalSnapshotId,
    ...(removed ? { rowsRemoved: removed } : {}),
  };
}

/** A saved `rowsRemoved`, or null when absent or not one (the item is then read as it is). */
function readRowsRemoved(value: unknown): { at: string; options: number } | null {
  if (!isRecord(value) || typeof value.at !== "string" || parseInstant(value.at) === null) return null;
  return Number.isSafeInteger(value.options) && (value.options as number) >= 0 ? { at: value.at, options: value.options as number } : null;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message || err.name : String(err));

export class FavoritesStore {
  readonly #storage: StoragePort;
  readonly #now: () => string;
  readonly #limits: { maxItems: number; maxBytes: number };
  readonly #listeners = new Set<() => void>();
  /** Newest first. What is on disk, or what was loaded from it. */
  #items: FavoriteV1[] = [];
  /** Saved items this build could not read: never shown, never dropped, written back as they were. */
  #unreadable: unknown[] = [];
  #readOnly = false;
  /** Removed items that can still come back, by undo token. */
  readonly #removed = new Map<string, { item: FavoriteV1; index: number }>();
  #queue: Promise<unknown> = Promise.resolve();
  #tokens = 0;
  #bytes = 0;
  #bytesFor: FavoriteV1[] | null = null;

  constructor(storage: StoragePort, now: () => string, limits: Partial<{ maxItems: number; maxBytes: number }> = {}) {
    this.#storage = storage;
    this.#now = now;
    this.#limits = { ...FAVORITES_LIMITS, ...limits };
  }

  /** Read the saved list, once, at launch. Never writes, never fetches, never throws. */
  async load(): Promise<FavoritesLoad> {
    let raw: unknown;
    try {
      raw = await this.#storage.read(FAVORITES_NAMESPACE);
    } catch {
      this.#readOnly = true;
      return { loaded: 0, dropped: 0, readOnly: true };
    }
    if (raw === null || raw === undefined) return { loaded: 0, dropped: 0, readOnly: false };
    if (!isRecord(raw) || typeof raw.schemaVersion !== "number" || raw.schemaVersion !== 1 || !Array.isArray(raw.items)) {
      // Not a list this version can read (a newer version's, or something else): left untouched.
      this.#readOnly = true;
      return { loaded: 0, dropped: 0, readOnly: true };
    }
    const items: FavoriteV1[] = [];
    const unreadable: unknown[] = [];
    for (const candidate of raw.items) {
      const item = readFavorite(candidate);
      if (item && !items.some((i) => i.id === item.id)) items.push(item);
      else unreadable.push(candidate);
    }
    this.#items = items;
    this.#unreadable = unreadable;
    const dropped = unreadable.length;
    this.#notify();
    return { loaded: items.length, dropped, readOnly: false };
  }

  /** Newest first. The same array until something changes, and bound, so a screen can pass it to useSyncExternalStore. */
  readonly all = (): readonly FavoriteV1[] => this.#items;

  get(id: string): FavoriteV1 | null {
    return this.#items.find((f) => f.id === id) ?? null;
  }

  /** The saved snapshot of this search, if it is saved. */
  forSnapshot(snapshotId: string): FavoriteV1 | null {
    return this.#items.find((f) => f.originalSnapshotId === snapshotId) ?? null;
  }

  isReadOnly(): boolean {
    return this.#readOnly;
  }

  /** Saved items this build could not read, kept as they are. */
  unreadableCount(): number {
    return this.#unreadable.length;
  }

  /** How much of the store is used. The size is measured once per change, not on every read (it can be 5 MiB). */
  usage(): { count: number; maxItems: number; bytes: number; maxBytes: number } {
    if (this.#bytesFor !== this.#items) {
      this.#bytes = this.#encodedBytes(this.#items);
      this.#bytesFor = this.#items;
    }
    return { count: this.#items.length + this.#unreadable.length, maxItems: this.#limits.maxItems, bytes: this.#bytes, maxBytes: this.#limits.maxBytes };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Save a favourite, newest first. The same snapshot saved again is the one item already there. */
  save(favorite: FavoriteV1): Promise<FavoriteWrite> {
    return this.#serial(async (): Promise<FavoriteWrite> => {
      if (this.#readOnly) return { ok: false, reason: "read_only" };
      const existing = this.forSnapshot(favorite.originalSnapshotId);
      if (existing) return { ok: true, item: existing, already: true };
      const next = [favorite, ...this.#items];
      if (!this.#fits(next)) return { ok: false, reason: "capacity" };
      const written = await this.#write(next);
      return written.ok ? { ok: true, item: favorite } : written;
    });
  }

  /** Delete one. It can be put back with `undo(token)` until it is saved again some other way. */
  remove(id: string): Promise<FavoriteRemoval> {
    return this.#serial(async (): Promise<FavoriteRemoval> => {
      if (this.#readOnly) return { ok: false, reason: "read_only" };
      const index = this.#items.findIndex((f) => f.id === id);
      if (index < 0) return { ok: false, reason: "unknown" };
      const item = this.#items[index]!;
      const written = await this.#write(this.#items.filter((f) => f.id !== id));
      if (!written.ok) return written;
      this.#tokens += 1;
      const token = `undo-${this.#tokens}`;
      this.#removed.set(token, { item, index });
      return { ok: true, undo: token };
    });
  }

  /** Put a deleted item back in its place. Once, and only if it is not saved again already. */
  undo(token: string): Promise<FavoriteUndo> {
    return this.#serial(async (): Promise<FavoriteUndo> => {
      const removed = this.#removed.get(token);
      if (!removed || this.#items.some((f) => f.id === removed.item.id || f.originalSnapshotId === removed.item.originalSnapshotId)) {
        this.#removed.delete(token);
        return { ok: false, reason: "gone" };
      }
      if (this.#readOnly) return { ok: false, reason: "read_only" };
      const next = [...this.#items];
      next.splice(Math.min(removed.index, next.length), 0, removed.item);
      if (!this.#fits(next)) return { ok: false, reason: "capacity" };
      const written = await this.#write(next);
      if (!written.ok) return written;
      this.#removed.delete(token);
      return { ok: true };
    });
  }

  /** Forget an undo that is no longer offered (its 5 seconds are over). */
  forget(token: string): void {
    this.#removed.delete(token);
  }

  /**
   * Short-term caching: take the rows (and the coverage they proved) out of every item `expired` names, keeping its
   * query, saved time, origin and `options(item)`, the number of options it showed, as `rowsRemoved`. An item already
   * without rows is left as it is. One write for all of them; nothing changes in memory unless it succeeds. The undo
   * of a deletion still offered is forgotten for an item whose rows are removed, so it cannot bring them back.
   */
  removeRows(expired: (item: FavoriteV1) => boolean, at: string, options: (item: FavoriteV1) => number): Promise<FavoriteRowsRemoval> {
    return this.#serial(async (): Promise<FavoriteRowsRemoval> => {
      if (this.#readOnly) return { ok: false, reason: "read_only" };
      let removed = 0;
      const next = this.#items.map((item) => {
        if (item.rowsRemoved || item.rows.length === 0 || !expired(item)) return item;
        removed += 1;
        return { ...item, rows: [], coverage: restoreCoverage(null, scopeKey(item.query)), rowsRemoved: { at, options: Math.max(0, Math.trunc(options(item))) } };
      });
      for (const [token, entry] of this.#removed) if (expired(entry.item)) this.#removed.delete(token);
      if (removed === 0) return { ok: true, removed };
      const written = await this.#write(next);
      return written.ok ? { ok: true, removed } : written;
    });
  }

  /**
   * Short-term caching: fresh rows for one item from `snapshot`, a search of the item's own query (anything else is
   * refused as "mismatch"). Its rows and coverage become the snapshot's, `rowsRemoved` is cleared, and its id, saved
   * time, query and origin stay. A saved option keeps only the row for the same program, route, day and cabin, if the
   * search still has one.
   */
  replaceRows(id: string, snapshot: ResultSnapshot): Promise<FavoriteRowsReplacement> {
    return this.#serial(async (): Promise<FavoriteRowsReplacement> => {
      if (this.#readOnly) return { ok: false, reason: "read_only" };
      const index = this.#items.findIndex((f) => f.id === id);
      if (index < 0) return { ok: false, reason: "unknown" };
      const item = this.#items[index]!;
      if (snapshot.scopeKey !== scopeKey(item.query)) return { ok: false, reason: "mismatch" };
      const option = savedOptionIdentity(item);
      const rows = option
        ? snapshot.rows.filter((r) => r.value.program === option.program && r.value.origin === option.origin && r.value.dest === option.dest && r.value.date === option.date && r.value.cabin === option.cabin).slice(0, 1)
        : snapshot.rows;
      const { rowsRemoved: _removed, ...kept } = item;
      const fresh: FavoriteV1 = structuredClone({ ...kept, rows, coverage: snapshot.coverage });
      const next = this.#items.map((f, i) => (i === index ? fresh : f));
      if (!this.#fits(next)) return { ok: false, reason: "capacity" };
      const written = await this.#write(next);
      return written.ok ? { ok: true, item: fresh } : written;
    });
  }

  /** Which limit a list would pass, if any. The unreadable items count as well: they are written too. */
  #over(items: FavoriteV1[]): "items" | "bytes" | null {
    if (items.length + this.#unreadable.length > this.#limits.maxItems) return "items";
    if (this.#encodedBytes(items) > this.#limits.maxBytes) return "bytes";
    return null;
  }

  #fits(items: FavoriteV1[]): boolean {
    return this.#over(items) === null;
  }

  #encodedBytes(items: FavoriteV1[]): number {
    return new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, items: [...items, ...this.#unreadable] })).byteLength;
  }

  /** Write the whole list; publish it only once it is on disk. */
  async #write(items: FavoriteV1[]): Promise<{ ok: true } | { ok: false; reason: "write_failed"; message: string }> {
    try {
      await this.#storage.writeAtomically(FAVORITES_NAMESPACE, { schemaVersion: 1, items: [...items, ...this.#unreadable] });
    } catch (err) {
      return { ok: false, reason: "write_failed", message: errorText(err) };
    }
    this.#items = items;
    this.#notify();
    return { ok: true };
  }

  /** One change at a time, in order. */
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch {
        // One broken subscriber must not stop the others.
      }
    }
  }

  /** The clock, for ids and saved times made here. */
  now(): string {
    return this.#now();
  }
}
