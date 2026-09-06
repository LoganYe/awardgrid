/**
 * PATCH  /api/queries/[id] { enabled?, name?, query?, schedule_cron?, notify_on?, drop_threshold_pct? }
 *        → 200 { query } | 400 (validation codes) | 401 | 404 { error: "not_found" }
 * DELETE /api/queries/[id] → 204 | 401 | 404
 * Another user's id is a 404 — identical to a missing one, so ids cannot be enumerated.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServerDb } from "@/lib/server/db";
import { userFromRequest } from "@/lib/server/find";
import { deleteSavedQuery, updateSavedQuery } from "@/lib/server/queries";
import { PatchBody, cronProblem, parseBody, queriesError, queriesJson } from "../shared";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return queriesError(401, "unauthorized");
  const { id } = await ctx.params;
  const body = await parseBody(request, PatchBody);
  if (!body.ok) return body.response;
  const cronErr = cronProblem(body.data.schedule_cron);
  if (cronErr) return queriesError(400, cronErr);
  const updated = updateSavedQuery(db, user.id, id, body.data);
  if (!updated) return queriesError(404, "not_found");
  return queriesJson({ query: updated });
}

export async function DELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return queriesError(401, "unauthorized");
  const { id } = await ctx.params;
  if (!deleteSavedQuery(db, user.id, id)) return queriesError(404, "not_found");
  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}
