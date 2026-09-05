/**
 * POST /api/find { query: QueryObject, orientation? } → 200 { grid, warnings, quota }
 *   | 401 unauthorized | 409 no_key | 429 quota { resetAt } | 502 seatsaero { kind, message }
 * Always runs with the calling user's own key (no fallback, per-user cache and quota).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { QueryObject } from "@/lib/query/schema";
import { getServerDb } from "@/lib/server/db";
import { findGridForUser, gridError, gridErrorResponse, userFromRequest } from "@/lib/server/find";
import { readJson } from "@/lib/server/http";

export const runtime = "nodejs";

const Body = z.object({
  query: QueryObject,
  orientation: z.enum(["dates", "routes"]).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return gridError(401, "unauthorized");
  try {
    const body = await readJson(request, Body);
    const result = await findGridForUser(db, user, body.query, { orientation: body.orientation ?? "dates" });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return gridErrorResponse(err);
  }
}
