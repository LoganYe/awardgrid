/**
 * Whether search_awards would be answered from this device's cache, decided before any call.
 *
 * runFind spends nothing when every pair of a query has a fresh coverage record in the query's own scope
 * (seatsaero/find.ts:280-303). The tool has to know that before it runs, because the two cases are budgeted
 * differently: a search too wide to pull within the question's calls is still fine to READ when this device
 * already holds it (budget.ts plans it with maxPages 1).
 *
 * find.ts builds that scope inline (:265-277) and is not edited in this phase, so askCacheScope is a copy.
 * A copy can drift, so coverage.test.ts pins it to runFind twice over: the scope runFind hands the cache
 * equals askCacheScope, and for every case there coveredByCache predicts runFind's served_from_cache.
 */
import type { QueryObject } from "../query/schema";
import { uncoveredPairs, type AvailabilityCacheStore, type CacheQuery } from "../seatsaero/cache";
import { pairsOf } from "../seatsaero/find";

/**
 * The cache scope runFind reads and writes for `query` (find.ts:258, :265-277), field for field. An empty
 * program list means every program, exactly as runFind reads it, so `programs` is left out rather than sent
 * as `[]` (which rowMatches would read as "no program").
 */
export function askCacheScope(query: QueryObject): CacheQuery {
  const programs = query.programs && query.programs.length > 0 ? [...query.programs] : null;
  return {
    origins: query.origins,
    dests: query.destinations,
    date_from: query.date_from,
    date_to: query.date_to,
    cabins: query.cabins,
    ...(programs ? { programs } : {}),
    direct_only: query.direct_only,
    include_filtered: query.include_filtered,
    min_cabin_pct: query.min_cabin_pct,
  };
}

export interface CoveredByCacheOptions {
  query: QueryObject;
  /**
   * The cache key runFind is called with. Every cache read is per user (cache.ts:1-3); the iOS shell has one,
   * LOCAL_USER (apps/ios/src/search/search.ts:38), and core does not assume it.
   */
  userId: string;
  cache: AvailabilityCacheStore;
  /** The TTL runFind is called with. Ask always passes DEFAULT_CACHE_TTL_MINUTES, as a watch does. */
  ttlMinutes: number;
  now: () => Date;
}

/** True when runFind, called with the same user, TTL and clock, would serve `query` from cache with zero calls. */
export async function coveredByCache(opts: CoveredByCacheOptions): Promise<boolean> {
  const coverage = await opts.cache.getCoverage(opts.userId, pairsOf(opts.query));
  return uncoveredPairs(askCacheScope(opts.query), coverage, opts.ttlMinutes, opts.now()).length === 0;
}
