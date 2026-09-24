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
 */
import { QueryObject } from "@awardgrid/core/query/schema";
import { restoreCoverage } from "@awardgrid/core/workspace/coverage";
import { scopeKey } from "@awardgrid/core/workspace/identity";
import { isRealDate, parseInstant } from "@awardgrid/core/workspace/semantics";
import type { FavoriteV1, ResultSnapshot, StoragePort } from "@awardgrid/core/workspace/types";
import { isWorkspaceRow } from "../workspace/workspace-store";

export const FAVORITES_NAMESPACE = "favorites-v1";

/** docs/02 D04: engineering defaults, adjustable here, not a claim about the design. */
export const FAVORITES_LIMITS = { maxItems: 100, maxBytes: 5 * 1024 * 1024 } as const;

export type FavoriteWrite =
  | { ok: true; item: FavoriteV1; already?: true }
  | { ok: false; reason: "capacity" | "read_only" }
  | { ok: false; reason: "write_failed"; message: string };

export type FavoriteRemoval = { ok: true; undo: string } | { ok: false; reason: "unknown" | "read_only" } | { ok: false; reason: "write_failed"; message: string };
export type FavoriteUndo = { ok: true } | { ok: false; reason: "gone" | "capacity" | "read_only" } | { ok: false; reason: "write_failed"; message: string };

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
  return {
    schemaVersion: 1,
    id: value.id,
    savedAt: value.savedAt,
    query: query.data,
    rows: value.rows,
    coverage: restoreCoverage(value.coverage, scopeKey(query.data)),
    originalSnapshotId: value.originalSnapshotId,
  };
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
