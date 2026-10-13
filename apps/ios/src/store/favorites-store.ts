/**
 * The favourites store lives in core since T18 (packages/core/src/lib/workspace/favorites-store.ts), so the Web keeps
 * each account's saved options with the same rules (U-053). This path stays for the iOS shell's imports.
 */
export * from "@awardgrid/core/workspace/favorites-store";
import { favoriteFromOption, savedOptionIdentity } from "@awardgrid/core/workspace/favorites-store";
import { scopeKey } from "@awardgrid/core/workspace/identity";
import type { FavoriteV1, ResultSnapshot } from "@awardgrid/core/workspace/types";

/** A saved option is a user-selected narrow query; its local identity contains no provider result id. */
export function accountFavorite(item: FavoriteV1): FavoriteV1 {
  const selected = savedOptionIdentity(item);
  if (!selected) return item;
  const query = { ...item.query, origins: [selected.origin], destinations: [selected.dest], date_from: selected.date, date_to: selected.date, cabins: [selected.cabin], programs: [selected.program] } as FavoriteV1["query"];
  const identity = `selected-query:${scopeKey(query)}`;
  return { ...item, id: `fav-${identity}`, originalSnapshotId: identity, query };
}

export function accountOptionFromSnapshot(snapshot: ResultSnapshot, rowKey: string, savedAt: string): FavoriteV1 | null {
  const item = favoriteFromOption(snapshot, rowKey, savedAt, "selected-option");
  return item ? accountFavorite(item) : null;
}
