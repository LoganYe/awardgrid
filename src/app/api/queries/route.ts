/**
 * GET  /api/queries → 200 { queries: SavedQuerySummary[] } (each with its last run summary)
 * POST /api/queries { name, query, schedule_cron?, notify_on?, drop_threshold_pct? }
 *      → 201 { query } | 400 { error: invalid_body | invalid_name | invalid_cron |
 *        cron_too_frequent | invalid_threshold | invalid_notify_on | invalid_query } | 401
 * Defaults (kickoff §12): every 3 h, notify on both, 10 % drop. Always the calling user's rows.
 */
import type { NextRequest, NextResponse } from "next/server";
import { getServerDb } from "@/lib/server/db";
import { userFromRequest } from "@/lib/server/find";
import { createSavedQuery, listSavedQueries } from "@/lib/server/queries";
import { CreateBody, cronProblem, parseBody, queriesError, queriesJson } from "./shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return queriesError(401, "unauthorized");
  return queriesJson({ queries: listSavedQueries(db, user.id) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return queriesError(401, "unauthorized");
  const body = await parseBody(request, CreateBody);
  if (!body.ok) return body.response;
  const cronErr = cronProblem(body.data.schedule_cron);
  if (cronErr) return queriesError(400, cronErr);
  const query = createSavedQuery(db, user.id, body.data);
  return queriesJson({ query }, 201);
}
