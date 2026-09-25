/**
 * The shell's language (UI/UX v1 T07, T11). The device's language until one is chosen in Settings (app/settings-store);
 * every screen that speaks it marks itself with `lang`, and a part still in English is marked `lang="en"`, so
 * VoiceOver never reads English text as Chinese.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { Locale } from "@awardgrid/core/workspace/present";

export type { Locale } from "@awardgrid/core/workspace/present";

/** Chinese for any zh-* language tag, English otherwise. */
export function detectLocale(language: string | undefined): Locale {
  return typeof language === "string" && /^zh\b/i.test(language) ? "zh" : "en";
}

/** The BCP 47 tag a translated screen marks itself with. */
export function langTag(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en";
}

/**
 * The language a screen speaks now (T11): the one chosen in Settings, else the device's. A change re-renders the
 * screen in place, so what is on it is kept. Services without a settings store (unit tests) speak their `locale`.
 */
export function useLocale(services: { locale?: Locale; settings?: { subscribe(listener: () => void): () => void; locale(): Locale } }): Locale {
  const settings = services.settings;
  const subscribe = useCallback((listener: () => void) => (settings ? settings.subscribe(listener) : () => {}), [settings]);
  const read = () => (settings ? settings.locale() : (services.locale ?? "en"));
  return useSyncExternalStore(subscribe, read, read);
}

