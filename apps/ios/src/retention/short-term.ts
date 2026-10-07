/**
 * Short-term caching for the OAuth flavour (release plan step 18b; app/flags.ts OAUTH).
 *
 * seats.aero's OAuth Addendum (2025-08-14) allows results obtained through an OAuth client to be cached for at most
 * 24 hours, purged automatically, with no persistent storage or offline copy beyond that. The key flavour keeps what
 * it always kept; under OAuth every place the device holds seats.aero's results follows the 24-hour limit:
 *
 *   - **The availability cache** (cache.json and memory). Its 45-minute TTL decides when a search fetches again, but
 *     the rows themselves stayed until a later fetch of the same scope replaced them. `pruneCacheSnapshot` drops rows
 *     and coverage fetched more than 24 hours ago, on launch, before every save and on every sweep.
 *   - **The workspace** (workspace-v1: the snapshots on the Search screen and the ones before them). `shortTermStorage`
 *     drops snapshots holding older rows whenever the file is read or written, and writes the pruned file back when a
 *     read found any, so they leave the disk as well as the screen; it also writes both of the two-slot storage's
 *     slots, for the workspace and for Saved, so no older version lingers in the second one.
 *   - **Saved** keeps each item's query, when it was saved and how many options it showed; its rows go once they are
 *     24 hours old (core FavoritesStore.removeRows), and opening it searches again (FavoritesStore.replaceRows).
 *   - **Watch baselines** are purged after 24 hours (`expireWatchData`): the next check sets a new baseline instead of
 *     comparing (watch/runner.ts baselineExpired), and change details older than 24 hours go too. A fingerprint was
 *     the alternative; it cannot say how much cheaper a seat became, which is what a watch reports.
 *   - **An option's details** are forgotten after 24 hours (workspace/detail-service.ts maxAgeMs).
 *
 * Disconnecting purges all of it at once (app/bootstrap.ts purgeSeatsData), as does a revoked grant.
 */
import type { CacheSnapshot } from "@awardgrid/core/seatsaero/cache";
import type { Watch } from "@awardgrid/core/watch";
import type { FavoriteV1, StoragePort } from "@awardgrid/core/workspace/types";
import { FAVORITES_NAMESPACE } from "@awardgrid/core/workspace/favorites-store";
import { WORKSPACE_NAMESPACE } from "@awardgrid/core/workspace/workspace-store";

