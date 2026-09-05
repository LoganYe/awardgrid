/**
 * SQLite implementations of the Phase-1 store interfaces (QuotaStore, AvailabilityCacheStore,
 * RoutesStore) over the migrated tables api_usage / availability_cache / cache_coverage /
 * routes_cache. Every query is scoped by user_id (kickoff §0.2 #2, §12 "cache scope").
 *
 * Typical wiring (web app, worker, admin CLI):
 *
 *   const stores = createSqliteStores(getDb());
 *   const quota = new Quota({ store: stores.quota });
 *   const routes = new RoutesCatalog({ store: stores.routes });
 *   await runFind({ query, userId, apiKey, quota, cache: stores.cache, routes });
 */
import type { Db } from "@/lib/db/client";
import { createSqliteAvailabilityCache, type SqliteAvailabilityCache } from "@/lib/db/stores/cache";
import { createSqliteQuotaStore, type SqliteQuotaStore, type SqliteQuotaStoreOptions } from "@/lib/db/stores/quota";
import { createSqliteRoutesStore, type SqliteRoutesStore } from "@/lib/db/stores/routes";

export * from "@/lib/db/stores/quota";
export * from "@/lib/db/stores/cache";
export * from "@/lib/db/stores/routes";

export interface SqliteStores {
  quota: SqliteQuotaStore;
  cache: SqliteAvailabilityCache;
  routes: SqliteRoutesStore;
}

export interface SqliteStoresOptions {
  quota?: SqliteQuotaStoreOptions;
}

/** All three stores over one database handle. */
export function createSqliteStores(db: Db, opts: SqliteStoresOptions = {}): SqliteStores {
  return {
    quota: createSqliteQuotaStore(db, opts.quota),
    cache: createSqliteAvailabilityCache(db),
    routes: createSqliteRoutesStore(db),
  };
}
