/**
 * GET /api/auth/me → 200 { user: { id, username, locale, timezone, hasSeatsKey } } or 401.
 * Reads the session cookie from the request (testable without next/headers).
 */
import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { userKeys } from "@/lib/db/schema";
import { getServerDb } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

export interface MeResponse {
  user: { id: string; username: string; locale: string; timezone: string; hasSeatsKey: boolean };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const db = getServerDb();
  const user = token ? getSessionUser(db, token) : null;
  if (!user) return jsonError(401, "unauthorized");

  const key = db
    .select({ last4: userKeys.last4 })
    .from(userKeys)
    .where(and(eq(userKeys.userId, user.id), eq(userKeys.provider, "seats_aero")))
    .get();

  const body: MeResponse = {
    user: {
      id: user.id,
      username: user.username,
      locale: user.locale,
      timezone: user.timezone,
      hasSeatsKey: key !== undefined,
    },
  };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
