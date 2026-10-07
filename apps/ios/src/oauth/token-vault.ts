/**
 * Where the OAuth flavour keeps its seats.aero tokens: one Keychain item, beside the pasted-key item (../native/
 * keychain.ts) and never mixed with it.
 *
 * The item holds the access token ("seats:ota:…", about an hour), the refresh token ("seats:otr:…", valid until the
 * person revokes AwardGrid in seats.aero or their account ends) and when the access token expires. Nothing else: no
 * seats.aero data, no account details (the token service never calls seats.aero's user-info endpoint).
 *
 * The same rules as the Anthropic item (../native/anthropic-key.ts), for the same reasons: access and sync are passed
 * on every call rather than set as the plugin's defaults, so neither of the other items' settings depends on which was
 * saved last; `afterFirstUnlockThisDeviceOnly`, as the pasted key, so a check on opening the app can read it, and
 * never in a backup or on another device; `sync: false` keeps it out of iCloud Keychain; and never
 * `SecureStorage.clear()`, which would remove every item under the plugin's prefix.
 */
import { KeychainAccess, SecureStorage } from "@aparajita/capacitor-secure-storage";

export const ACCESS_PREFIX = "seats:ota:";
export const REFRESH_PREFIX = "seats:otr:";
const ACCESS_RE = /^seats:ota:[A-Za-z0-9._~+/=-]{1,500}$/;
const REFRESH_RE = /^seats:otr:[A-Za-z0-9._~+/=-]{1,500}$/;

export interface SeatsTokens {
  /** "seats:ota:…": sent as `Partner-Authorization: Bearer seats:ota:…`. */
  access: string;
  /** "seats:otr:…": sent only to the token service, to get a new access token. */
  refresh: string;
  /** When the access token expires, ms since the epoch (the device's clock at the exchange, plus expires_in). */
  expiresAt: number;
}

export function isAccessToken(value: unknown): value is string {
  return typeof value === "string" && ACCESS_RE.test(value);
}

export function isRefreshToken(value: unknown): value is string {
  return typeof value === "string" && REFRESH_RE.test(value);
}

/** A stored token bundle, checked field by field; null for anything else (a damaged item is no connection). */
export function readTokens(value: unknown): SeatsTokens | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isAccessToken(v.access) || !isRefreshToken(v.refresh)) return null;
  if (typeof v.expiresAt !== "number" || !Number.isFinite(v.expiresAt)) return null;
  return { access: v.access, refresh: v.refresh, expiresAt: v.expiresAt };
}

export interface TokenVault {
  /** The tokens, or null when there are none or the item cannot be read. Never throws. */
  read(): Promise<SeatsTokens | null>;
  /** Rejects when the Keychain refuses the write: the caller says so, and nothing is reported as connected. */
  write(tokens: SeatsTokens): Promise<void>;
  /** Removes the item; already absent is fine. */
  clear(): Promise<void>;
}

/** The Keychain item's name (the plugin adds its own prefix). */
export const SEATS_OAUTH_ITEM = "seats_aero_oauth";
const ACCESS = KeychainAccess.afterFirstUnlockThisDeviceOnly;
const SYNC = false;
const CONVERT_DATE = false;

export const keychainTokenVault: TokenVault = {
  async read() {
    try {
      return readTokens(await SecureStorage.get(SEATS_OAUTH_ITEM, CONVERT_DATE, SYNC));
    } catch {
      // A missing item throws in this plugin: no connection.
      return null;
    }
  },
  async write(tokens) {
    const checked = readTokens(tokens);
    if (!checked) throw new Error("Refusing to store tokens that are not seats.aero's.");
    await SecureStorage.set(SEATS_OAUTH_ITEM, { ...checked }, CONVERT_DATE, SYNC, ACCESS);
  },
  async clear() {
    try {
      await SecureStorage.remove(SEATS_OAUTH_ITEM, SYNC);
    } catch {
      // Already absent.
    }
  },
};

/** In memory, for tests, the UI/UX host and `vite dev` in a browser, where there is no Keychain. */
export class MemoryTokenVault implements TokenVault {
  #tokens: SeatsTokens | null = null;
  constructor(initial: SeatsTokens | null = null) {
    this.#tokens = initial ? readTokens(initial) : null;
  }
  async read() {
    return this.#tokens ? { ...this.#tokens } : null;
  }
  async write(tokens: SeatsTokens) {
    const checked = readTokens(tokens);
    if (!checked) throw new Error("Refusing to store tokens that are not seats.aero's.");
    this.#tokens = checked;
  }
  async clear() {
    this.#tokens = null;
  }
}
