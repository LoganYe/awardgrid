/**
 * The appearance chosen in Settings, told to the native side (UI/UX v1 T22; U-042).
 *
 * The page's own colours follow the choice through [data-theme] (components/ui/theme.ts). Around the page, though, the
 * web view's own background shows: below the tab bar, over the home indicator, and when a page is pulled past its end.
 * Capacitor paints it systemBackground, so it followed the device's appearance, not the app's: a white strip under a
 * dark app, a black one under a light app (seen on the Simulator, iOS 26.5 and 18.3). The page posts the chosen scheme
 * and the colour of its bottom surface to the app's own `agAppearance` handler (ios/App/App/AppViewController.swift),
 * which sets the window's interface style and paints that colour. In a browser there is no handler and nothing is sent.
 */
import type { ThemePreference } from "../components/ui/theme";

interface AppearanceMessage {
  scheme: ThemePreference;
  r?: number;
  g?: number;
  b?: number;
}

type Handler = { postMessage(message: AppearanceMessage): void };

type Rgb = { r: number; g: number; b: number };

function handler(): Handler | null {
  const webkit = (globalThis as { window?: { webkit?: { messageHandlers?: { agAppearance?: Handler } } } }).window?.webkit;
  return webkit?.messageHandlers?.agAppearance ?? null;
}

/** A computed colour ("rgb(26, 33, 48)", or "#1a2130") as numbers; null for anything transparent or unreadable. */
export function parseColor(color: string): Rgb | null {
  const rgb = color.trim().match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  if (rgb) return rgb[4] !== undefined && Number(rgb[4]) === 0 ? null : { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  const hex = color.trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return hex ? { r: parseInt(hex[1]!, 16), g: parseInt(hex[2]!, 16), b: parseInt(hex[3]!, 16) } : null;
}

/** The bottom surface's colour as the page now draws it (the tab bar's, and the full-height pages' footers'). */
function surfaceColor(): Rgb | null {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;width:0;height:0;visibility:hidden;background-color:var(--ag-surface)";
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return parseColor(color);
}

/** Tell the native side the scheme now chosen and the colour it resolves to. Never throws. */
export function postAppearance(preference: ThemePreference, readColor: () => Rgb | null = surfaceColor): void {
  const native = handler();
  if (!native) return;
  try {
    native.postMessage({ scheme: preference, ...(readColor() ?? {}) });
  } catch {
    // The page's look never depends on the native side answering.
  }
}

/**
 * Post now, and again whenever the device's appearance changes (under "System" the colour follows it). Returns the
 * way to stop listening.
 */
export function installAppearanceBridge(current: () => ThemePreference, readColor: () => Rgb | null = surfaceColor): () => void {
  postAppearance(current(), readColor);
  const w = (globalThis as { window?: { matchMedia?: (q: string) => MediaQueryList } }).window;
  const query = typeof w?.matchMedia === "function" ? w.matchMedia("(prefers-color-scheme: dark)") : null;
  const onChange = () => postAppearance(current(), readColor);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}
