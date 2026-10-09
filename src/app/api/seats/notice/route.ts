/**
 * DELETE /api/seats/notice → 204 | 401 unauthorized
 *
 * Dismiss the one-time notice that the account's pasted seats.aero key was removed (migration 0005) and seats.aero is
 * now connected through its own sign-in. Connecting clears it too (src/lib/seats-oauth/store.ts saveConnection).
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServerDb } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { dismissReconnectNotice } from "@/lib/seats-oauth";
import { userFromRequest } from "../../keys/session";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(request, db);
  if (!user) return jsonError(401, "unauthorized");
  dismissReconnectNotice(db, user.id);
  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}
