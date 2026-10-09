/**
 * GET /api/auth/me → 200 { user: { id, username, locale, timezone, theme, seatsConnected } } or 401.
 * Reads the session cookie from the request (testable without next/headers).
 */
import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { isSeatsConnected } from "@/lib/seats-oauth";
import { getServerDb } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

export interface MeResponse {
  user: {
    id: string;
    username: string;
    locale: string;
    timezone: string;
    /** "system" | "light" | "dark" (Phase 6.1). */
    theme: "system" | "light" | "dark";
    /** Whether seats.aero is connected through Login with Seats.aero (never a token). */
    seatsConnected: boolean;
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const db = getServerDb();
  const user = token ? getSessionUser(db, token) : null;
  if (!user) return jsonError(401, "unauthorized");

  const body: MeResponse = {
    user: {
      id: user.id,
      username: user.username,
      locale: user.locale,
      timezone: user.timezone,
      theme: user.theme,
      seatsConnected: isSeatsConnected(db, user.id),
    },
  };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
