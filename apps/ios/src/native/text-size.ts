/**
 * The system's text size, followed (UI/UX v1 T22; A35's native half; spec: 100–200% text).
 *
 * The page's type scales with --ag-text-scale (packages/tokens/precision.css), which T21 verified from 100% to 200%.
 * Nothing on the device set it, so the app ignored Dynamic Type (seen on the Simulator, evidence T22). WebKit on iOS
 * resolves the `-apple-system-body` font to the body size the person chose (17 at the default); its ratio to 17 is the
 * scale, held between 1 and 2. A hidden probe in that font is watched, so a change made in Settings while the app is
 * open is followed when the page draws again, and it is read again whenever the app comes back to the front. Only in
 * the app on iOS: elsewhere (a browser, the fixture host, tests) the font is unknown and nothing is set, so a test's
 * own scale stands.
 */
import { Capacitor } from "@capacitor/core";

/** iOS's body size at the default text size ("Large"). */
const DEFAULT_BODY = 17;

/** The page's scale for a system body size: two decimals, from 1 to 2. */
export function textScaleFor(bodyPx: number): number {
  if (!Number.isFinite(bodyPx)) return 1;
  return Math.min(2, Math.max(1, Math.round((bodyPx / DEFAULT_BODY) * 100) / 100));
}

/** Follow the system's text size on the root. Returns the way to stop. */
export function installSystemTextSize(root?: HTMLElement): () => void {
  const css = (globalThis as { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS;
  if (!css?.supports?.("font", "-apple-system-body") || Capacitor.getPlatform() !== "ios") return () => {};
  const target = root ?? document.documentElement;
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;font:-apple-system-body";
  probe.textContent = "M";
  document.body.appendChild(probe);
  const apply = () => target.style.setProperty("--ag-text-scale", String(textScaleFor(Number.parseFloat(getComputedStyle(probe).fontSize))));
  apply();
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
  observer?.observe(probe);
  const onVisible = () => {
    if (document.visibilityState === "visible") apply();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    observer?.disconnect();
    document.removeEventListener("visibilitychange", onVisible);
    probe.remove();
  };
}
