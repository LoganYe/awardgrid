/**
 * Theme persistence (docs/UI_PLAN.md §11 "Theme persistence"). Pure module — safe in server
 * components, client components and tests.
 *
 *   - cookie `ag_theme` = "system" | "light" | "dark", one year, SameSite=Lax, not httpOnly
 *     (the toggle writes it from the browser; the root layout reads it to set <html data-theme>)
 *   - `resolveTheme(theme, prefersDark)` → the scheme actually painted
 *   - `THEME_SCRIPT` — the inline pre-paint script the root layout puts in <head>. It re-reads the
 *     cookie in the browser so a cached or bfcache'd document still shows the current choice, and
 *     it never loads anything from the network. With no cookie it does nothing: the server has
 *     already resolved that case (the stored `users.theme`, else "system").
 *
 * Server helper `getTheme()` lives in "./server"; the provider and `useTheme()` in "./client".
 */

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = "system";

export const THEME_COOKIE = "ag_theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The two schemes a theme resolves to. */
export type ResolvedTheme = "light" | "dark";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Normalise a cookie / DB value; anything unknown is "system". */
export function parseTheme(value: string | null | undefined): Theme {
  if (!value) return DEFAULT_THEME;
  const v = value.trim().toLowerCase();
  return isTheme(v) ? v : DEFAULT_THEME;
}

/** Read `ag_theme` out of a raw `Cookie` header / `document.cookie` string. */
export function themeFromCookieHeader(header: string | null | undefined): Theme {
  if (!header) return DEFAULT_THEME;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== THEME_COOKIE) continue;
    let raw = part.slice(eq + 1).trim();
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // Malformed percent-encoding: parse the raw value (which is not a theme → "system").
    }
    return parseTheme(raw);
  }
  return DEFAULT_THEME;
}

/** The `document.cookie` assignment string the toggle writes (path=/, one year, SameSite=Lax). */
export function serializeThemeCookie(theme: Theme, opts: { secure?: boolean } = {}): string {
  const parts = [`${THEME_COOKIE}=${theme}`, "path=/", `max-age=${THEME_COOKIE_MAX_AGE}`, "samesite=lax"];
  if (opts.secure) parts.push("secure");
  return parts.join("; ");
}

/** Which scheme is painted for `theme` given the OS preference. */
export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  return prefersDark ? "dark" : "light";
}

/** The next state when the top-bar button is pressed: system → light → dark → system. */
export function nextTheme(theme: Theme): Theme {
  const i = THEMES.indexOf(theme);
  return THEMES[(i + 1) % THEMES.length] ?? DEFAULT_THEME;
}

/**
 * Inline, dependency-free, network-free. Runs before the first paint: reads the cookie and, only
 * when one is present, sets <html data-theme> if the server-rendered value disagrees (cached
 * document, back/forward cache). Without a cookie the server-rendered attribute stands — it is
 * the stored `users.theme` for a signed-in user on a new device, else "system" — so the script
 * must not overwrite it. `color-scheme` follows the attribute through CSS (globals.css), so
 * nothing else is needed. Wrapped in try/catch so a browser that blocks document.cookie still paints.
 */
export const THEME_SCRIPT = [
  "(function(){try{",
  `var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=(system|light|dark)(?:;|$)/);`,
  "if(m){var v=m[1];var h=document.documentElement;",
  'if(h.getAttribute("data-theme")!==v){h.setAttribute("data-theme",v);}}',
  "}catch(e){}})();",
].join("");
