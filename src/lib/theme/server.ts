/**
 * Server-only theme helper (reads the `ag_theme` cookie via next/headers; `cookies()` is async in
 * Next 16). Do not import from client components or tests — use `parseTheme` from "@/lib/theme".
 */
import { cookies } from "next/headers";
import { DEFAULT_THEME, THEME_COOKIE, parseTheme, type Theme } from "@/lib/theme";

/**
 * The theme for this request: the cookie wins on the current device; `fallback` (the user's
 * stored `users.theme`, when known) seeds a device that has no cookie yet; otherwise "system".
 */
export async function getTheme(fallback?: string | null): Promise<Theme> {
  try {
    const store = await cookies();
    const raw = store.get(THEME_COOKIE)?.value;
    if (raw) return parseTheme(raw);
  } catch {
    // Outside a request scope (e.g. static rendering): fall through.
  }
  return fallback ? parseTheme(fallback) : DEFAULT_THEME;
}
