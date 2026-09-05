/**
 * The master tick (DECISIONS: one node-cron task every 5 minutes in UTC calls `tick`) and the
 * "run now" entry point for the saved-queries API.
 *
 * `tick` runs every enabled saved query whose cron is due SEQUENTIALLY — never in parallel —
 * so one user's quota reservations do not race each other and one slow upstream does not fan
 * out. A throwing run (only a DB failure can throw; per-query failures are results) is caught,
 * counted under `errors`, and the loop continues.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { savedQueries, type SavedQuery } from "@/lib/db/schema";
import { isDue } from "./cron";
import { runSavedQuery } from "./run";
import type { QueryRunResult, RunDeps } from "./types";

export interface TickSummary {
  /** ISO time the tick started. */
  ranAt: string;
  /** Enabled saved queries examined. */
  considered: number;
  /** Saved queries whose cron was due (each has a result or an error below). */
  due: number;
  notified: number;
  skipped: number;
  results: QueryRunResult[];
  /** Saved queries whose run threw (database failure); ids only. */
  errors: { savedQueryId: string; name: string }[];
}

/** Enabled saved queries, owner-grouped and stable-ordered so runs are reproducible. */
export function listEnabledSavedQueries(db: Db): SavedQuery[] {
  return db.select().from(savedQueries).where(eq(savedQueries.enabled, true)).orderBy(asc(savedQueries.userId), asc(savedQueries.createdAt), asc(savedQueries.id)).all();
}

export async function tick(db: Db, deps: RunDeps): Promise<TickSummary> {
  const now = deps.now ?? (() => new Date());
  const nowIso = now().toISOString();
  const all = listEnabledSavedQueries(db);
  const summary: TickSummary = { ranAt: nowIso, considered: all.length, due: 0, notified: 0, skipped: 0, results: [], errors: [] };
  const log = deps.log ?? (() => {});

  for (const sq of all) {
    if (!isDue(sq.scheduleCron, sq.lastRunAt, nowIso)) continue;
    summary.due += 1;
    try {
      const result = await runSavedQuery(db, sq, deps);
      summary.results.push(result);
      if (result.notified) summary.notified += 1;
      else if (result.skippedReason !== null) summary.skipped += 1;
    } catch (err) {
      const name = err instanceof Error ? err.name : typeof err;
      summary.errors.push({ savedQueryId: sq.id, name });
      log("scheduler.run_failed", { savedQueryId: sq.id, name });
    }
  }
  log("scheduler.tick", { considered: summary.considered, due: summary.due, notified: summary.notified, skipped: summary.skipped, errors: summary.errors.length });
  return summary;
}

export interface RunNowOptions {
  /** When given, the saved query must belong to this user (the API's ownership check). */
  userId?: string;
}

/**
 * "Run now" for the API: ignores `enabled` and the cron, but everything else (own key, quota,
 * quiet hours, baseline) applies exactly as in a scheduled run. Returns null when the saved
 * query does not exist or is not owned by `opts.userId`.
 */
export async function runNow(db: Db, savedQueryId: string, deps: RunDeps, opts: RunNowOptions = {}): Promise<QueryRunResult | null> {
  const where = opts.userId ? and(eq(savedQueries.id, savedQueryId), eq(savedQueries.userId, opts.userId)) : eq(savedQueries.id, savedQueryId);
  const sq = db.select().from(savedQueries).where(where).get();
  if (!sq) return null;
  return runSavedQuery(db, sq, deps);
}
