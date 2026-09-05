/**
 * POST /api/auth/register { inviteCode, username, password }
 *   201 { user: { id, username } } + session cookie
 *   400 { error: invalid_body | invalid_invite | invalid_username | weak_password | username_taken | registration_failed }
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSession, isAuthError, registerWithInvite, USERNAME_MAX } from "@/lib/auth";
import { withSessionCookie } from "@/lib/auth/next";
import { getServerDb } from "@/lib/server/db";
import { BodyError, jsonError, readJson, type ApiErrorCode } from "@/lib/server/http";

export const runtime = "nodejs";

/** Upper bound on a password we are willing to argon2-hash. */
const PASSWORD_MAX = 1024;

const Body = z.object({
  inviteCode: z.string().trim().min(1).max(128),
  // Length-capped up front so an oversized body never reaches the validator or argon2
  // (registerWithInvite still enforces the real username/password rules).
  username: z.string().max(USERNAME_MAX * 4),
  password: z.string().max(PASSWORD_MAX),
});

const REGISTER_ERRORS: ReadonlySet<ApiErrorCode> = new Set([
  "invalid_invite",
  "invalid_username",
  "weak_password",
  "username_taken",
]);

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: z.infer<typeof Body>;
  try {
    body = await readJson(request, Body);
  } catch (err) {
    if (err instanceof BodyError) return jsonError(400, "invalid_body");
    throw err;
  }

  const db = getServerDb();
  try {
    const user = await registerWithInvite(db, body);
    const session = createSession(db, user.id);
    const res = NextResponse.json({ user: { id: user.id, username: user.username } }, { status: 201 });
    return withSessionCookie(res, session.token, session.expiresAt);
  } catch (err) {
    if (isAuthError(err) && REGISTER_ERRORS.has(err.code as ApiErrorCode)) {
      return jsonError(400, err.code as ApiErrorCode);
    }
    // Unknown failure: log the class only, never the payload (kickoff §10).
    console.error("register failed:", err instanceof Error ? err.name : typeof err);
    return jsonError(400, "registration_failed");
  }
}
