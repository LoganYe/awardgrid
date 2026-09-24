/**
 * The app's own settings (UI/UX v1 T11; docs/04 S08): the language the screens speak and the appearance. Kept on this
 * device in their own file (written whole, through the same atomic two-slot storage as the workspace), read once at
 * launch, and changed only by the user in Settings.
 *
 *   - **Language.** Until the user chooses, the device's language (U-026). A choice takes effect at once on every
 *     screen that reads it (`useLocale`) without remounting anything, so the task on screen is kept.
 *   - **Appearance.** System, Light or Dark; applied to <html> (components/ui/theme.ts).
 *
 * A file that cannot be read, or holds anything unexpected, gives the defaults: settings never stop the app starting.
 * A failed save keeps the choice for this run and says so to the caller.
 */
import type { StoragePort } from "@awardgrid/core/workspace/types";
import { type ThemePreference, isThemePreference } from "../components/ui/theme";
import type { Locale } from "./locale";

export const SETTINGS_NAMESPACE = "settings-v1";

export interface AppSettings {
  /** The language chosen in Settings; null = follow the device. */
  locale: Locale | null;
  theme: ThemePreference;
}

const DEFAULTS: AppSettings = { locale: null, theme: "system" };

export class SettingsStore {
  readonly #storage: StoragePort | null;
  readonly #deviceLocale: Locale;
  #state: AppSettings = DEFAULTS;
  readonly #listeners = new Set<() => void>();

  constructor(opts: { storage?: StoragePort | null; deviceLocale: Locale }) {
    this.#storage = opts.storage ?? null;
    this.#deviceLocale = opts.deviceLocale;
  }

  /** Read the saved settings once, at launch. Never throws. */
  async restore(): Promise<void> {
    if (!this.#storage) return;
    try {
      const raw = (await this.#storage.read(SETTINGS_NAMESPACE)) as Partial<Record<keyof AppSettings, unknown>> | null;
      if (raw && typeof raw === "object") {
        this.#state = {
          locale: raw.locale === "en" || raw.locale === "zh" ? raw.locale : null,
          theme: isThemePreference(raw.theme) ? raw.theme : "system",
        };
      }
    } catch {
      this.#state = DEFAULTS;
    }
  }

  /** The language the screens speak now: the one chosen, else the device's. */
  readonly locale = (): Locale => this.#state.locale ?? this.#deviceLocale;
  readonly theme = (): ThemePreference => this.#state.theme;
  readonly get = (): AppSettings => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  setLocale(locale: Locale): Promise<boolean> {
    return this.#update({ locale });
  }

  setTheme(theme: ThemePreference): Promise<boolean> {
    return this.#update({ theme });
  }

  /** Change, tell every reader, then save; resolves false when the save failed (the change stays for this run). */
  async #update(patch: Partial<AppSettings>): Promise<boolean> {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
    if (!this.#storage) return true;
    try {
      await this.#storage.writeAtomically(SETTINGS_NAMESPACE, this.#state);
      return true;
    } catch {
      return false;
    }
  }
}
