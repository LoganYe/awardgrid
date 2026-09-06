/**
 * POST /api/auth/password { current, next } → change the signed-in user's password.
 *
 *   200 { ok: true } + a FRESH session cookie
 *   400 { error: "invalid_body" | "invalid_current" | "weak_password" }
 *   401 { error: "unauthorized" }   403 { error: "forbidden_origin" }   500 { error: "internal" }
 *   429 { error: "rate_limited" } (Retry-After set) — 10 attempts / 15 min per user, 60 per process
 *
 * Body: `{ current, next }`. `{ currentPassword, newPassword }` (the spelling in
 * docs/UI_PLAN.md §6.8) is accepted as an alias so the settings form works either way; exactly
 * one spelling of each field must be present.
 *
 * Sessions: every session of this user is revoked and a new one is created for THIS request, so
 * a password change logs out every other device while the person changing it stays logged in
 * with a rotated token. The cookie is set with the same flags as login.
 *
 * Guards, in order: same-origin (src/proxy.ts applies checkOrigin to every /api/* non-safe
 * method; repeated here so the handler is safe on its own), a JSON content type, a session,
 * then the rate limiter, then one argon2 verification of the current password. Error bodies are
 * codes only.
 *
 * Rate limiting matters here as much as on login: the handler runs TWO argon2id operations per
 * request (64 MiB each), and a wrong `current` answers `invalid_current` — which, to whoever
 * holds a stolen session cookie, is an oracle for guessing the account password, the one thing
 * the current-password check exists to prevent. The bucket is keyed on the user id, so it
 * follows the account rather than a header the client controls, and a successful change clears
 * it.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { changePassword, createSession, isAuthError, PASSWORD_MIN, revokeAllSessions } from "@/lib/auth";
import { withSessionCookie } from "@/lib/auth/next";
import { getServerDb } from "@/lib/server/db";
import { hasJsonContentType, jsonError } from "@/lib/server/http";
import { checkOrigin } from "@/lib/server/origin";
import { resetPasswordThrottle, throttlePasswordChange } from "@/lib/server/rate-limit";
import { userFromRequest } from "../../keys/session";

export const runtime = "nodejs";

/** Upper bound on a password we are willing to hash (argon2 cost grows with length) — same as login. */
export const PASSWORD_MAX = 1024;

export type PasswordErrorCode = "invalid_current" | "weak_password";

const Body = z
  .object({
    current: z.string().max(PASSWORD_MAX).optional(),
    next: z.string().max(PASSWORD_MAX).optional(),
    currentPassword: z.string().max(PASSWORD_MAX).optional(),
    newPassword: z.string().max(PASSWORD_MAX).optional(),
  })
  .strict();

function passwordError(error: PasswordErrorCode): NextResponse {
  return NextResponse.json({ error }, { status: 400, headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!checkOrigin(request.method, request.headers).ok) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const db = getServerDb();
  const user = userFromRequest(request, db);
  if (!user) return jsonError(401, "unauthorized");

  if (!hasJsonContentType(request)) return jsonError(400, "invalid_body");
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid_body");
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError(400, "invalid_body");
  const current = parsed.data.current ?? parsed.data.currentPassword;
  const next = parsed.data.next ?? parsed.data.newPassword;
  if (current === undefined || next === undefined) return jsonError(400, "invalid_body");
  // Cheap check first so an obviously short password never reaches argon2 twice.
  if (next.length < PASSWORD_MIN) return passwordError("weak_password");

  const limit = throttlePasswordChange(user.id);
  if (!limit.ok) {
    return jsonError(429, "rate_limited", { headers: { "retry-after": String(limit.retryAfterSec) } });
  }

  try {
    await changePassword(db, user.id, { current, next });
  } catch (err) {
    if (isAuthError(err, "invalid_credentials")) return passwordError("invalid_current");
    if (isAuthError(err, "weak_password")) return passwordError("weak_password");
    // Name only — a message could carry the password or the hash.
    console.error("[api/auth/password] failed:", err instanceof Error ? err.name : typeof err);
    return jsonError(500, "internal");
  }

  // The caller proved they knew the password; forget their bucket.
  resetPasswordThrottle(user.id);
  // Every other device is logged out; this request gets a brand-new session token.
  revokeAllSessions(db, user.id);
  const session = createSession(db, user.id);
  const res = NextResponse.json({ ok: true }, { status: 200, headers: { "cache-control": "no-store" } });
  return withSessionCookie(res, session.token, session.expiresAt);
}
