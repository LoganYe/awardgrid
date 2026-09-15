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

export interface WatchSnapshot {
  version: number;
  watches: Watch[];
}

export const WATCH_SNAPSHOT_VERSION = 1;

/** Keeps a persisted file from growing without bound, and a phone screen from becoming a list. */
export const MAX_WATCHES = 20;

export class WatchStore {
  #watches: Watch[] = [];
  #dirty = false;

  get dirty(): boolean {
    return this.#dirty;
  }

  all(): readonly Watch[] {
    return this.#watches;
  }

  get(id: string): Watch | undefined {
    return this.#watches.find((w) => w.id === id);
  }

  add(watch: Watch): { ok: true } | { ok: false; reason: "limit" | "duplicate" } {
    if (this.#watches.length >= MAX_WATCHES) return { ok: false, reason: "limit" };
    // Same query text twice is a mistake, not an intention: it would double the quota cost of
    // every check for identical results.
    if (this.#watches.some((w) => w.text.trim() === watch.text.trim())) return { ok: false, reason: "duplicate" };
    this.#watches.push(watch);
    this.#dirty = true;
    return { ok: true };
  }

  remove(id: string): boolean {
    const before = this.#watches.length;
    this.#watches = this.#watches.filter((w) => w.id !== id);
    if (this.#watches.length !== before) this.#dirty = true;
    return this.#watches.length !== before;
  }

  /** Replace one watch in place. Unknown ids are ignored rather than inserted. */
  update(id: string, patch: Partial<Omit<Watch, "id">>): Watch | undefined {
    const i = this.#watches.findIndex((w) => w.id === id);
    if (i === -1) return undefined;
    const next = { ...this.#watches[i]!, ...patch, id };
    this.#watches[i] = next;
    this.#dirty = true;
    return next;
  }

  snapshot(): WatchSnapshot {
    return { version: WATCH_SNAPSHOT_VERSION, watches: this.#watches.map((w) => ({ ...w, baseline: [...w.baseline] })) };
  }

  /** A version mismatch is discarded rather than migrated: a misread baseline reports false changes. */
  restore(snapshot: WatchSnapshot | null | undefined): number {
    this.#watches = [];
    this.#dirty = false;
    if (!snapshot || snapshot.version !== WATCH_SNAPSHOT_VERSION || !Array.isArray(snapshot.watches)) return 0;
    for (const w of snapshot.watches) {
      if (!w || typeof w.id !== "string" || typeof w.text !== "string") continue;
      this.#watches.push({ ...w, baseline: Array.isArray(w.baseline) ? [...w.baseline] : [] });
    }
    return this.#watches.length;
  }

  markClean(): void {
    this.#dirty = false;
  }
}
