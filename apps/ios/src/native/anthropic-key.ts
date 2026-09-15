/**
 * The Anthropic key Ask uses, in its own Keychain item, beside the seats.aero key and never mixed with it.
 *
 * Three rules, each with a reason:
 *
 *   - **Access and sync are passed on every call, never set as defaults.** The plugin's `set()` uses the
 *     `sync` and `access` it is handed and falls back to its global defaults only when they are absent
 *     (@aparajita/capacitor-secure-storage dist/esm/base.js:78-88; get and remove read `sync` the same way,
 *     :43-47, :104-108). keychain.ts sets those globals for the seats.aero item (`setSynchronize`,
 *     `setDefaultKeychainAccess`, keychain.ts:67-69). This file leaves them alone, so keychain.ts stays exactly as
 *     verified on the Simulator, and neither item's settings depend on which was saved last.
 *   - **`whenUnlockedThisDeviceOnly`.** Nothing reads this key while the device is locked: Ask runs only while
 *     the person has the app open, and there is no background work (../watch/capabilities.ts). `ThisDeviceOnly`
 *     keeps it out of backups, so it never reappears on a restored phone. `sync: false` keeps it out of iCloud
 *     Keychain.
 *   - **Never `SecureStorage.clear()`.** It removes every item under the plugin's key prefix
 *     (definitions.d.ts:231-240), which here means the seats.aero key too. Removing this key removes this item
 *     only (`remove`, definitions.d.ts:221).
 *
 * The same display rule as the seats.aero key applies: never logged, never shown beyond the last four characters
 * (`maskedKey`, keychain.ts). It is read when a question starts or a check runs, never captured at launch.
 */
import { KeychainAccess, SecureStorage } from "@aparajita/capacitor-secure-storage";
import type { KeyStore } from "./keychain";

/** The Keychain item's name (the plugin adds its own prefix). */
export const ANTHROPIC_KEY_ITEM = "anthropic_api_key";

const ACCESS = KeychainAccess.whenUnlockedThisDeviceOnly;

/** Never synchronised to iCloud Keychain. */
const SYNC = false;

/** A key is a string, never a date: the plugin's ISO-date conversion stays off (definitions.d.ts:163-164). */
const CONVERT_DATE = false;

export const anthropicKeychain: KeyStore = {
  async get() {
    try {
      const value = await SecureStorage.get(ANTHROPIC_KEY_ITEM, CONVERT_DATE, SYNC);
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch {
      // A missing item throws in this plugin; that is not an error condition for Ask.
      return null;
    }
  },

  async set(value: string) {
    const trimmed = value.trim();
    if (!trimmed) throw new Error("Refusing to store an empty Anthropic key.");
    await SecureStorage.set(ANTHROPIC_KEY_ITEM, trimmed, CONVERT_DATE, SYNC, ACCESS);
  },

  async clear() {
    try {
      await SecureStorage.remove(ANTHROPIC_KEY_ITEM, SYNC);
    } catch {
      // Already absent.
    }
  },
};
