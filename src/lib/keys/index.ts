/**
 * Encrypted per-user API key store (kickoff §0.2 #2 and #8, §5).
 *
 * Rules enforced here:
 *   - AES-256-GCM with MASTER_KEY; the database holds ciphertext/iv/tag + last4 only.
 *   - `getDecryptedKey` / `requireKey` are the ONLY way to obtain plaintext, and they need the
 *     master key passed in explicitly so a caller cannot get one by accident.
 *   - `listKeys` output (what the UI and JSON responses see) carries last4 + "••••1234" only.
 *   - There is no default/server key: no key on file → NoKeyError, never a fallback (§0.2 #2).
 *   - Nothing here logs. Errors never contain key material.
 */
import { and, eq, sql } from "drizzle-orm";
import { type ClockOptions, type DbConn as Db, resolveNow } from "@/lib/auth/clock";
import { decryptSecret, encryptSecret, last4, maskedKey, parseMasterKey } from "@/lib/crypto/aes";
import { KEY_PROVIDERS, type KeyProvider, userKeys } from "@/lib/db/schema";
import {
  SeatsAeroClient,
  SeatsAeroHttpError,
  SeatsAeroNetworkError,
  SeatsAeroResponseError,
  type SeatsAeroCallListener,
} from "@/lib/seatsaero/client";
import { type QuotaStore, utcDayKey } from "@/lib/seatsaero/quota";

export type { KeyProvider };
export { KEY_PROVIDERS };

export const MAX_KEY_LENGTH = 512;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The user has no key for `provider`. Message is safe to show; it never echoes anything secret. */
export class NoKeyError extends Error {
  readonly code = "no_key" as const;
  readonly provider: KeyProvider;
  constructor(provider: KeyProvider) {
    super(`No ${PROVIDER_LABELS[provider]} API key on file. Add one in Settings.`);
    this.name = "NoKeyError";
    this.provider = provider;
  }
}

export type KeyErrorCode = "empty" | "too_long" | "invalid_provider";

/** A submitted key was rejected before touching the database. */
export class KeyError extends Error {
  readonly code: KeyErrorCode;
  constructor(code: KeyErrorCode, message: string) {
    super(message);
    this.name = "KeyError";
    this.code = code;
  }
}

export const PROVIDER_LABELS: Record<KeyProvider, string> = {
  seats_aero: "seats.aero",
  duffel: "Duffel",
  ignav: "Ignav",
};

