/**
 * Resolve the signed-in user from the request's session cookie (no next/headers, so route
 * handlers stay testable with a plain NextRequest). Shared by /api/keys, /api/settings and
 * /api/auth/logout-all.
 */
import type { NextRequest } from "next/server";
import { getSessionUser, SESSION_COOKIE, type User } from "@/lib/auth";
import type { DbConn } from "@/lib/auth/clock";

export function userFromRequest(request: NextRequest, db: DbConn): User | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return token ? getSessionUser(db, token) : null;
}