/** The Addendum's Short-Term Caching limit. */
export const SHORT_TERM_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** An ISO time as ms, or null when it is not one. */
function ms(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/** Whether `value` was fetched at or after `cutoff`. A time that cannot be read cannot be shown to be recent. */
function recent(value: unknown, cutoff: number): boolean {
  const at = ms(value);
  return at !== null && at >= cutoff;
}

/** The cache without rows or coverage fetched before `cutoff` (ms). `dropped` counts both. */
export function pruneCacheSnapshot(snapshot: CacheSnapshot | null | undefined, cutoff: number): { snapshot: CacheSnapshot | null; dropped: number } {
  if (!snapshot || !Array.isArray(snapshot.users)) return { snapshot: snapshot ?? null, dropped: 0 };
  let dropped = 0;
  const users = snapshot.users.map((user) => {
    const rows = (Array.isArray(user.rows) ? user.rows : []).filter((row) => recent(row?.fetched_at, cutoff));
    const coverage = (Array.isArray(user.coverage) ? user.coverage : []).filter((record) => recent(record?.fetched_at, cutoff));
    dropped += (user.rows?.length ?? 0) - rows.length + (user.coverage?.length ?? 0) - coverage.length;
    return { ...user, rows, coverage };
  });
  return { snapshot: { ...snapshot, users }, dropped };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * When a saved snapshot's seats.aero data was fetched: the oldest of its creation and its rows' fetch times. A row
 * without a readable time makes the snapshot count as old.
 */
export function snapshotFetchedAt(snapshot: unknown): number | null {
  if (!isRecord(snapshot)) return null;
  let oldest = ms(snapshot.createdAt);
  if (oldest === null) return null;
  for (const row of Array.isArray(snapshot.rows) ? snapshot.rows : []) {
    const value = isRecord(row) && isRecord(row.value) ? row.value : null;
    const at = value ? ms(value.fetched_at) : null;
    if (at === null) return null;
    if (at < oldest) oldest = at;
  }
  return oldest;
}

/** The saved workspace without snapshots older than `cutoff`; the shown and previous ids are cleared when theirs go. */
export function pruneWorkspace(value: unknown, cutoff: number): { value: unknown; dropped: number } {
  if (!isRecord(value) || !Array.isArray(value.snapshots)) return { value, dropped: 0 };
  const kept = value.snapshots.filter((s) => {
    const at = snapshotFetchedAt(s);
    return at !== null && at >= cutoff;
  });
  const dropped = value.snapshots.length - kept.length;
  if (dropped === 0) return { value, dropped };
  const ids = new Set(kept.map((s) => (isRecord(s) ? s.id : null)));
  return {
    value: {
      ...value,
      snapshots: kept,
      displayedId: ids.has(value.displayedId) ? value.displayedId : null,
      previousId: ids.has(value.previousId) ? value.previousId : null,
    },
    dropped,
  };
}

/** The namespaces that can hold seats.aero's rows: the workspace's snapshots and Saved. */
export const SEATS_NAMESPACES: ReadonlySet<string> = new Set([WORKSPACE_NAMESPACE, FAVORITES_NAMESPACE]);

/**
 * The two-slot storage (workspace/slot-storage.ts) under the 24-hour limit.
 *
 *   - **Workspace snapshots** older than the limit are dropped from everything read and written; a read that dropped
 *     any writes the pruned workspace back, so the old rows leave the disk as well as the screen.
 *   - **Both slots.** A write goes to the slot not holding the newest version, so the other slot keeps the version
 *     before it, rows and all, until the next write. For the namespaces that hold seats.aero's rows each write is made
 *     twice, so both slots hold what was just written and nothing older survives in the second one. (Each write is
 *     still atomic: if the second is torn, the first is whole.)
 *
 * Every other namespace passes through untouched.
 */
export function shortTermStorage(inner: StoragePort, cutoff: () => number): StoragePort {
  const write = async (name: string, value: unknown) => {
    await inner.writeAtomically(name, value);
    if (SEATS_NAMESPACES.has(name)) await inner.writeAtomically(name, value);
  };
  return {
    async read(name) {
      const raw = await inner.read(name);
      if (name !== WORKSPACE_NAMESPACE) return raw;
      const pruned = pruneWorkspace(raw, cutoff());
      if (pruned.dropped > 0) {
        try {
          await write(name, pruned.value);
        } catch {
          // Not written back now: the next save writes the pruned workspace, and nothing older is shown meanwhile.
        }
      }
      return pruned.value;
    },
    writeAtomically(name, value) {
      return write(name, name === WORKSPACE_NAMESPACE ? pruneWorkspace(value, cutoff()).value : value);
    },
    remove(name) {
      return inner.remove(name);
    },
  };
}

/** When a saved item's seats.aero rows were fetched: the oldest row's fetch time, else when it was saved. */
export function favoriteFetchedAt(item: FavoriteV1): number | null {
  let oldest: number | null = null;
  for (const row of item.rows) {
    const at = ms(row.value.fetched_at) ?? ms(row.time.fetchedAt);
    if (at === null) return null;
    if (oldest === null || at < oldest) oldest = at;
  }
  return oldest ?? ms(item.savedAt);
}

/** Whether a saved item still holds rows older than `cutoff` (the rows to remove). */
export function favoriteExpired(item: FavoriteV1, cutoff: number): boolean {
  if (item.rows.length === 0) return false;
  const at = favoriteFetchedAt(item);
  return at === null || at < cutoff;
}

/**
 * What to change in one watch so it holds nothing from seats.aero older than `cutoff`, or null when nothing needs to:
 * its baseline once the check that took it is older (the conditions, the counts of what changed and when it was last
 * checked stay), and each change detail found before then.
 */
export function watchExpiry(watch: Watch, cutoff: number): Partial<Watch> | null {
  const patch: Partial<Watch> = {};
  const checkedAt = ms(watch.lastCheckedAt);
  const baselineOld = checkedAt === null || checkedAt < cutoff;
  if (baselineOld && (watch.baseline.length > 0 || (watch.baselineWindow ?? null) !== null)) {
    patch.baseline = [];
    patch.baselineWindow = null;
  }
  const changes = watch.unseenChanges ?? null;
  if (changes && changes.length > 0) {
    const kept = changes.filter((change) => recent(change.at, cutoff));
    if (kept.length !== changes.length) patch.unseenChanges = kept.length > 0 ? kept : null;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Everything a watch holds from seats.aero, gone at once (Disconnect, a revoked grant): its baseline, the change
 * details and counts, and its check history, so the next check starts as a new watch's first one. Its name, its
 * conditions and whether it is on are kept.
 */
export function watchReset(): Partial<Watch> {
  return { baseline: [], baselineWindow: null, unseen: null, unseenChanges: null, lastCheckedAt: null, lastAttemptAt: null, lastResult: null };
}
