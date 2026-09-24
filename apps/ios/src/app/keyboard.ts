/**
 * The software keyboard over the page (UI/UX v1 T11; plan 02 T11: the query submit and the AI composer follow the
 * visual viewport instead of being fixed to the bottom).
 *
 * The app has no keyboard plugin and does not add one. In WKWebView the keyboard shrinks only the visual viewport,
 * not the layout viewport, so anything laid out down to the bottom of the page would sit under it. This reads the
 * covered height from `window.visualViewport` and publishes it on <html> as `--ag-keyboard-inset` (0px when closed),
 * with `data-keyboard="open"` while it is up. The editor and the tab chrome size themselves to the space above it
 * (query.css, results.css), and `useKeepInView` brings a composer's button up with its text box.
 *
 * Checked in the browser with a stand-in visualViewport (e2e/uiux/onboarding.spec.ts); on a device it is not yet.
 */
import { type RefObject, useEffect } from "react";

/**
 * Smaller than any iPhone keyboard, larger than an accessory bar alone (a hardware keyboard on an iPad), so only a
 * keyboard counts.
 */
export const KEYBOARD_MIN_PX = 120;

export interface ViewportLike {
  height: number;
  offsetTop: number;
  scale: number;
}

/**
 * Whether the keyboard is up, from its own height (the visual viewport's loss, which panning to a field does not
 * change), and how much of the layout viewport's bottom it covers now (less when WebKit has panned up to a field).
 * Closed while pinch-zoomed, or without a visualViewport.
 */
export function keyboardState(view: ViewportLike | null | undefined, innerHeight: number): { open: boolean; inset: number } {
  if (!view || Math.abs(view.scale - 1) > 0.01) return { open: false, inset: 0 };
  if (innerHeight - view.height < KEYBOARD_MIN_PX) return { open: false, inset: 0 };
  return { open: true, inset: Math.max(0, Math.round(innerHeight - view.height - view.offsetTop)) };
}

/** Bring the field being typed in back into view within its own scroller, once the layout above the keyboard is set. */
function revealFocused(win: Window): void {
  const el = win.document.activeElement;
  if (el && typeof (el as HTMLElement).scrollIntoView === "function" && (el as HTMLElement).matches?.("input, textarea, select, [contenteditable]")) {
    (el as HTMLElement).scrollIntoView({ block: "nearest" });
  }
}

/**
 * Publish the inset on <html> and keep it current; when the keyboard opens, the focused field is brought into view
 * above it (a shorter screen can otherwise leave it under a footer), then `ag-keyboard` tells anything else that
 * follows the keyboard (useKeepInView). Returns the teardown.
 */
export function installKeyboardInset(win: Window = window): () => void {
  const view = win.visualViewport;
  const root = win.document.documentElement;
  if (!view) return () => {};
  let lastInset = -1;
  let wasOpen = false;
  const update = () => {
    const { open, inset } = keyboardState(view, win.innerHeight);
    if (inset !== lastInset) root.style.setProperty("--ag-keyboard-inset", `${inset}px`);
    lastInset = inset;
    if (open === wasOpen) return;
    // Only when the keyboard comes or goes: panning while it is up is the person's (or WebKit's) scrolling, not ours.
    wasOpen = open;
    if (open) root.dataset.keyboard = "open";
    else delete root.dataset.keyboard;
    win.requestAnimationFrame(() => {
      if (open) revealFocused(win);
      win.dispatchEvent(new Event("ag-keyboard"));
    });
  };
  update();
  view.addEventListener("resize", update);
  view.addEventListener("scroll", update);
  return () => {
    view.removeEventListener("resize", update);
    view.removeEventListener("scroll", update);
    root.style.removeProperty("--ag-keyboard-inset");
    delete root.dataset.keyboard;
  };
}

/**
 * While something inside `block` has focus and the keyboard opens (or focus moves in while it is open), scroll the
 * whole block into the space above the keyboard, so a text box's own button is not left under it.
 */
export function useKeepInView(block: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const bring = () => {
      const el = block.current;
      if (!el || document.documentElement.dataset.keyboard !== "open" || !el.contains(document.activeElement)) return;
      el.scrollIntoView({ block: "nearest" });
    };
    const el = block.current;
    window.addEventListener("ag-keyboard", bring);
    el?.addEventListener("focusin", bring);
    return () => {
      window.removeEventListener("ag-keyboard", bring);
      el?.removeEventListener("focusin", bring);
    };
  }, [block]);
}
