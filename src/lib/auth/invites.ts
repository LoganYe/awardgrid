/**
 * Invite codes (kickoff §5, §12 "Auth"): `pnpm admin invite --for alice` mints one; registration
 * consumes it exactly once. Codes are 12 chars from the base64url alphabet (64 symbols, so a
 * byte masked to 6 bits is uniformly distributed) = 72 bits of entropy.
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { type ClockOptions, type DbConn as Db, resolveNow } from "@/lib/auth/clock";
import { AuthError } from "@/lib/auth/errors";
import { inviteCodes } from "@/lib/db/schema";

export const INVITE_CODE_LENGTH = 12;
export const INVITE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CODE_RE = /^[A-Za-z0-9_-]{12}$/;

export function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let out = "";
  for (const b of bytes) out += INVITE_ALPHABET[b & 63];
  return out;
}

/** Cheap shape check so garbage never reaches the database. */
export function isInviteCodeShape(code: string): boolean {
  return CODE_RE.test(code);
}

export interface CreateInviteInput {
  /** Who minted it: a user id or "admin" for the CLI. */
  createdBy: string;
  /** Optional hint of the intended recipient (never enforced). */
  intendedFor?: string;
}

export interface InviteRecord {
  code: string;
  createdBy: string;
  intendedFor: string | null;
  createdAt: string;
  usedBy: string | null;
  usedAt: string | null;
}

export function createInvite(db: Db, input: CreateInviteInput, opts: ClockOptions = {}): { code: string } {
  const createdAt = resolveNow(opts).toISOString();
  const intendedFor = input.intendedFor?.trim() || null;
  // Retry on the (astronomically unlikely) primary-key collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    try {
      db.insert(inviteCodes).values({ code, createdBy: input.createdBy, intendedFor, createdAt }).run();
      return { code };
    } catch (err) {
      if (attempt === 4) throw err;
    }
  }
  throw new Error("unreachable");
}

/**
 * Can `code` still be redeemed? A cheap, NON-consuming read used to reject a bad invite before
 * the caller spends argon2 time on the password (src/lib/auth/users.ts). It is deliberately
 * advisory: `consumeInvite` inside the registration transaction stays the single-use gate, so
 * two requests racing on one code still cannot both win.
 */
export function isInviteRedeemable(db: Db, code: string): boolean {
  const trimmed = code.trim();
  if (!isInviteCodeShape(trimmed)) return false;
  const row = db.select({ usedBy: inviteCodes.usedBy }).from(inviteCodes).where(eq(inviteCodes.code, trimmed)).get();
  return row !== undefined && row.usedBy === null;
}

/**
 * Mark `code` as used by `userId`. Atomic: one UPDATE guarded by `used_by IS NULL`, so two
 * concurrent registrations with the same code cannot both succeed. Throws
 * AuthError("invalid_invite") when the code is unknown or already consumed.
 */
export function consumeInvite(db: Db, code: string, userId: string, opts: ClockOptions = {}): void {
  const trimmed = code.trim();
  if (!isInviteCodeShape(trimmed)) throw new AuthError("invalid_invite");
  const usedAt = resolveNow(opts).toISOString();
  const result = db
    .update(inviteCodes)
    .set({ usedBy: userId, usedAt })
    .where(and(eq(inviteCodes.code, trimmed), isNull(inviteCodes.usedBy)))
    .run();
  if (result.changes !== 1) throw new AuthError("invalid_invite");
}

/** Every invite, newest first. */
export function listInvites(db: Db): InviteRecord[] {
  return db
    .select()
    .from(inviteCodes)
    .orderBy(sql`${inviteCodes.createdAt} DESC`)
    .all();
}

/** Invites that can still be redeemed. */
export function listUnusedInvites(db: Db): InviteRecord[] {
  return db
    .select()
    .from(inviteCodes)
    .where(isNull(inviteCodes.usedBy))
    .orderBy(sql`${inviteCodes.createdAt} DESC`)
    .all();
}
