/**
 * Short-term caching in the browser (the server's rules are src/lib/seats-oauth/retention.ts; the iPhone app's are
 * apps/ios/src/retention/short-term.ts, which this follows for the same stores).
 *
 * What a browser keeps from seats.aero for an account, in its own localStorage keys (./storage.ts):
 *
 *   - **The workspace** (the snapshots of earlier searches): `shortTermWebStorage` drops snapshots holding rows
 *     fetched more than 24 hours ago from everything read and written, and writes the pruned workspace back when a
 *     read found any, so they leave the browser as well as the screen.
 *   - **Saved options** keep their search, when they were saved and how many options they showed; their rows go once
 *     they are 24 hours old (core FavoritesStore.removeRows).
 *   - **Ask** keeps its conversation in sessionStorage; a turn older than 24 hours is dropped
 *     (src/components/ask/history.ts).
 *
 * An account that is not connected (it disconnected, here or elsewhere, or seats.aero revoked AwardGrid) keeps none of
 * it: the cutoff is then "everything", the next time a page of the workspace opens. Disconnect in Settings does the
 * same at once (`forgetSeatsResultsOnDevice`).
 */
import type { FavoriteV1, StoragePort } from "@awardgrid/core/workspace/types";
import { FavoritesStore } from "@awardgrid/core/workspace/favorites-store";
import { WORKSPACE_NAMESPACE } from "@awardgrid/core/workspace/workspace-store";
import { clearAskSession } from "@/components/ask/history";
import { FAVORITES_STORE, WORKSPACE_STORE, webStorage } from "./storage";

/** The OAuth Addendum's Short-Term Caching limit (src/lib/seats-oauth/retention.ts SHORT_TERM_MAX_AGE_MS). */
export const SHORT_TERM_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The oldest fetch time kept at `nowMs`, or "everything" when the account is not connected. */
export function cutoffFor(connected: boolean, nowMs: number): number {
  return connected ? nowMs - SHORT_TERM_MAX_AGE_MS : Number.POSITIVE_INFINITY;
}

function ms(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
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

/** The workspace's storage under the limit: snapshots older than `cutoff()` are dropped on every read and write. */
export function shortTermWebStorage(inner: StoragePort, cutoff: () => number): StoragePort {
  return {
    async read(name) {
      const raw = await inner.read(name);
      if (name !== WORKSPACE_NAMESPACE) return raw;
      const pruned = pruneWorkspace(raw, cutoff());
      if (pruned.dropped > 0) {
        try {
          await inner.writeAtomically(name, pruned.value);
        } catch {
          // Not written back now: the next save writes the pruned workspace, and nothing older is shown meanwhile.
        }
      }
      return pruned.value;
    },
    writeAtomically(name, value) {
      return inner.writeAtomically(name, name === WORKSPACE_NAMESPACE ? pruneWorkspace(value, cutoff()).value : value);
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

/** Take the expired rows out of saved options, keeping each item's search, saved time and option count. */
export function expireFavorites(favorites: FavoritesStore, cutoff: number, now: Date = new Date()) {
  return favorites.removeRows((item) => favoriteExpired(item, cutoff), now.toISOString(), (item) => item.rows.length);
}

/**
 * Disconnect, on this browser: the account's workspace results, the rows of its saved options and the Ask
 * conversation go now. Another browser of the same account purges the next time it opens the workspace (`cutoffFor`).
 */
export async function forgetSeatsResultsOnDevice(userId: string, now: Date = new Date()): Promise<void> {
  clearAskSession();
  await webStorage(WORKSPACE_STORE, userId).remove(WORKSPACE_NAMESPACE);
  const favorites = new FavoritesStore(webStorage(FAVORITES_STORE, userId), () => now.toISOString());
  await favorites.load();
  await expireFavorites(favorites, Number.POSITIVE_INFINITY, now);
}
