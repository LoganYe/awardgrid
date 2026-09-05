/**
 * POST /api/auth/logout-all → 204: revokes EVERY session of the signed-in user (all devices)
 * and expires this request's cookie. No session → 401. Body is empty either way.
 */
import { NextResponse, type NextRequest } from "next/server";
import { revokeAllSessions } from "@/lib/auth";
import { clearSessionCookie } from "@/lib/auth/next";
import { getServerDb } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { userFromRequest } from "../../keys/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(request, db);
  if (!user) return jsonError(401, "unauthorized");
  revokeAllSessions(db, user.id);
  return clearSessionCookie(new NextResponse(null, { status: 204 }));
}
