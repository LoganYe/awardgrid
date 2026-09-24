/**
 * Appearance preference (spec §08; docs/04 S08). "system" follows the OS through the prefers-color-scheme blocks in
 * both token files; "light" / "dark" pin it with [data-theme] on <html>, which tokens.css and precision.css both
 * honour. Where the preference is stored is the settings screen's business (T11); this only applies it.
 */
export type ThemePreference = "system" | "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** Apply a preference to a root element (the document's by default). Idempotent. */
export function applyThemePreference(preference: ThemePreference, root: HTMLElement = document.documentElement): void {
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}
