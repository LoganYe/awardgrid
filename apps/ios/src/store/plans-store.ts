/**
 * Saved trip plans (release plan step 18, the keyless planner): what a person typed, what the deterministic parser read
 * from it on the day it was read — airports, dates, cabins and the other conditions — and what the parser said about
 * it. A plan holds no results and no data from seats.aero: it is a search the person has not run, kept so it can be
 * run later through a connected account, or tried on sample data.
 *
 * The same rules as Saved results (core workspace/favorites-store.ts), on a smaller item:
 *
 *   - **Own namespace** (`plans-v1`), written whole through the two-slot atomic storage (../workspace/slot-storage.ts):
 *     a failed or torn write leaves the previous list readable. A change is shown only after it is written.
 *   - **Limits**: 100 plans (and 256 KiB of JSON, a guard against a pasted essay). A save that would pass either is
 *     refused as "capacity"; nothing already saved is dropped to make room.
 *   - **Loading never writes, and nothing it cannot read is lost.** A plan this build cannot read is not shown and is
 *     carried unchanged in every later write, counted against the limits. A whole file from a newer version, or one
 *     the storage cannot read, makes the store read-only.
 *   - **Deleting can be undone**: the plan goes back in its place.
 *   - **Sample mode has its own** (../sample/boot.ts): the services built over sample data store their plans under
 *     sample/, so the account's plans are not shown there and nothing saved there outlives leaving it.
 */
import { type Notice, isNotice } from "@awardgrid/core/notices";
import { QueryObject } from "@awardgrid/core/query/schema";
import { isRealDate, parseInstant } from "@awardgrid/core/workspace/semantics";
import type { StoragePort } from "@awardgrid/core/workspace/types";

export const PLANS_NAMESPACE = "plans-v1";

/** 100 plans, as the plan asks; the byte cap only stops one oversized text from filling the file. */
export const PLANS_LIMITS = { maxItems: 100, maxBytes: 256 * 1024 } as const;

export interface PlanV1 {
  schemaVersion: 1;
  id: string;
  /** When it was saved (an ISO instant). */
  savedAt: string;
  /** What the person typed. */
  text: string;
  /** What the parser read from it, on the day it was read. */
  query: QueryObject;
  /** What the parser said about it (a date range written end first, a range cut to 92 days, a start in the past…). */
  notices: Notice[];
}

/** A plan as the planner shows it before it is saved. */
export interface PlanDraft {
  text: string;
  query: QueryObject;
  notices: Notice[];
}

export type PlanWrite = { ok: true; item: PlanV1; already?: true } | { ok: false; reason: "capacity" | "read_only" } | { ok: false; reason: "write_failed"; message: string };
export type PlanRemoval = { ok: true; undo: string } | { ok: false; reason: "unknown" | "read_only" } | { ok: false; reason: "write_failed"; message: string };
export type PlanUndo = { ok: true } | { ok: false; reason: "gone" | "capacity" | "read_only" } | { ok: false; reason: "write_failed"; message: string };

export interface PlansLoad {
  loaded: number;
  dropped: number;
  readOnly: boolean;
}

/** A plan to save, from what the planner showed. A copy: changing the draft later does not change it. */
export function planFromDraft(draft: PlanDraft, savedAt: string, id: string): PlanV1 {
  return structuredClone({ schemaVersion: 1 as const, id, savedAt, text: draft.text.trim(), query: draft.query, notices: draft.notices });
}

/**
 * What makes two plans the same plan: the same words, read as the same search. The same words read on another day can
 * mean other dates ("next month"), and that is another plan.
 */
