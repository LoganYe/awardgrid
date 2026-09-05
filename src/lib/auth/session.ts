/**
 * httpOnly cookie sessions (kickoff §12 "Auth"). The cookie carries a random 256-bit token;
 * the database stores only SHA-256(token), so a leaked database cannot be replayed as a cookie.
 */
import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { type ClockOptions, type DbConn as Db, resolveNow } from "@/lib/auth/clock";
import { type User, toPublicUser } from "@/lib/auth/users";
import { sessions, users } from "@/lib/db/schema";

export const SESSION_COOKIE = "ag_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes base64url, unpadded

export interface CreatedSession {
  /** The cookie value. Hand it to withSessionCookie(); never store or log it. */
  token: string;
  expiresAt: Date;
}

/** SHA-256 hex of a cookie token — the sessions.id column. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isSessionTokenShape(token: string): boolean {
  return TOKEN_RE.test(token);
}

export function createSession(db: Db, userId: string, opts: ClockOptions = {}): CreatedSession {
  const now = resolveNow(opts);
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.insert(sessions)
    .values({ id: hashSessionToken(token), userId, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() })
    .run();
  return { token, expiresAt };
}

/**
 * Resolve a cookie token to its user. Unknown, malformed or expired tokens yield null; an
 * expired row is deleted on the way out.
 */
export function getSessionUser(db: Db, token: string | undefined | null, opts: ClockOptions = {}): User | null {
  if (typeof token !== "string" || !isSessionTokenShape(token)) return null;
  const id = hashSessionToken(token);
  const row = db
    .select({ expiresAt: sessions.expiresAt, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;
  if (Date.parse(row.expiresAt) <= resolveNow(opts).getTime()) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }
  return toPublicUser(row.user);
}

/** Delete one session by its cookie token. Returns true when a row was removed. */
export function revokeSession(db: Db, token: string): boolean {
  if (typeof token !== "string" || !isSessionTokenShape(token)) return false;
  return db.delete(sessions).where(eq(sessions.id, hashSessionToken(token))).run().changes > 0;
}

/** Delete every session of a user (admin `revoke-sessions`, password change). Returns the count. */
export function revokeAllSessions(db: Db, userId: string): number {
  return db.delete(sessions).where(eq(sessions.userId, userId)).run().changes;
}

/** Housekeeping: drop rows past their expiry. Returns the count. */
export function purgeExpiredSessions(db: Db, opts: ClockOptions = {}): number {
  return db.delete(sessions).where(lt(sessions.expiresAt, resolveNow(opts).toISOString())).run().changes;
}

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  expires: Date;
}

export function cookieOptions(expiresAt: Date, opts: { secure: boolean }): SessionCookieOptions {
  return { httpOnly: true, sameSite: "lax", path: "/", secure: opts.secure, expires: expiresAt };
}

/**
 * Whether the session cookie should carry `Secure`. Production defaults to true; set
 * COOKIE_SECURE=false for a plain-HTTP deployment behind Tailscale, or =true to force it.
 */
export function cookieSecureFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.COOKIE_SECURE?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return env.NODE_ENV === "production";
}
