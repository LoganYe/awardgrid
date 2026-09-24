/**
 * The shell's language (UI/UX v1 T07). The results screen speaks English or Chinese; the other screens are English
 * until T11, which adds the setting and moves every string into the dictionaries. Until then the language comes from
 * the device (or the test host), and only the screens that are translated mark themselves with it, so VoiceOver never
 * reads English text as Chinese.
 */
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
