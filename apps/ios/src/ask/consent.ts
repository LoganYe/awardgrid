/**
 * Ask's permission to send data to Anthropic (release D10; App Review Guideline 5.1.2(i)): read, given and withdrawn
 * only here, by Ask's screens and its service. The permission itself is kept with the app's other settings
 * (../app/settings-store.ts AppSettings.aiConsent, one file for every build), but the settings store neither reads
 * nor gives it: a build without Ask (the App Store build, ../app/flags.ts STORE) never imports this module, so it has
 * no code that asks for, reads or changes a permission for Ask.
 */
import type { AiConsent, SettingsStore } from "../app/settings-store";
import { ANTHROPIC_CONSENT_VERSION } from "./consent-version";

/** Ask's permission, when it was given for the wording this build shows (ANTHROPIC_CONSENT_VERSION); null otherwise. */
export function aiConsent(settings: Pick<SettingsStore, "get">): AiConsent | null {
  const consent = settings.get().aiConsent;
  return consent?.version === ANTHROPIC_CONSENT_VERSION ? consent : null;
}

/** The person allowed Ask to send data to Anthropic, on the consent sheet, at `at`. */
export function allowAi(settings: Pick<SettingsStore, "update">, at: Date): Promise<boolean> {
  return settings.update({ aiConsent: { version: ANTHROPIC_CONSENT_VERSION, at: at.toISOString() } });
}

/**
 * The person withdrew it. Ask sends nothing from now on, in this run whatever the save says; a save that failed
 * resolves false, so the page can say the change may not survive a relaunch.
 */
export function withdrawAi(settings: Pick<SettingsStore, "update">): Promise<boolean> {
  return settings.update({ aiConsent: null });
}
