import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  THEME_SCRIPT,
  THEMES,
  isTheme,
  nextTheme,
  parseTheme,
  resolveTheme,
  serializeThemeCookie,
  themeFromCookieHeader,
} from "./index";

describe("theme cookie", () => {
  it("names and defaults", () => {
    expect(THEME_COOKIE).toBe("ag_theme");
    expect(THEMES).toEqual(["system", "light", "dark"]);
    expect(DEFAULT_THEME).toBe("system");
    expect(THEME_COOKIE_MAX_AGE).toBe(365 * 24 * 60 * 60);
  });

  it("parses values leniently and never returns an unknown theme", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme(" Light ")).toBe("light");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("blue")).toBe("system");
    expect(parseTheme("")).toBe("system");
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme(null)).toBe("system");
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("auto")).toBe(false);
    expect(isTheme(1)).toBe(false);
  });

  it("reads ag_theme out of a Cookie header, ignoring look-alikes", () => {
    expect(themeFromCookieHeader("ag_locale=zh; ag_theme=dark; sid=abc")).toBe("dark");
    expect(themeFromCookieHeader("ag_theme=light")).toBe("light");
    expect(themeFromCookieHeader("x_ag_theme=dark; other=1")).toBe("system");
    expect(themeFromCookieHeader("ag_theme=nonsense")).toBe("system");
    expect(themeFromCookieHeader("ag_theme=%E0")).toBe("system"); // malformed encoding never throws
    expect(themeFromCookieHeader("ag_theme=%64ark")).toBe("dark");
    expect(themeFromCookieHeader("")).toBe("system");
    expect(themeFromCookieHeader(null)).toBe("system");
  });

  it("serializes a one-year, path=/, SameSite=Lax cookie that is readable by scripts", () => {
    const s = serializeThemeCookie("dark");
    expect(s).toBe("ag_theme=dark; path=/; max-age=31536000; samesite=lax");
    expect(s).not.toMatch(/httponly/i);
    expect(serializeThemeCookie("light", { secure: true })).toMatch(/; secure$/);
    // What the toggle writes is what the server parses back.
    expect(themeFromCookieHeader(s.split(";")[0])).toBe("dark");
  });
});

describe("resolveTheme", () => {
  it("system follows the OS preference; explicit choices never do", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("cycles system → light → dark → system", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
});

describe("pre-paint script", () => {
  it("is self-contained: no URL, no fetch, no import", () => {
    expect(THEME_SCRIPT).not.toMatch(/https?:|\/\/|fetch\(|import\(|XMLHttpRequest|<script/i);
  });

  it("reads the cookie and sets data-theme on the root element, guarded by try/catch", () => {
    expect(THEME_SCRIPT).toContain("document.cookie");
    expect(THEME_SCRIPT).toContain(`${THEME_COOKIE}=(system|light|dark)`);
    expect(THEME_SCRIPT).toContain('setAttribute("data-theme"');
    expect(THEME_SCRIPT.startsWith("(function(){try{")).toBe(true);
    expect(THEME_SCRIPT.endsWith("}catch(e){}})();")).toBe(true);
  });

  it("parses as JavaScript and applies the cookie to a fake document", () => {
    type FakeRoot = { attrs: Record<string, string>; getAttribute(n: string): string | null; setAttribute(n: string, v: string): void };
    const root: FakeRoot = {
      attrs: { "data-theme": "system" },
      getAttribute(n) {
        return this.attrs[n] ?? null;
      },
      setAttribute(n, v) {
        this.attrs[n] = v;
      },
    };
    const run = new Function("document", "window", THEME_SCRIPT);
    run({ cookie: "ag_locale=en; ag_theme=dark", documentElement: root }, {});
    expect(root.attrs["data-theme"]).toBe("dark");
    run({ cookie: "ag_theme=light; sid=abc", documentElement: root }, {});
    expect(root.attrs["data-theme"]).toBe("light");
    // Look-alike names and unknown values are ignored.
    run({ cookie: "x_ag_theme=dark; ag_theme=blue", documentElement: root }, {});
    expect(root.attrs["data-theme"]).toBe("light");
    // No cookie: the server-rendered value (the stored users.theme on a new device) stands.
    root.attrs["data-theme"] = "dark";
    run({ cookie: "ag_locale=en; sid=abc", documentElement: root }, {});
    expect(root.attrs["data-theme"]).toBe("dark");
    run({ cookie: "", documentElement: root }, {});
    expect(root.attrs["data-theme"]).toBe("dark");
    // A broken cookie store must not throw.
    expect(() => run({ get cookie(): string { throw new Error("blocked"); }, documentElement: root }, {})).not.toThrow();
  });
});
