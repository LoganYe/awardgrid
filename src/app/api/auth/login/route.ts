/**
 * POST /api/auth/login { username, password }
 *   200 { user: { id, username } } + session cookie
 *   401 { error: invalid_credentials }
 *   429 { error: rate_limited } (Retry-After set) — three layers: 200 attempts / 15 min per
 *       process, 20 per username, 10 per username+IP (IP only trusted behind TRUST_PROXY_HEADERS)
 *
 * Cross-site POSTs are rejected upstream by src/proxy.ts; readJson also requires a JSON
 * Content-Type. The username is length-capped and normalised BEFORE it becomes a limiter key
 * or reaches argon2, so malformed names cost neither memory nor CPU.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticate, createSession, isAuthError, normalizeUsername, USERNAME_MAX } from "@/lib/auth";
import { withSessionCookie } from "@/lib/auth/next";
import { getServerDb } from "@/lib/server/db";
import { BodyError, jsonError, readJson } from "@/lib/server/http";
import { clientIp, resetLoginThrottle, throttleLogin } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/** Upper bound on a password we are willing to hash-verify (argon2 cost grows with length). */
export const PASSWORD_MAX = 1024;

const Body = z.object({
  username: z.string().trim().max(USERNAME_MAX),
  password: z.string().max(PASSWORD_MAX),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: z.infer<typeof Body>;
  try {
    body = await readJson(request, Body);
  } catch (err) {
    if (err instanceof BodyError) return jsonError(400, "invalid_body");
    throw err;
  }

  // Invalid names cannot belong to any account: throttle them under one shared key and answer
  // 401 without spending an argon2 verification (the format rule is public, so nothing leaks).
  const username = normalizeUsername(body.username);
  const ip = clientIp(request.headers);
  const limit = throttleLogin(username ?? "", ip);
  if (!limit.ok) {
    return jsonError(429, "rate_limited", { headers: { "retry-after": String(limit.retryAfterSec) } });
  }
  if (username === null) return jsonError(401, "invalid_credentials");

  const db = getServerDb();
  try {
    const user = await authenticate(db, { username, password: body.password });
    resetLoginThrottle(username, ip);
    const session = createSession(db, user.id);
    const res = NextResponse.json({ user: { id: user.id, username: user.username } }, { status: 200 });
    return withSessionCookie(res, session.token, session.expiresAt);
  } catch (err) {
    if (isAuthError(err, "invalid_credentials")) return jsonError(401, "invalid_credentials");
    console.error("login failed:", err instanceof Error ? err.name : typeof err);
    return jsonError(500, "internal");
  }
}
