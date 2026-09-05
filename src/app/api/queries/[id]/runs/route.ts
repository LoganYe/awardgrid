/** GET /api/queries/[id]/runs → 200 { runs: RunSummary[] } (last 20, newest first) | 401 | 404 */
import type { NextRequest, NextResponse } from "next/server";
import { getServerDb } from "@/lib/server/db";
import { userFromRequest } from "@/lib/server/find";
import { listRuns } from "@/lib/server/queries";
import { queriesError, queriesJson } from "../../shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return queriesError(401, "unauthorized");
  const { id } = await ctx.params;
  const runs = listRuns(db, user.id, id);
  if (!runs) return queriesError(404, "not_found");
  return queriesJson({ runs });
}
