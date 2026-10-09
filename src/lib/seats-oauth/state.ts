/**
 * The state of a Connect seats.aero under way: made here, sent to seats.aero's consent page, and accepted back once,
 * for the account that started it, within STATE_TTL_MS.
 *
 * Shape: `web_` and 43 base64url characters (32 random bytes). The token service (sites/auth WEB_STATE_RE) sends a
 * state of exactly this shape to the web app's callback and every other one to the iPhone app's scheme, so the
 * prefix is what brings the person back here. Only the state's SHA-256 is stored.
 *
 * What the check protects: the callback is a plain GET that anyone can link to. A code arriving with a state this
 * account did not just start (another account's, an old one, a forged one) is refused before it is exchanged, so no
 * one can attach their seats.aero account to someone else's AwardGrid account, or replay a sign-in.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, lt, notInArray, desc } from "drizzle-orm";
import { type ClockOptions, type DbConn, resolveNow } from "@/lib/auth/clock";
import { seatsOauthStates } from "@/lib/db/schema";

export const WEB_STATE_PREFIX = "web_";
/** The same shape the token service routes on (sites/auth/src/index.ts WEB_STATE_RE). */
export const WEB_STATE_RE = /^web_[A-Za-z0-9_-]{43}$/;
/** How long seats.aero's sign-in may take before the state is no longer accepted. */
export const STATE_TTL_MS = 10 * 60_000;
/** Sign-ins one account may have under way at once (several tabs); older ones are dropped. */
export const MAX_PENDING_STATES = 5;

/** A fresh web state: `web_` + 32 random bytes as base64url. */
export function randomWebState(random: (size: number) => Buffer = randomBytes): string {
  return `${WEB_STATE_PREFIX}${random(32).toString("base64url")}`;
}

export function hashState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

/**
 * Record a new sign-in for `userId` and return its state. Expired states, and this account's sign-ins beyond the
 * newest MAX_PENDING_STATES, are removed on the way.
 */
export function beginConnect(db: DbConn, userId: string, opts: ClockOptions & { state?: string } = {}): string {
  const now = resolveNow(opts);
  const state = opts.state ?? randomWebState();
  if (!WEB_STATE_RE.test(state)) throw new RangeError("not a web state");
  db.transaction((tx) => {
    tx.delete(seatsOauthStates).where(lt(seatsOauthStates.expiresAt, now.toISOString())).run();
    tx.insert(seatsOauthStates)
      .values({ stateHash: hashState(state), userId, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + STATE_TTL_MS).toISOString() })
      .run();
    const keep = tx
      .select({ stateHash: seatsOauthStates.stateHash })
      .from(seatsOauthStates)
      .where(eq(seatsOauthStates.userId, userId))
      .orderBy(desc(seatsOauthStates.createdAt))
      .limit(MAX_PENDING_STATES);
    tx.delete(seatsOauthStates)
      .where(and(eq(seatsOauthStates.userId, userId), notInArray(seatsOauthStates.stateHash, keep)))
      .run();
  });
  return state;
}

export type StateCheck = "ok" | "unknown" | "expired";

/**
 * Accept `state` once for `userId`: "ok" when this account started it and it has not expired. A state this account
 * started is removed whatever the answer, so it cannot be used twice; another account's is left alone.
 */
export function consumeState(db: DbConn, userId: string, state: string, opts: ClockOptions = {}): StateCheck {
  if (!WEB_STATE_RE.test(state)) return "unknown";
  const row = db
    .delete(seatsOauthStates)
    .where(and(eq(seatsOauthStates.stateHash, hashState(state)), eq(seatsOauthStates.userId, userId)))
    .returning({ expiresAt: seatsOauthStates.expiresAt })
    .get();
  if (!row) return "unknown";
  return Date.parse(row.expiresAt) > resolveNow(opts).getTime() ? "ok" : "expired";
}

/** Forget every sign-in this account has under way (Disconnect). */
export function clearPendingStates(db: DbConn, userId: string): number {
  return db.delete(seatsOauthStates).where(eq(seatsOauthStates.userId, userId)).run().changes;
}
