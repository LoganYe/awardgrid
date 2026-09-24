/**
 * Watches on the device.
 *
 * There is no server, so there is no cron and nothing to sync to. A watch is a saved query plus
 * the baseline its next check diffs against, and it is checked when something checks it — which
 * on iOS means "when the app is opened", and nothing stronger (docs/PIVOT.md §3).
 *
 * Note what this record does NOT have, because their absence is the feature working as designed:
 * no `scheduleCron`, no `nextRunAt`, no `dueAt`. The web app's `saved_queries` table has
 * `schedule_cron` (`src/lib/db/schema.ts`) and its UI renders a "Next run" column; both are
 * promises iOS cannot keep. A field that does not exist cannot be rendered by mistake.
 */
import type { Watch } from "@awardgrid/core/watch";
import { sameDraft } from "@awardgrid/core/workspace/query-editor";
import type { QueryDraft } from "@awardgrid/core/workspace/types";

export interface WatchSnapshot {
  version: number;
  watches: Watch[];
}

/**
 * 2 since T14: a watch may carry its structured query and date rule (`draft`), whether it needs review, and the change
 * details not seen yet. A version-1 file is read as it is (its watches have no draft) and migrated after launch
 * (app/bootstrap.ts, core workspace/watch-migration.ts); it is never discarded.
 */
export const WATCH_SNAPSHOT_VERSION = 2;
/** The version before T14, still read. */
export const LEGACY_WATCH_SNAPSHOT_VERSION = 1;

/** Keeps a persisted file from growing without bound, and a phone screen from becoming a list. */
export const MAX_WATCHES = 20;

/**
 * Why the store takes no change (T14: old data is never deleted): the file was written by a newer version, whose
 * baselines this one could misread, or the device could not read it. Either way nothing is written over it.
 */
export type WatchesHold = "newer" | "unreadable";

/** A draft with its sort order set aside: what a check fetches and compares does not depend on it. */
function unsorted(draft: QueryDraft): QueryDraft {
  return { ...draft, query: { ...draft.query, sort_by: "miles_asc" } };
}

export class WatchStore {
  #watches: Watch[] = [];
  #dirty = false;
  #hold: WatchesHold | null = null;
  /** Entries this version cannot read, carried unchanged in every write: never dropped. */
  #carried: unknown[] = [];
  #keptAside: string | null = null;

  /** Why nothing may be changed or written, or null. */
  get hold(): WatchesHold | null {
    return this.#hold;
  }

  /** How many saved entries this version cannot read (kept unchanged). */
  get carried(): number {
    return this.#carried.length;
  }

  /** Where a damaged watches file was copied, unchanged, before this store started again (T14), or null. */
  get keptAside(): string | null {
    return this.#keptAside;
  }

  /** The device could not read watches.json: take no change, so nothing is written over it. */
  holdUnreadable(): void {
    this.#watches = [];
    this.#carried = [];
    this.#dirty = false;
    this.#hold = "unreadable";
  }

  /**
   * watches.json was damaged and has been copied to `path` as it was; the list starts empty. Dirty, so the next save
   * replaces the damaged file (its copy stays) instead of copying it aside again at every launch.
   */
  noteKeptAside(path: string): void {
    this.#keptAside = path;
    this.#dirty = true;
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  all(): readonly Watch[] {
    return this.#watches;
  }

  get(id: string): Watch | undefined {
    return this.#watches.find((w) => w.id === id);
  }

  add(watch: Watch): { ok: true } | { ok: false; reason: "limit" | "duplicate" | "held" } {
    if (this.#hold) return { ok: false, reason: "held" };
    if (this.#watches.length >= MAX_WATCHES) return { ok: false, reason: "limit" };
    // The same search twice is a mistake, not an intention: two identical cards reporting the same changes (the second
    // check is usually read from the cache). Structured watches are the same when their conditions and date rule are
    // (T14), whatever order the view sorted by: sorting is local (U-030) and changes neither the fetch nor the diff.
    // Text watches are the same when their text is.
    const same = (w: Watch) => (watch.draft && w.draft ? sameDraft(unsorted(w.draft), unsorted(watch.draft)) : !watch.draft && !w.draft && w.text.trim() === watch.text.trim());
    if (this.#watches.some(same)) return { ok: false, reason: "duplicate" };
    this.#watches.push(watch);
    this.#dirty = true;
    return { ok: true };
  }

  remove(id: string): boolean {
    if (this.#hold) return false;
    const before = this.#watches.length;
    this.#watches = this.#watches.filter((w) => w.id !== id);
    if (this.#watches.length !== before) this.#dirty = true;
    return this.#watches.length !== before;
  }

  /** Replace one watch in place. Unknown ids are ignored rather than inserted. */
  update(id: string, patch: Partial<Omit<Watch, "id">>): Watch | undefined {
    if (this.#hold) return undefined;
    const i = this.#watches.findIndex((w) => w.id === id);
    if (i === -1) return undefined;
    const next = { ...this.#watches[i]!, ...patch, id };
    this.#watches[i] = next;
    this.#dirty = true;
    return next;
  }

  /** What to write. Never called while held (AppServices.persist checks `hold`). Unreadable entries go back as they came. */
  snapshot(): WatchSnapshot {
    return { version: WATCH_SNAPSHOT_VERSION, watches: [...this.#watches.map((w) => ({ ...w, baseline: [...w.baseline] })), ...(this.#carried as Watch[])] };
  }

  /**
   * A newer version is not read (a misread baseline reports false changes), and is held: nothing is written over it.
   * This version and the one before T14 are read: the older one's watches come back without a draft, for the migration
   * after launch. An entry that cannot be read is carried unchanged, never dropped (T14).
   */
  restore(snapshot: WatchSnapshot | null | undefined): number {
    this.#watches = [];
    this.#carried = [];
    this.#dirty = false;
    this.#hold = null;
    if (!snapshot || !Array.isArray(snapshot.watches)) return 0;
    if (snapshot.version !== WATCH_SNAPSHOT_VERSION && snapshot.version !== LEGACY_WATCH_SNAPSHOT_VERSION) {
      this.#hold = "newer";
      return 0;
    }
    for (const w of snapshot.watches as unknown[]) {
      const entry = w as Partial<Watch> | null;
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || typeof entry.text !== "string") {
        this.#carried.push(w);
        continue;
      }
      this.#watches.push({ ...(entry as Watch), baseline: Array.isArray(entry.baseline) ? [...entry.baseline] : [] });
    }
    return this.#watches.length;
  }

  markClean(): void {
    this.#dirty = false;
  }

  /** Watches from before T14 that have not been migrated yet: no draft, no review. */
  unmigrated(): readonly Watch[] {
    return this.#watches.filter((w) => w.draft === undefined);
  }
}
