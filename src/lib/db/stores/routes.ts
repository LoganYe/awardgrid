/**
 * SQLite-backed RoutesStore over `routes_cache` (Get Routes results per user and program).
 *
 * Keyed by (user_id, source): every entry was paid for with one user's key, so no other user
 * may read it (§0.2 #2). The routes array is stored as JSON text and validated with the
 * `Route` zod schema on the way out — a corrupt or foreign-shaped entry is treated as absent
 * (the catalog then simply re-fetches) rather than poisoning the grid.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { routesCache } from "@/lib/db/schema";
import type { RoutesEntry, RoutesStore } from "@/lib/seatsaero/routes";
import { RoutesResponse } from "@/lib/seatsaero/types";

export interface SqliteRoutesStore extends RoutesStore {
  /** Delete entries with `fetched_at < olderThanIso`; `userId` null/undefined = every user. */
  prune(userId: string | null | undefined, olderThanIso: string): Promise<number>;
}

function assertUserId(userId: string): void {
  if (typeof userId !== "string" || userId === "") throw new RangeError("routes store requires a non-empty userId");
}

export function createSqliteRoutesStore(db: Db): SqliteRoutesStore {
  const t = routesCache;
  return {
    async get(userId, source): Promise<RoutesEntry | null> {
      assertUserId(userId);
      const row = db
        .select({ routesJson: t.routesJson, fetchedAt: t.fetchedAt })
        .from(t)
        .where(and(eq(t.userId, userId), eq(t.source, source)))
        .get();
      if (!row) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.routesJson);
      } catch {
        return null;
      }
      const routes = RoutesResponse.safeParse(parsed);
      if (!routes.success) return null;
      return { routes: routes.data, fetched_at: row.fetchedAt };
    },

    async put(userId, source, entry) {
      assertUserId(userId);
      db.insert(t)
        .values({ userId, source, routesJson: JSON.stringify(entry.routes), fetchedAt: entry.fetched_at })
        .onConflictDoUpdate({
          target: [t.userId, t.source],
          set: { routesJson: sql`excluded.routes_json`, fetchedAt: sql`excluded.fetched_at` },
        })
        .run();
    },

    async prune(userId, olderThanIso) {
      if (typeof olderThanIso !== "string" || !Number.isFinite(Date.parse(olderThanIso))) {
        throw new RangeError("prune requires an ISO-8601 timestamp");
      }
      const conds = [lt(t.fetchedAt, olderThanIso)];
      if (userId) conds.push(eq(t.userId, userId));
      return db.delete(t).where(and(...conds)).run().changes;
    },
  };
}
