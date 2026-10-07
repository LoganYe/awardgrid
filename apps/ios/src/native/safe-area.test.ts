/**
 * One inset system for the status bar, the home indicator and an iPad window's controls (PR-D; native half in
 * ios/App/App/AppViewController.swift, checked on the Simulator: exec311/qa-prd).
 *
 * The page covers the whole screen (`viewport-fit=cover`) and each screen's top chrome pads itself by
 * env(safe-area-inset-top) once, the tab bar by env(safe-area-inset-bottom) once. The web view's scroll view must then
 * not inset the page again: with Capacitor's `contentInset: "always"` it did, so a page one screen tall became
 * scrollable by the inset and showed either an empty band above its title (iPhone: 62 pt, plus 34 pt under the tab
 * bar) or its title under an iPad window's controls, depending on launch timing. iPadOS 26+ reports the controls only
 * in the corner-adapted safe area, so the controller adds them to the web view's safe area, where env() reads them.
 *
 * What a unit test can hold is the configuration that makes that true; where each title lands is measured on the
 * Simulator.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../../capacitor.config";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(SRC, "..");
const read = (path: string) => readFileSync(path, "utf8");

/** Every stylesheet the app ships (src/**.css). */
function stylesheets(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

/** Each rule's selector and body, comments removed (no nesting in these files). */
function rules(css: string): Array<{ selector: string; body: string }> {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
}

const ALL_RULES = stylesheets().flatMap((path) => rules(read(path)).map((r) => ({ ...r, path })));
const declaration = (body: string, property: string) => body.match(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`))?.[1] ?? null;
const count = (text: string | null, needle: string) => (text ?? "").split(needle).length - 1;

describe("the web view does not inset the page; the page insets itself", () => {
  it("Capacitor's contentInset is 'never', and the native controller sets the same", () => {
    expect(config.ios?.contentInset).toBe("never");
    const swift = read(join(APP, "ios/App/App/AppViewController.swift"));
    expect(swift).toContain("webView?.scrollView.contentInsetAdjustmentBehavior = .never");
    expect(swift).not.toMatch(/contentInsetAdjustmentBehavior = \.(always|automatic|scrollableAxes)/);
  });

  it("the page covers the screen, so env(safe-area-inset-*) reports the insets", () => {
    expect(read(join(APP, "index.html"))).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"/);
  });

  it("an iPad window's controls are added to the safe area, read from the window so the reading never feeds back", () => {
    const swift = read(join(APP, "ios/App/App/AppViewController.swift"));
    expect(swift).toMatch(/if #available\(iOS 26\.0, \*\), let window = view\.window/);
    expect(swift).toContain("window.edgeInsets(for: .safeArea(cornerAdaptation: .vertical)).top");
    expect(swift).toContain("cornerAdapted - window.safeAreaInsets.top");
    expect(swift).toContain("additionalSafeAreaInsets.top = extra");
    // Recomputed whenever the layout or the safe area changes (a window resized, the controls appearing).
    expect(swift).toMatch(/override func viewDidLayoutSubviews\(\) \{\s*super\.viewDidLayoutSubviews\(\)\s*updateWindowControlsInset\(\)/);
    expect(swift).toMatch(/override func viewSafeAreaInsetsDidChange\(\) \{\s*super\.viewSafeAreaInsetsDidChange\(\)\s*updateWindowControlsInset\(\)/);
  });
});

describe("each screen's top chrome pads the top inset once, and nothing around it does", () => {
  /** The screens' top chrome: Search (and the welcome), details, compare, the editor, Ask. The other tabs: below. */
  const TOP_CHROME = [".ag-results-header", ".ag-detail-header", ".ag-compare-header", ".query-editor-header", ".ask-header"];
  /** What contains every screen: an inset here would come on top of the chrome's own. */
  const CONTAINERS = /^(html|body|#root|\.app-shell|\.app-main|html,\s*body)$/;

  it.each(TOP_CHROME)("%s: env(safe-area-inset-top) once, at the top of its padding", (selector) => {
    const own = ALL_RULES.filter((r) => r.selector.split(",").map((s) => s.trim()).includes(selector));
    const tops = own.map((r) => declaration(r.body, "padding-top") ?? declaration(r.body, "padding")).filter((v) => v !== null);
    expect(tops, selector).toHaveLength(1);
    expect(count(tops[0]!, "env(safe-area-inset-top)"), `${selector}: ${tops[0]}`).toBe(1);
    // The shorthand's first value is the top.
    if (!own.some((r) => declaration(r.body, "padding-top"))) expect(tops[0]!.trim().startsWith("env(safe-area-inset-top)")).toBe(true);
  });

  it("Watches, Saved and Settings: the inset is a strip above their scrolling area, not padding that scrolls away", () => {
    const strip = ALL_RULES.filter((r) => r.selector === ".app-status-area");
    expect(strip).toHaveLength(1);
    expect(declaration(strip[0]!.body, "height")?.trim()).toBe("env(safe-area-inset-top)");
    expect(declaration(strip[0]!.body, "flex")?.trim()).toBe("none");
    const page = ALL_RULES.filter((r) => r.selector === ".app-page");
    expect(page.map((r) => r.body).join("")).not.toContain("safe-area-inset-top");
    const app = read(join(SRC, "app/App.tsx"));
    // Before the scrolling area, on every tab but Search.
    expect(app).toMatch(/\{onSearch \? null : <div className="app-status-area" aria-hidden="true" \/>\}\s*<main ref=\{main\}/);
  });

  it("no container of the screens adds a top or bottom inset of its own", () => {
    const offenders = ALL_RULES.filter((r) => CONTAINERS.test(r.selector) && /safe-area-inset-(top|bottom)/.test(r.body));
    expect(offenders.map((r) => `${r.path}: ${r.selector}`)).toEqual([]);
  });

  it("the tab bar pads the bottom inset once", () => {
    const tabs = ALL_RULES.filter((r) => r.selector === ".app-tabs");
    const padding = tabs.map((r) => declaration(r.body, "padding")).filter((v) => v !== null);
    expect(padding).toHaveLength(1);
    expect(count(padding[0]!, "env(safe-area-inset-bottom)")).toBe(1);
  });
});
