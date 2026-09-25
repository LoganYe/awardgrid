/**
 * The app's settings (UI/UX v1 T11): the device's language until one is chosen, a choice heard at once and saved
 * whole, and a file that cannot be trusted giving the defaults rather than stopping the app.
 */
import { describe, expect, it } from "vitest";
import type { StoragePort } from "@awardgrid/core/workspace/types";
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
    expect(store.get()).toEqual({ locale: null, theme: "system" });
    let heard = 0;
    store.subscribe(() => heard++);
    expect(await store.setLocale("zh")).toBe(true);
    expect(store.locale()).toBe("zh");
    expect(heard).toBe(1);
    await store.setTheme("dark");
    expect(storage.values.get(SETTINGS_NAMESPACE)).toEqual({ locale: "zh", theme: "dark" });
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
    expect(safe.get()).toEqual({ locale: null, theme: "system" });
  });

  it("a failed save keeps the choice for this run and says so", async () => {
    const storage = new Memory();
    storage.fail = true;
    const store = new SettingsStore({ storage, deviceLocale: "en" });
    expect(await store.setLocale("zh")).toBe(false);
    expect(store.locale()).toBe("zh");
  });
});
