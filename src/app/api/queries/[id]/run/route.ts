/**
 * POST /api/queries/[id]/run → 200 { run: RunSummary } — runs the standing query NOW with the
 * owner's own key (scheduler runNow), records the run and returns its summary.
 *   401 | 404 not_found | 409 { error: "no_key" } | 409 { error: "run_in_progress" } (the
 *   worker is running it right now) | 429 { error: "quota", resetAt } |
 *   502 { error: "seatsaero", kind } | 500 internal. A run the scheduler skipped for any other
 *   reason (upstream error, quiet hours, first run) is a 200 whose run.skipped_reason says why.
 * Ownership is checked BEFORE runNow so nobody can spend another user's quota.
 */
import type { NextRequest, NextResponse } from "next/server";
import { NoKeyError } from "@/lib/keys";
import { SeatsAeroError, SeatsAeroHttpError, SeatsAeroNetworkError } from "@/lib/seatsaero/client";
import { getServerDb } from "@/lib/server/db";
import { userFromRequest } from "@/lib/server/find";
import { RunInProgressError, RunQuotaError, getSavedQuery, runNow } from "@/lib/server/queries";
import { queriesError, queriesJson } from "../../shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return queriesError(401, "unauthorized");
  const { id } = await ctx.params;
  if (!getSavedQuery(db, user.id, id)) return queriesError(404, "not_found");
  try {
    const run = await runNow(db, id, {});
    return queriesJson({ run });
  } catch (err) {
    if (err instanceof NoKeyError) return queriesError(409, "no_key");
    if (err instanceof RunInProgressError) return queriesError(409, "run_in_progress");
    if (err instanceof RunQuotaError) return queriesError(429, "quota", { resetAt: err.resetAt.toISOString() });
    if (err instanceof SeatsAeroError) {
      const kind = err instanceof SeatsAeroHttpError ? err.kind : err instanceof SeatsAeroNetworkError ? "network" : "response";
      return queriesError(502, "seatsaero", { kind });
    }
    // Name only — never the message (it could carry upstream text) and never an id.
    console.error("[api/queries/run] failed:", err instanceof Error ? err.name : typeof err);
    return queriesError(500, "internal");
  }
}
