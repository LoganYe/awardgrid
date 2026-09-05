/**
 * POST /api/auth/logout → 204, revokes the session row and expires the cookie.
 * Idempotent: no cookie / unknown token still yields 204 with a cleared cookie.
 */
import { NextResponse, type NextRequest } from "next/server";
import { revokeSession, SESSION_COOKIE } from "@/lib/auth";
import { clearSessionCookie } from "@/lib/auth/next";
import { getServerDb } from "@/lib/server/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) revokeSession(getServerDb(), token);
  return clearSessionCookie(new NextResponse(null, { status: 204 }));
}
