/**
 * Short-term caching on the server: seats.aero results obtained through Login with Seats.aero are kept for at most
 * 24 hours and purged automatically, and every result an account holds is purged when it disconnects seats.aero or
 * revokes AwardGrid (seats.aero's OAuth Addendum; the iPhone app's rules are apps/ios/src/retention/short-term.ts).
 *
 * What the server keeps from seats.aero, and what happens to it:
 *
 *   availability_cache, cache_coverage  rows and the record of what was fetched: deleted once fetched_at is 24 hours
 *                                       old. The cache's own TTL (CACHE_TTL_MINUTES, capped at 24 hours in
 *                                       src/lib/server/find.ts) decides when a search fetches again; this decides
 *                                       when the rows leave the disk.
 *   routes_cache                        Get Routes per program: deleted at 24 hours (the catalog's TTL is 24 hours
 *                                       in the web app too, so an older list is never read meanwhile).
 *   query_runs.cells_json               a standing query's snapshot of the cells it saw: emptied and stamped
 *                                       `cells_purged_at` once the run is 24 hours old. The run keeps its counts; a
 *                                       purged run is never a diff baseline again (src/lib/scheduler/run.ts), so the
 *                                       next run sets a new baseline instead of reporting everything as new.
 *
 * The sweep runs when the web server opens the database and every SWEEP_INTERVAL_MS after (src/lib/server/db.ts), and
 * on every worker tick (src/cli/worker-main.ts). Nothing is logged but counts.
 */
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import type { DbConn } from "@/lib/auth/clock";
import { availabilityCache, cacheCoverage, queryRuns, routesCache, savedQueries, seatsOauthStates } from "@/lib/db/schema";

/** The Addendum's Short-Term Caching limit. */
export const SHORT_TERM_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** The same limit in minutes, the unit of CACHE_TTL_MINUTES. */
export const SHORT_TERM_MAX_AGE_MINUTES = SHORT_TERM_MAX_AGE_MS / 60_000;
/** How often the web server sweeps. */
export const SWEEP_INTERVAL_MS = 10 * 60_000;

/** The oldest fetch time still kept at `now`, as the ISO text the tables store. */
export function shortTermCutoff(now: Date): string {
  return new Date(now.getTime() - SHORT_TERM_MAX_AGE_MS).toISOString();
}

export interface PurgeReport {
  rows: number;
  coverage: number;
  routes: number;
  runs: number;
}

/** A run snapshot with nothing in it, as the scheduler writes for a run that took none. */
const EMPTY_CELLS = "[]";

function purgeRuns(db: DbConn, at: string, where: ReturnType<typeof and>): number {
  return db.update(queryRuns).set({ cellsJson: EMPTY_CELLS, cellsHash: "", cellsPurgedAt: at }).where(where).run().changes;
}

/**
 * Everything seats.aero-derived held for every account and fetched before the 24-hour cutoff; also the sign-ins that
 * expired without coming back (./state.ts). One transaction.
 */
export function sweepSeatsData(db: DbConn, now: Date = new Date()): PurgeReport {
  const cutoff = shortTermCutoff(now);
  const at = now.toISOString();
  return db.transaction((tx) => {
    const rows = tx.delete(availabilityCache).where(lt(availabilityCache.fetchedAt, cutoff)).run().changes;
    const coverage = tx.delete(cacheCoverage).where(lt(cacheCoverage.fetchedAt, cutoff)).run().changes;
    const routes = tx.delete(routesCache).where(lt(routesCache.fetchedAt, cutoff)).run().changes;
    const runs = purgeRuns(tx, at, and(lt(queryRuns.ranAt, cutoff), isNull(queryRuns.cellsPurgedAt)));
    tx.delete(seatsOauthStates).where(lt(seatsOauthStates.expiresAt, at)).run();
    return { rows, coverage, routes, runs };
  });
}

/**
 * Everything seats.aero-derived held for ONE account, whatever its age: Disconnect, and a refresh that found the grant
 * revoked. One transaction.
 */
export function purgeSeatsDataForUser(db: DbConn, userId: string, now: Date = new Date()): PurgeReport {
  const at = now.toISOString();
  return db.transaction((tx) => {
    const rows = tx.delete(availabilityCache).where(eq(availabilityCache.userId, userId)).run().changes;
    const coverage = tx.delete(cacheCoverage).where(eq(cacheCoverage.userId, userId)).run().changes;
    const routes = tx.delete(routesCache).where(eq(routesCache.userId, userId)).run().changes;
    const owned = tx.select({ id: savedQueries.id }).from(savedQueries).where(eq(savedQueries.userId, userId));
    const runs = purgeRuns(tx, at, and(inArray(queryRuns.savedQueryId, owned), isNull(queryRuns.cellsPurgedAt)));
    return { rows, coverage, routes, runs };
  });
}
