/**
 * The app's settings (UI/UX v1 T11): the device's language until one is chosen, a choice heard at once and saved
 * whole, and a file that cannot be trusted giving the defaults rather than stopping the app.
 */
import { describe, expect, it } from "vitest";
import type { StoragePort } from "@awardgrid/core/workspace/types";
import { ANTHROPIC_CONSENT_VERSION } from "../ask/consent-copy";
import { SETTINGS_NAMESPACE, SettingsStore } from "./settings-store";

class Memory implements StoragePort {
  values = new Map<string, unknown>();
  fail = false;
  async read(name: string) {
    return this.values.get(name) ?? null;
  }
  async writeAtomically(name: string, value: unknown) {
    if (this.fail) throw new Error("disk full");
    this.values.set(name, structuredClone(value));
  }
  async remove(name: string) {
    this.values.delete(name);
  }
}

describe("SettingsStore", () => {
  it("follows the device's language until one is chosen; a choice is heard at once and saved", async () => {
    const storage = new Memory();
    const store = new SettingsStore({ storage, deviceLocale: "en" });
    await store.restore();
    expect(store.locale()).toBe("en");
    expect(store.get()).toEqual({ locale: null, theme: "system", aiConsent: null });
    let heard = 0;
    store.subscribe(() => heard++);
    expect(await store.setLocale("zh")).toBe(true);
    expect(store.locale()).toBe("zh");
    expect(heard).toBe(1);
    await store.setTheme("dark");
    expect(storage.values.get(SETTINGS_NAMESPACE)).toEqual({ locale: "zh", theme: "dark", aiConsent: null });
    // A relaunch reads it back.
    const again = new SettingsStore({ storage, deviceLocale: "en" });
    await again.restore();
    expect([again.locale(), again.theme()]).toEqual(["zh", "dark"]);
  });

  it("anything unexpected in the file gives the defaults; a read that throws does too", async () => {
    const storage = new Memory();
    storage.values.set(SETTINGS_NAMESPACE, { locale: "fr", theme: "neon" });
    const store = new SettingsStore({ storage, deviceLocale: "zh" });
    await store.restore();
    expect([store.locale(), store.theme()]).toEqual(["zh", "system"]);
    const broken: StoragePort = { read: async () => Promise.reject(new Error("corrupt")), writeAtomically: async () => {}, remove: async () => {} };
    const safe = new SettingsStore({ storage: broken, deviceLocale: "en" });
    await safe.restore();
    expect(safe.get()).toEqual({ locale: null, theme: "system", aiConsent: null });
  });

  it("a failed save keeps the choice for this run and says so", async () => {
    const storage = new Memory();
    storage.fail = true;
    const store = new SettingsStore({ storage, deviceLocale: "en" });
    expect(await store.setLocale("zh")).toBe(false);
    expect(store.locale()).toBe("zh");
  });

  it("keeps Ask's permission to send data to Anthropic (D10): given, saved with its wording's version, withdrawn", async () => {
    const storage = new Memory();
    const store = new SettingsStore({ storage, deviceLocale: "en" });
    await store.restore();
    expect(store.aiConsent()).toBeNull();
    let heard = 0;
    store.subscribe(() => heard++);

    expect(await store.allowAi(new Date("2026-10-01T09:30:00.000Z"))).toBe(true);
    const given = { version: ANTHROPIC_CONSENT_VERSION, at: "2026-10-01T09:30:00.000Z" };
    expect(store.aiConsent()).toEqual(given);
    expect(heard).toBe(1);
    expect(storage.values.get(SETTINGS_NAMESPACE)).toEqual({ locale: null, theme: "system", aiConsent: given });
    // A relaunch reads it back, and a language change keeps it.
    const again = new SettingsStore({ storage, deviceLocale: "en" });
    await again.restore();
    expect(again.aiConsent()).toEqual(given);
    await again.setLocale("zh");
    expect(again.aiConsent()).toEqual(given);

    expect(await again.withdrawAi()).toBe(true);
    expect(again.aiConsent()).toBeNull();
    const after = new SettingsStore({ storage, deviceLocale: "en" });
    await after.restore();
    expect(after.aiConsent()).toBeNull();
    expect(after.locale()).toBe("zh");
  });

  it("a permission given for another wording, or one that does not read, is no permission", async () => {
    for (const aiConsent of [
      { version: ANTHROPIC_CONSENT_VERSION + 1, at: "2026-10-01T09:30:00.000Z" },
      { version: ANTHROPIC_CONSENT_VERSION - 1, at: "2026-10-01T09:30:00.000Z" },
      { version: ANTHROPIC_CONSENT_VERSION, at: "not a date" },
      { version: "1", at: "2026-10-01T09:30:00.000Z" },
      true,
      "yes",
    ]) {
      const storage = new Memory();
      storage.values.set(SETTINGS_NAMESPACE, { locale: "en", theme: "dark", aiConsent });
      const store = new SettingsStore({ storage, deviceLocale: "en" });
      await store.restore();
      expect(store.aiConsent(), JSON.stringify(aiConsent)).toBeNull();
      expect(store.theme()).toBe("dark");
    }
  });

  it("a withdrawal that cannot be saved still stops Ask for this run, and says the save failed", async () => {
    const storage = new Memory();
    const store = new SettingsStore({ storage, deviceLocale: "en" });
    await store.allowAi(new Date("2026-10-01T09:30:00.000Z"));
    storage.fail = true;
    expect(await store.withdrawAi()).toBe(false);
    expect(store.aiConsent()).toBeNull();
  });
});