export function planIdentity(plan: Pick<PlanV1, "text" | "query">): string {
  const q = plan.query;
  const sorted = (list: readonly string[] | undefined) => [...(list ?? [])].sort();
  return JSON.stringify([
    plan.text.trim().replace(/\s+/g, " "),
    q.origins,
    q.destinations,
    q.date_from,
    q.date_to,
    sorted(q.cabins),
    sorted(q.programs),
    q.direct_only,
    q.include_filtered,
    q.min_cabin_pct,
    q.max_miles ?? null,
    q.sort_by,
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A saved plan, re-checked field by field; null if any part is unreadable. */
function readPlan(value: unknown): PlanV1 | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  if (typeof value.id !== "string" || value.id === "" || typeof value.text !== "string" || value.text.trim() === "") return null;
  if (typeof value.savedAt !== "string" || parseInstant(value.savedAt) === null) return null;
  const query = QueryObject.safeParse(value.query);
  if (!query.success || !isRealDate(query.data.date_from) || !isRealDate(query.data.date_to)) return null;
  if (!Array.isArray(value.notices) || !value.notices.every(isNotice)) return null;
  return { schemaVersion: 1, id: value.id, savedAt: value.savedAt, text: value.text, query: query.data, notices: value.notices };
}

const errorText = (err: unknown) => (err instanceof Error ? err.message || err.name : String(err));

export class PlansStore {
  readonly #storage: StoragePort;
  readonly #limits: { maxItems: number; maxBytes: number };
  readonly #listeners = new Set<() => void>();
  /** Newest first. */
  #items: PlanV1[] = [];
  /** Saved plans this build could not read: never shown, never dropped, written back as they were. */
  #unreadable: unknown[] = [];
  #readOnly = false;
  readonly #removed = new Map<string, { item: PlanV1; index: number }>();
  #queue: Promise<unknown> = Promise.resolve();
  #tokens = 0;

  constructor(storage: StoragePort, limits: Partial<{ maxItems: number; maxBytes: number }> = {}) {
    this.#storage = storage;
    this.#limits = { ...PLANS_LIMITS, ...limits };
  }

  /** Read the saved plans, once, at launch. Never writes, never fetches, never throws. */
  async load(): Promise<PlansLoad> {
    let raw: unknown;
    try {
      raw = await this.#storage.read(PLANS_NAMESPACE);
    } catch {
      this.#readOnly = true;
      this.#notify();
      return { loaded: 0, dropped: 0, readOnly: true };
    }
    if (raw === null || raw === undefined) return { loaded: 0, dropped: 0, readOnly: false };
    if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.items)) {
      // Not a list this version can read (a newer version's, or something else): left untouched.
      this.#readOnly = true;
      this.#notify();
      return { loaded: 0, dropped: 0, readOnly: true };
    }
    const items: PlanV1[] = [];
    const unreadable: unknown[] = [];
    for (const candidate of raw.items) {
      const item = readPlan(candidate);
      if (item && !items.some((i) => i.id === item.id)) items.push(item);
      else unreadable.push(candidate);
    }
    this.#items = items;
    this.#unreadable = unreadable;
    this.#notify();
    return { loaded: items.length, dropped: unreadable.length, readOnly: false };
  }

  /** Newest first. The same array until something changes, and bound, so a screen can pass it to useSyncExternalStore. */
  readonly all = (): readonly PlanV1[] => this.#items;

  get(id: string): PlanV1 | null {
    return this.#items.find((p) => p.id === id) ?? null;
  }

  isReadOnly(): boolean {
    return this.#readOnly;
  }

  /** Saved plans this build could not read, kept as they are. */
  unreadableCount(): number {
    return this.#unreadable.length;
  }

  /** How many plans are kept, the unreadable ones included, out of how many. */
  usage(): { count: number; maxItems: number } {
    return { count: this.#items.length + this.#unreadable.length, maxItems: this.#limits.maxItems };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Save a plan, newest first. The same plan saved again is the one already there. */
  save(plan: PlanV1): Promise<PlanWrite> {
    return this.#serial(async (): Promise<PlanWrite> => {
      if (this.#readOnly) return { ok: false, reason: "read_only" };
      const identity = planIdentity(plan);
      const existing = this.#items.find((p) => planIdentity(p) === identity);
      if (existing) return { ok: true, item: existing, already: true };
      const next = [plan, ...this.#items];
      if (!this.#fits(next)) return { ok: false, reason: "capacity" };
      const written = await this.#write(next);
      return written.ok ? { ok: true, item: plan } : written;
    });
  }

  /** Delete one. It can be put back with `undo(token)` until the same plan is saved again. */
  remove(id: string): Promise<PlanRemoval> {
    return this.#serial(async (): Promise<PlanRemoval> => {
      if (this.#readOnly) return { ok: false, reason: "read_only" };
      const index = this.#items.findIndex((p) => p.id === id);
      if (index < 0) return { ok: false, reason: "unknown" };
      const item = this.#items[index]!;
      const written = await this.#write(this.#items.filter((p) => p.id !== id));
      if (!written.ok) return written;
      this.#tokens += 1;
      const token = `plan-undo-${this.#tokens}`;
      this.#removed.set(token, { item, index });
      return { ok: true, undo: token };
    });
  }

  /** Put a deleted plan back in its place. Once, and only if it is not saved again already. */
  undo(token: string): Promise<PlanUndo> {
    return this.#serial(async (): Promise<PlanUndo> => {
      const removed = this.#removed.get(token);
      if (!removed || this.#items.some((p) => p.id === removed.item.id || planIdentity(p) === planIdentity(removed.item))) {
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

  /** Forget an undo that is no longer offered. */
  forget(token: string): void {
    this.#removed.delete(token);
  }

  #fits(items: PlanV1[]): boolean {
    if (items.length + this.#unreadable.length > this.#limits.maxItems) return false;
    return new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, items: [...items, ...this.#unreadable] })).byteLength <= this.#limits.maxBytes;
  }

  /** Write the whole list; publish it only once it is on disk. */
  async #write(items: PlanV1[]): Promise<{ ok: true } | { ok: false; reason: "write_failed"; message: string }> {
    try {
      await this.#storage.writeAtomically(PLANS_NAMESPACE, { schemaVersion: 1, items: [...items, ...this.#unreadable] });
    } catch (err) {
      return { ok: false, reason: "write_failed", message: errorText(err) };
    }
    this.#items = items;
    this.#notify();
    return { ok: true };
  }

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
}
