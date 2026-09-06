/**
 * GET /api/queries/[id]/runs → 200 { runs, diff } | 401 | 404
 *
 *   runs  the last 20 runs, newest first: { id, ran_at, new_cells, dropped_cells, notified,
 *         skipped_reason, calls_used } — `calls_used` is null for every run today (query_runs
 *         has no calls column and the schema is frozen this phase), so the UI says "not
 *         recorded" rather than inventing a number.
 *   diff  the LAST run's cells rebuilt from its stored snapshot: { new: [...], dropped: [...] }
 *         as grid rows, ready for the real cell component. Both arrays are empty when there is
 *         nothing to compare (no runs, a first run, or a run that fetched nothing); see
 *         `lastRunDiff` for the fields a snapshot cannot carry (booking link, airlines, stops).
 */
import type { NextRequest, NextResponse } from "next/server";
import { getServerDb } from "@/lib/server/db";
import { userFromRequest } from "@/lib/server/find";
import { lastRunDiff, listRuns } from "@/lib/server/queries";
import { queriesError, queriesJson } from "../../shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return queriesError(401, "unauthorized");
  const { id } = await ctx.params;
  const runs = listRuns(db, user.id, id);
  if (!runs) return queriesError(404, "not_found");
  const diff = lastRunDiff(db, user.id, id) ?? { new: [], dropped: [], price_drops: [] };
  return queriesJson({ runs, diff });
}
