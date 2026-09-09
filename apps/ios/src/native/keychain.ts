/**
 * The seats.aero key, in the iOS Keychain.
 *
 * Why not `@capacitor/preferences`: on iOS it is backed by `UserDefaults`, which is an unencrypted
 * plist inside the app container. That is fine for a remembered tab and wrong for an API key. The
 * Keychain is the only storage on the platform that is encrypted at rest and protected by the
 * device passcode/Secure Enclave.
 *
 * What this replaces from the server app: `src/lib/keys/` (438 lines) and `src/lib/crypto/aes.ts`
 * existed to stop one user's AES-encrypted key being readable by another on a shared host. With one
 * device and one user there is no such thing to defend against — the OS does it — so the whole
 * store collapses to get/set/clear plus the same "never log it, never show more than the last four"
 * discipline, which is a `LEGAL.md` commitment and not merely good manners.
 */
import { KeychainAccess, SecureStorage } from "@aparajita/capacitor-secure-storage";

const KEY = "seats_aero_api_key";

/**
 * Available after the first unlock following a reboot, and bound to this device.
 *
 * `afterFirstUnlock…` rather than `whenUnlocked…` because a background refresh (PIVOT §3's "watch")
 * may need the key while the screen is locked, and an item that is unreadable then would make the
 * watch fail silently at exactly the moment it is supposed to work.
 *
 * `…ThisDeviceOnly` rather than the plain form because the plain form migrates to a new device via
 * encrypted backups. An API key the user pasted into one phone should not silently reappear on a
 * restored device — the user can paste it again, and that is the cheaper mistake. `setSynchronize`
 * below separately keeps it out of iCloud Keychain.
 */
const ACCESSIBILITY = KeychainAccess.afterFirstUnlockThisDeviceOnly;

export interface KeyStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}

/** Last four characters, the ONLY part of a key that may be displayed or logged (LEGAL.md). */
export function last4(secret: string): string {
  return secret.length >= 4 ? secret.slice(-4) : "";
}

export function maskedKey(secret: string): string {
  const l4 = last4(secret);
  return l4 ? `••••${l4}` : "••••";
}

export const keychain: KeyStore = {
  async get() {
    try {
      const v = await SecureStorage.get(KEY);
      return typeof v === "string" && v.length > 0 ? v : null;
    } catch {
      // A missing item throws in this plugin; that is not an error condition for us.
      return null;
    }
  },

  async set(value: string) {
    const trimmed = value.trim();
    if (!trimmed) throw new Error("Refusing to store an empty seats.aero key.");
    await SecureStorage.setSynchronize(false);
    await SecureStorage.setDefaultKeychainAccess(ACCESSIBILITY);
    await SecureStorage.set(KEY, trimmed);
  },

  async clear() {
    try {
      await SecureStorage.remove(KEY);
    } catch {
      // Already absent.
    }
  },
};

/** In-memory stand-in for tests and for `vite dev` in a browser, where there is no Keychain. */
export class MemoryKeyStore implements KeyStore {
  #value: string | null = null;
  async get() {
    return this.#value;
  }
  async set(value: string) {
    const trimmed = value.trim();
    if (!trimmed) throw new Error("Refusing to store an empty seats.aero key.");
    this.#value = trimmed;
  }
  async clear() {
    this.#value = null;
  }
}