export function isKeyProvider(value: unknown): value is KeyProvider {
  return typeof value === "string" && (KEY_PROVIDERS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Master key
// ---------------------------------------------------------------------------

let masterKeyCache: Buffer | null = null;

/** MASTER_KEY from the environment, parsed once. Throws MasterKeyError (without the value) if unset/malformed. */
export function getMasterKey(): Buffer {
  if (!masterKeyCache) masterKeyCache = parseMasterKey(process.env.MASTER_KEY);
  return masterKeyCache;
}

/** Test hook: forget the memoized master key. */
export function resetMasterKeyCache(): void {
  masterKeyCache = null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** What the UI and JSON responses may see. */
export interface KeySummary {
  provider: KeyProvider;
  last4: string;
  /** "••••1234" */
  masked: string;
  createdAt: string;
}

export function listKeys(db: Db, userId: string): KeySummary[] {
  return db
    .select({ provider: userKeys.provider, last4: userKeys.last4, createdAt: userKeys.createdAt })
    .from(userKeys)
    .where(eq(userKeys.userId, userId))
    .orderBy(sql`${userKeys.provider} ASC`)
    .all()
    .map((r) => ({ provider: r.provider, last4: r.last4, masked: maskedKey(r.last4), createdAt: r.createdAt }));
}

export interface SetKeyOptions extends ClockOptions {
  masterKey: Buffer;
}

/** Normalize a submitted key: trim, reject empty/too long. Exported for form validation. */
export function normalizeKeyInput(plaintext: unknown): string {
  if (typeof plaintext !== "string") throw new KeyError("empty", "API key is required.");
  const trimmed = plaintext.trim();
  if (trimmed.length === 0) throw new KeyError("empty", "API key is required.");
  if (trimmed.length > MAX_KEY_LENGTH) {
    throw new KeyError("too_long", `API key is too long (max ${MAX_KEY_LENGTH} characters).`);
  }
  return trimmed;
}

/** Encrypt and upsert (replace) the user's key for `provider`. Returns the safe summary. */
export function setKey(db: Db, userId: string, provider: KeyProvider, plaintext: string, opts: SetKeyOptions): KeySummary {
  if (!isKeyProvider(provider)) throw new KeyError("invalid_provider", "Unknown key provider.");
  const secret = normalizeKeyInput(plaintext);
  const blob = encryptSecret(secret, opts.masterKey);
  const l4 = last4(secret);
  const createdAt = resolveNow(opts).toISOString();
  db.insert(userKeys)
    .values({ userId, provider, ciphertext: blob.ciphertext, iv: blob.iv, tag: blob.tag, last4: l4, createdAt })
    .onConflictDoUpdate({
      target: [userKeys.userId, userKeys.provider],
      set: { ciphertext: blob.ciphertext, iv: blob.iv, tag: blob.tag, last4: l4, createdAt },
    })
    .run();
  return { provider, last4: l4, masked: maskedKey(l4), createdAt };
}

/** Delete the user's key for `provider`. Returns true when one existed. */
export function removeKey(db: Db, userId: string, provider: KeyProvider): boolean {
  return (
    db
      .delete(userKeys)
      .where(and(eq(userKeys.userId, userId), eq(userKeys.provider, provider)))
      .run().changes > 0
  );
}

/**
 * Decrypt the user's key for `provider`. THE only path to plaintext. Returns null when no key
 * is on file. Callers must pass the plaintext straight into a client and never log it.
 */
export function getDecryptedKey(db: Db, userId: string, provider: KeyProvider, masterKey: Buffer): string | null {
  const row = db
    .select({ ciphertext: userKeys.ciphertext, iv: userKeys.iv, tag: userKeys.tag })
    .from(userKeys)
    .where(and(eq(userKeys.userId, userId), eq(userKeys.provider, provider)))
    .get();
  if (!row) return null;
  return decryptSecret(row, masterKey);
}

/** getDecryptedKey that throws NoKeyError instead of returning null (fast lane, worker, ask lane). */
export function requireKey(db: Db, userId: string, provider: KeyProvider, masterKey: Buffer): string {
  const key = getDecryptedKey(db, userId, provider, masterKey);
  if (key === null) throw new NoKeyError(provider);
  return key;
}

export function hasKey(db: Db, userId: string, provider: KeyProvider): boolean {
  return (
    db
      .select({ userId: userKeys.userId })
      .from(userKeys)
      .where(and(eq(userKeys.userId, userId), eq(userKeys.provider, provider)))
      .get() !== undefined
  );
}

// ---------------------------------------------------------------------------
// seats.aero key validation (one cheap Cached Search; counts as 1 quota call)
// ---------------------------------------------------------------------------

export type KeyValidationResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unknown" }
  /** `timed_out`: the request left the process and may have reached seats.aero (charge it). */
  | { ok: false; reason: "network"; timed_out: boolean };

export interface ValidateKeyOptions extends ClockOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Fires once per HTTP request that left the process (so the caller can settle its quota reservation). */
  onCall?: SeatsAeroCallListener;
}

/**
 * Smallest documented Cached Search (take=10, one pair, one day). 401/403 → invalid; a
 * transport failure/timeout → network; any other non-2xx → unknown. A 200 with an unexpected
 * body still proves the key is accepted. The caller must record ONE quota call via
 * `recordValidationCall` — this function performs exactly one HTTP request.
 */
export async function validateSeatsAeroKey(plaintext: string, opts: ValidateKeyOptions = {}): Promise<KeyValidationResult> {
  let secret: string;
  try {
    secret = normalizeKeyInput(plaintext);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const today = utcDayKey(resolveNow(opts));
  const client = new SeatsAeroClient({ apiKey: secret, fetch: opts.fetch, timeoutMs: opts.timeoutMs, onCall: opts.onCall });
  try {
    await client.cachedSearch({
      origin_airport: ["SEA"],
      destination_airport: ["NRT"],
      start_date: today,
      end_date: today,
      take: 10,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof SeatsAeroResponseError) return { ok: true };
    if (err instanceof SeatsAeroHttpError) return { ok: false, reason: err.kind === "invalid_key" ? "invalid" : "unknown" };
    if (err instanceof SeatsAeroNetworkError) return { ok: false, reason: "network", timed_out: err.timedOut };
    return { ok: false, reason: "unknown" };
  }
}

/** Charge the single validation request to the user's seats.aero quota. Returns the day's new total. */
export async function recordValidationCall(store: QuotaStore, userId: string, day?: string): Promise<number> {
  return store.increment(userId, day ?? utcDayKey(new Date()), 1);
}
