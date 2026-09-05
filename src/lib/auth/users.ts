/**
 * Users: invite-code registration, password login, settings (kickoff §5, §12 "Auth").
 *
 * The `User` returned from every function here is the schema row WITHOUT `passwordHash`, so a
 * user object can be passed to a React prop or JSON-encoded without leaking anything.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { type ClockOptions, type DbConn as Db, resolveNow } from "@/lib/auth/clock";
import { AuthError, SettingsValidationError } from "@/lib/auth/errors";
import { consumeInvite } from "@/lib/auth/invites";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { userKeys, users, type User as DbUser } from "@/lib/db/schema";

/** Public user shape: never carries the password hash. */
export type User = Omit<DbUser, "passwordHash">;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/;
export const PASSWORD_MIN = 8;
export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * A real argon2id hash (same parameters as hashPassword) of a throwaway random password. When
 * the username does not exist we verify against it so the unknown-user path costs the same as
 * a wrong-password one (kickoff: constant-time-ish authenticate).
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=1$gfu8L1vWH6rhEUAcnHp9iw$6AN0xZgGpvkjj/iaX3yjLxxlU0zI6PJQxCR7cDP9We8";

export function toPublicUser(row: DbUser): User {
  // Destructure so the hash never rides along, even if columns are added later.
  const { passwordHash: _hash, ...rest } = row;
  return rest;
}

/** Lower-cases and trims; returns null when the result is not a valid username. */
export function normalizeUsername(raw: string): string | null {
  const u = raw.trim().toLowerCase();
  return USERNAME_RE.test(u) ? u : null;
}

export interface RegisterInput {
  inviteCode: string;
  username: string;
  password: string;
}

/**
 * Register a new user with an invite code. Order: validate → hash (slow, outside the
 * transaction) → transaction { username free? → consume invite → insert }. Any failure inside
 * the transaction rolls everything back, so a rejected username never burns an invite.
 */
export async function registerWithInvite(db: Db, input: RegisterInput, opts: ClockOptions = {}): Promise<User> {
  const username = normalizeUsername(input.username);
  if (!username) throw new AuthError("invalid_username");
  if (typeof input.password !== "string" || input.password.length < PASSWORD_MIN) {
    throw new AuthError("weak_password");
  }
  const passwordHash = await hashPassword(input.password);
  const now = resolveNow(opts);
  const id = randomUUID();

  const row = db.transaction((tx) => {
    const existing = tx.select({ id: users.id }).from(users).where(eq(users.username, username)).get();
    if (existing) throw new AuthError("username_taken");
    consumeInvite(tx, input.inviteCode, id, { now });
    try {
      return tx
        .insert(users)
        .values({ id, username, passwordHash, createdAt: now.toISOString() })
        .returning()
        .get();
    } catch (err) {
      // Lost a race with a concurrent registration of the same name.
      if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new AuthError("username_taken");
      throw err;
    }
  });
  if (!row) throw new Error("user insert returned no row");
  return toPublicUser(row);
}

export interface AuthenticateInput {
  username: string;
  password: string;
}

export interface AuthenticateDeps {
  /** Injectable for tests (spy on the verify path). Defaults to argon2 verifyPassword. */
  verify?: typeof verifyPassword;
}

/**
 * Username + password login. Unknown user and wrong password fail with the SAME error, and
 * both paths run one argon2 verification (against a dummy hash when the user is unknown).
 */
export async function authenticate(db: Db, input: AuthenticateInput, deps: AuthenticateDeps = {}): Promise<User> {
  const verify = deps.verify ?? verifyPassword;
  const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const row = username ? db.select().from(users).where(eq(users.username, username)).get() : undefined;
  const ok = await verify(password, row?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!row || !ok) throw new AuthError("invalid_credentials");
  return toPublicUser(row);
}

export function getUserById(db: Db, id: string): User | null {
  const row = db.select().from(users).where(eq(users.id, id)).get();
  return row ? toPublicUser(row) : null;
}

export function getUserByUsername(db: Db, username: string): User | null {
  const u = username.trim().toLowerCase();
  const row = db.select().from(users).where(eq(users.username, u)).get();
  return row ? toPublicUser(row) : null;
}

export interface UserSummary {
  id: string;
  username: string;
  createdAt: string;
  hasSeatsKey: boolean;
}

/** Every user with whether a seats.aero key is on file (never the key itself). */
export function listUsers(db: Db): UserSummary[] {
  const rows = db
    .select({
      id: users.id,
      username: users.username,
      createdAt: users.createdAt,
      keyUser: userKeys.userId,
    })
    .from(users)
    .leftJoin(userKeys, and(eq(userKeys.userId, users.id), eq(userKeys.provider, "seats_aero")))
    .orderBy(sql`${users.createdAt} ASC, ${users.username} ASC`)
    .all();
  return rows.map((r) => ({ id: r.id, username: r.username, createdAt: r.createdAt, hasSeatsKey: r.keyUser !== null }));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface UserSettingsPatch {
  locale?: string;
  timezone?: string;
  /** "HH:MM" or null to clear. */
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidHHMM(value: string): boolean {
  return HHMM_RE.test(value);
}

let zoneSet: Set<string> | null | undefined;

/** IANA zone check: Intl.supportedValuesOf when available, else a DateTimeFormat probe. */
export function isValidTimeZone(zone: string): boolean {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) return false;
  if (zone === "UTC") return true;
  if (zoneSet === undefined) {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    zoneSet = typeof intl.supportedValuesOf === "function" ? new Set(intl.supportedValuesOf("timeZone")) : null;
  }
  if (zoneSet) return zoneSet.has(zone);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function updateUserSettings(db: Db, userId: string, patch: UserSettingsPatch): User {
  const set: Partial<DbUser> = {};
  if (patch.locale !== undefined) {
    if (!(LOCALES as readonly string[]).includes(patch.locale)) {
      throw new SettingsValidationError("locale", `locale must be one of ${LOCALES.join(", ")}`);
    }
    set.locale = patch.locale;
  }
  if (patch.timezone !== undefined) {
    if (!isValidTimeZone(patch.timezone)) throw new SettingsValidationError("timezone", "unknown IANA time zone");
    set.timezone = patch.timezone;
  }
  if (patch.quietHoursStart !== undefined) {
    if (patch.quietHoursStart !== null && !isValidHHMM(patch.quietHoursStart)) {
      throw new SettingsValidationError("quietHoursStart", "quiet hours start must be HH:MM (24h)");
    }
    set.quietHoursStart = patch.quietHoursStart;
  }
  if (patch.quietHoursEnd !== undefined) {
    if (patch.quietHoursEnd !== null && !isValidHHMM(patch.quietHoursEnd)) {
      throw new SettingsValidationError("quietHoursEnd", "quiet hours end must be HH:MM (24h)");
    }
    set.quietHoursEnd = patch.quietHoursEnd;
  }
  if (Object.keys(set).length === 0) {
    const current = getUserById(db, userId);
    if (!current) throw new Error("user not found");
    return current;
  }
  const row = db.update(users).set(set).where(eq(users.id, userId)).returning().get();
  if (!row) throw new Error("user not found");
  return toPublicUser(row);
}
