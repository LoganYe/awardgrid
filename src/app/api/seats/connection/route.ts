/**
 * DELETE /api/seats/connection → 204 (idempotent: 204 when nothing was connected) | 401 unauthorized
 *
 * Disconnect: the account's seats.aero tokens are deleted, its sign-ins under way are forgotten, and every seats.aero
 * result the server holds for it is purged (src/lib/seats-oauth/retention.ts purgeSeatsDataForUser). The settings page
 * then removes what this browser kept for the account. seats.aero offers no revocation call; the person can also remove
 * AwardGrid in their seats.aero settings, which the next refresh notices.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServerDb } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { clearPendingStates, deleteConnection, purgeSeatsDataForUser } from "@/lib/seats-oauth";
import { userFromRequest } from "../../keys/session";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(request, db);
  if (!user) return jsonError(401, "unauthorized");
  db.transaction((tx) => {
    deleteConnection(tx, user.id);
    clearPendingStates(tx, user.id);
    purgeSeatsDataForUser(tx, user.id);
  });
  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}
