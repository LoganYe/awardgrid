/**
 * The app's own settings (UI/UX v1 T11; docs/04 S08): the language the screens speak, the appearance, and whether Ask
 * may send data to Anthropic. Kept on this device in their own file (written whole, through the same atomic two-slot
 * storage as the workspace), read once at launch, and changed only by the user.
 *
 *   - **Language.** Until the user chooses, the device's language (U-026). A choice takes effect at once on every
 *     screen that reads it (`useLocale`) without remounting anything, so the task on screen is kept.
 *   - **Appearance.** System, Light or Dark; applied to <html> (components/ui/theme.ts).
 *   - **Ask's permission** (release D10): given on the Ask screen's consent sheet before the first question, withdrawn
 *     on the Anthropic key page. Without it the Ask service sends nothing (ask-service.ts).
 *
 * A file that cannot be read, or holds anything unexpected, gives the defaults: settings never stop the app starting,
 * and a permission that cannot be read is no permission. A failed save keeps the choice for this run and says so to
 * the caller.
 */
import type { StoragePort } from "@awardgrid/core/workspace/types";
import { ANTHROPIC_CONSENT_VERSION } from "../ask/consent-copy";
import { type ThemePreference, isThemePreference } from "../components/ui/theme";
import type { Locale } from "./locale";

export const SETTINGS_NAMESPACE = "settings-v1";

/**
 * The person's permission for Ask to send data to Anthropic (release D10; App Review Guideline 5.1.2(i)). `version`
 * is the wording it was given for (ANTHROPIC_CONSENT_VERSION): one given for another wording counts as none, so a
 * change in what is sent asks again.
 */
export interface AiConsent {
  version: number;
  /** When it was given (ISO), kept as the record of it. */
  at: string;
}

export interface AppSettings {
  /** The language chosen in Settings; null = follow the device. */
  locale: Locale | null;
  theme: ThemePreference;
  /** null until given, and again once withdrawn. */
  aiConsent: AiConsent | null;
}

const DEFAULTS: AppSettings = { locale: null, theme: "system", aiConsent: null };

function readConsent(value: unknown): AiConsent | null {
  if (typeof value !== "object" || value === null) return null;
  const { version, at } = value as { version?: unknown; at?: unknown };
  if (!Number.isSafeInteger(version) || typeof at !== "string" || Number.isNaN(Date.parse(at))) return null;
  return { version: version as number, at };
}

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
          aiConsent: readConsent(raw.aiConsent),
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
  /** Ask's permission, when it was given for the wording this build shows; null otherwise. */
  readonly aiConsent = (): AiConsent | null => (this.#state.aiConsent?.version === ANTHROPIC_CONSENT_VERSION ? this.#state.aiConsent : null);

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

  /** The person allowed Ask to send data to Anthropic, on the consent sheet, at `at`. */
  allowAi(at: Date): Promise<boolean> {
    return this.#update({ aiConsent: { version: ANTHROPIC_CONSENT_VERSION, at: at.toISOString() } });
  }

  /**
   * The person withdrew it. Ask sends nothing from now on, in this run whatever the save says; a save that failed
   * resolves false, so the page can say the change may not survive a relaunch.
   */
  withdrawAi(): Promise<boolean> {
    return this.#update({ aiConsent: null });
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
