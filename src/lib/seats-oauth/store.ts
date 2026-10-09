/**
 * Where the web app keeps each account's seats.aero sign-in tokens: one `seats_connections` row per account, the
 * access and refresh tokens encrypted together with MASTER_KEY (AES-256-GCM, the account id as additional data).
 *
 * Rules enforced here:
 *   - The tokens never leave the server: nothing here returns them except `readConnection`, whose only callers are
 *     ./access.ts (which hands the access token to the seats.aero client) and the refresh it runs. Status reads
 *     (`connectionStatus`, `isSeatsConnected`) return dates and a boolean.
 *   - Only seats.aero's own token shapes are stored ("seats:ota:…", "seats:otr:…").
 *   - Every write moves `generation`; a refresh writes only over the generation it read (`writeRefreshed`), so a
 *     concurrent refresh, a Disconnect or a new Connect is never overwritten by a stale one.
 *   - Nothing here logs.
 */
import { and, eq, sql } from "drizzle-orm";
import { type ClockOptions, type DbConn, resolveNow } from "@/lib/auth/clock";
import { decryptSecret, encryptSecret } from "@/lib/crypto/aes";
import { seatsConnections, users } from "@/lib/db/schema";
import { isAccessToken, isRefreshToken } from "./broker";

export interface SeatsTokens {
  /** "seats:ota:…": sent as `Partner-Authorization: Bearer seats:ota:…`. */
  access: string;
  /** "seats:otr:…": sent only to the token service, to get a new access token. */
  refresh: string;
  /** When the access token expires, ms since the epoch. */
  expiresAt: number;
}

export interface StoredConnection {
  tokens: SeatsTokens;
  generation: number;
}

/** What the settings page may show: never a token. */
export interface ConnectionStatus {
  connected: boolean;
  connectedAt: string | null;
}

/** The additional data the tokens are sealed with: the account they belong to. */
export function tokenAad(userId: string): string {
  return `seats-oauth:${userId}`;
}

function seal(tokens: Pick<SeatsTokens, "access" | "refresh">, userId: string, masterKey: Buffer) {
  if (!isAccessToken(tokens.access) || !isRefreshToken(tokens.refresh)) throw new RangeError("Refusing to store tokens that are not seats.aero's.");
  return encryptSecret(JSON.stringify({ access: tokens.access, refresh: tokens.refresh }), masterKey, tokenAad(userId));
}

/**
 * Save the tokens a code exchange returned, replacing any connection the account had, and clear the one-time
 * "connect seats.aero" notice. Returns the new generation.
 */
export function saveConnection(
  db: DbConn,
  userId: string,
  grant: { access: string; refresh: string; expiresIn: number },
  opts: ClockOptions & { masterKey: Buffer },
): number {
  const now = resolveNow(opts);
  const blob = seal(grant, userId, opts.masterKey);
  const expiresAt = new Date(now.getTime() + grant.expiresIn * 1000).toISOString();
  return db.transaction((tx) => {
    const row = tx
      .insert(seatsConnections)
      .values({ userId, ...blob, expiresAt, generation: 1, connectedAt: now.toISOString(), refreshedAt: null })
      .onConflictDoUpdate({
        target: seatsConnections.userId,
        set: { ...blob, expiresAt, generation: sql`${seatsConnections.generation} + 1`, connectedAt: now.toISOString(), refreshedAt: null },
      })
      .returning({ generation: seatsConnections.generation })
      .get();
    tx.update(users).set({ seatsReconnectNotice: false }).where(eq(users.id, userId)).run();
    return row.generation;
  });
}

/**
 * The account's tokens and their generation, or null when nothing is connected. A row that does not open (MASTER_KEY
 * changed, a damaged or copied row) or holds anything but seats.aero's tokens reads as no connection: the person is
 * asked to connect again, which replaces it.
 */
export function readConnection(db: DbConn, userId: string, masterKey: Buffer): StoredConnection | null {
  const row = db.select().from(seatsConnections).where(eq(seatsConnections.userId, userId)).get();
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptSecret(row, masterKey, tokenAad(userId)));
  } catch {
    return null;
  }
  const p = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const expiresAt = Date.parse(row.expiresAt);
  if (!isAccessToken(p.access) || !isRefreshToken(p.refresh) || !Number.isFinite(expiresAt)) return null;
  return { tokens: { access: p.access, refresh: p.refresh, expiresAt }, generation: row.generation };
}

/**
 * Write a refresh's tokens over generation `generation` only. False when the row moved on meanwhile (another
 * refresh, a Disconnect, a new Connect): nothing is written then.
 */
export function writeRefreshed(
  db: DbConn,
  userId: string,
  generation: number,
  tokens: SeatsTokens,
  opts: ClockOptions & { masterKey: Buffer },
): boolean {
  const blob = seal(tokens, userId, opts.masterKey);
  const res = db
    .update(seatsConnections)
    .set({ ...blob, expiresAt: new Date(tokens.expiresAt).toISOString(), generation: sql`${seatsConnections.generation} + 1`, refreshedAt: resolveNow(opts).toISOString() })
    .where(and(eq(seatsConnections.userId, userId), eq(seatsConnections.generation, generation)))
    .run();
  return res.changes > 0;
}

/** Remove the account's tokens. With `generation`, only when the row is still that one (a revocation found by a refresh). */
export function deleteConnection(db: DbConn, userId: string, generation?: number): boolean {
  const where = generation === undefined ? eq(seatsConnections.userId, userId) : and(eq(seatsConnections.userId, userId), eq(seatsConnections.generation, generation));
  return db.delete(seatsConnections).where(where).run().changes > 0;
}

/** Whether the account has a connection on file. Reads no token and needs no MASTER_KEY. */
export function isSeatsConnected(db: DbConn, userId: string): boolean {
  return db.select({ userId: seatsConnections.userId }).from(seatsConnections).where(eq(seatsConnections.userId, userId)).get() !== undefined;
}

export function connectionStatus(db: DbConn, userId: string): ConnectionStatus {
  const row = db.select({ connectedAt: seatsConnections.connectedAt }).from(seatsConnections).where(eq(seatsConnections.userId, userId)).get();
  return row ? { connected: true, connectedAt: row.connectedAt } : { connected: false, connectedAt: null };
}

/** Whether to say, once, that the pasted key was removed and seats.aero is now connected through its own sign-in. */
export function reconnectNoticeDue(db: DbConn, userId: string): boolean {
  const row = db.select({ notice: users.seatsReconnectNotice }).from(users).where(eq(users.id, userId)).get();
  return row?.notice === true && !isSeatsConnected(db, userId);
}

export function dismissReconnectNotice(db: DbConn, userId: string): void {
  db.update(users).set({ seatsReconnectNotice: false }).where(eq(users.id, userId)).run();
}
