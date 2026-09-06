/**
 * Server-side data for /queries (spec §4). The page hands the client everything the table and
 * every expanded row need — the rows (each already carrying `next_run_at` and `schedule_label`),
 * the last 20 runs, and the last run's new / dropped cells — so opening "Details" costs no
 * round trip and the page renders complete on first paint. A "Run now" refetches one query's
 * runs through GET /api/queries/[id]/runs, which returns the same two shapes.
 *
 * Everything here goes through src/lib/server/queries, which scopes every read to the calling
 * user: another user's saved query is indistinguishable from a missing one.
 */
import type { QueryDetails, QueryRowSummary } from "@/components/queries/api";
import type { Db } from "@/lib/db/client";
import { lastRunDiff, listRuns, listSavedQueries } from "@/lib/server/queries";

export interface QueriesPageData {
  queries: QueryRowSummary[];
  /** Saved-query id → its expanded-row payload. */
  details: Record<string, QueryDetails>;
}

/** Every standing query of `userId`, each with its last 20 runs and its last diff. */
export function loadQueriesPageData(db: Db, userId: string): QueriesPageData {
  const queries = listSavedQueries(db, userId);
  const details: Record<string, QueryDetails> = {};
  for (const q of queries) {
    details[q.id] = {
      runs: listRuns(db, userId, q.id) ?? [],
      diff: lastRunDiff(db, userId, q.id),
    };
  }
  return { queries, details };
}
