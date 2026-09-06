"use client";

/**
 * Client side of the theme: a provider fed by the root layout with the server-resolved theme,
 * and `useTheme()` → { theme, resolved, setTheme }. `setTheme` updates <html data-theme> at once,
 * writes the `ag_theme` cookie, and (when signed in) also persists through PUT /api/settings so a
 * new device starts from the same choice. 4xx/5xx from that call are ignored: the cookie is the
 * device's source of truth. The provider's state IS <html data-theme> (an external store read
 * with useSyncExternalStore, seeded by the server value during hydration): the pre-paint script
 * may apply a newer cookie to a cached document than the one the server rendered from, and React
 * never patches attribute mismatches on hydration, so the label must follow the document.
 */
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_THEME, parseTheme, resolveTheme, serializeThemeCookie, type ResolvedTheme, type Theme } from "@/lib/theme";

interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (next: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  resolved: "light",
  setTheme: () => undefined,
});

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribePrefersDark(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function readPrefersDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(DARK_QUERY).matches;
}

/** The OS preference, as a hook (false during SSR, corrected on the client). */
export function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribePrefersDark, readPrefersDark, () => false);
}

function subscribeDocumentTheme(onChange: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => undefined;
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function readDocumentTheme(): Theme {
  return parseTheme(document.documentElement.getAttribute("data-theme"));
}

export function applyThemeToDocument(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  document.cookie = serializeThemeCookie(theme, { secure: window.location.protocol === "https:" });
}

export function ThemeProvider({
  theme: initial,
  persist = false,
  children,
}: {
  theme: Theme;
  /** True when a user is signed in: also PUT /api/settings { theme }. */
  persist?: boolean;
  children: ReactNode;
}) {
  // <html data-theme> is the store; `initial` only serves the server render and hydration.
  const theme = useSyncExternalStore(subscribeDocumentTheme, readDocumentTheme, () => initial);
  const prefersDark = usePrefersDark();

  const setTheme = useCallback(
    (next: Theme) => {
      applyThemeToDocument(next);
      if (!persist) return;
      void fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ theme: next }),
      }).catch(() => undefined);
    },
    [persist],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved: resolveTheme(theme, prefersDark), setTheme }),
    [theme, prefersDark, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Current theme choice, the scheme it paints, and the setter. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
