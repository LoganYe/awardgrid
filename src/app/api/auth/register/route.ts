/**
 * POST /api/auth/register { inviteCode, username, password }
 *   201 { user: { id, username } } + session cookie
 *   400 { error: invalid_body | invalid_invite | invalid_username | weak_password | username_taken | registration_failed }
 *   429 { error: rate_limited } (Retry-After set) — 60 attempts / 15 min per process, 20 per IP
 *
 * This route is unauthenticated and spends argon2id (64 MiB, timeCost 3) on the submitted
 * password, so it gets the same coarse brake login has. `registerWithInvite` additionally
 * rejects an unusable invite code BEFORE hashing, so a request with no valid code costs
 * nothing but a SELECT.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSession, isAuthError, registerWithInvite, USERNAME_MAX } from "@/lib/auth";
import { withSessionCookie } from "@/lib/auth/next";
import { getServerDb } from "@/lib/server/db";
import { BodyError, jsonError, readJson, type ApiErrorCode } from "@/lib/server/http";
import { clientIp, throttleRegister } from "@/lib/server/rate-limit";

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

  const limit = throttleRegister(clientIp(request.headers));
  if (!limit.ok) {
    return jsonError(429, "rate_limited", { headers: { "retry-after": String(limit.retryAfterSec) } });
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
