/**
 * Phase 6.1 — the app shell (spec §2, docs/UI_PLAN.md §6.1, §6.9): top bar, footer, theme and
 * language toggles, user menu, mobile menu, auth pages and the Legal page. Screenshots land in
 * docs/screenshots/v0.2/shell/<name>-<viewport>-<theme>.png (plain captures, not baselines).
 * Everything on screen is seeded demo data.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import { zh } from "../src/lib/i18n/dictionaries/zh";
import { applyTheme, expect, projectSuffix, test } from "./fixtures";

const SHELL_DIR = path.resolve(import.meta.dirname, "..", "docs", "screenshots", "v0.2", "shell");

/** PNG of `target` (an element), the top `clipHeight` px, or the viewport, named per the §9 convention. */
async function shellShot(page: Page, name: string, target?: Locator, clipHeight?: number): Promise<string> {
  const { viewport, theme } = projectSuffix(test.info().project.name);
  mkdirSync(SHELL_DIR, { recursive: true });
  const file = path.join(SHELL_DIR, `${name}-${viewport}-${theme}.png`);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Bounded: the quota indicator keeps polling, so "networkidle" may never arrive.
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  if (target) await target.screenshot({ path: file, animations: "disabled", caret: "hide" });
  else if (clipHeight) {
    const width = page.viewportSize()?.width ?? 1440;
    await page.screenshot({ path: file, animations: "disabled", caret: "hide", clip: { x: 0, y: 0, width, height: clipHeight } });
  } else await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
  return file;
}

const isMobile = () => projectSuffix(test.info().project.name).viewport === "mobile";
const themeButton = (scope: Page | Locator) => scope.getByRole("button", { name: /^Theme:|^主题：/ });
const menuButton = (page: Page) => page.getByRole("button", { name: new RegExp(`^(${en["nav.menu"]}|${en["nav.menu_close"]})$`) });
/** The inline field error (Next's empty route announcer is also role=alert). */
const fieldAlert = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });
const footerOf = (page: Page) => page.getByRole("contentinfo");

/** Every page carries "Data: seats.aero" │ version │ Legal in one footer line. */
async function expectFooter(page: Page): Promise<void> {
  const footer = footerOf(page);
  await expect(footer.getByText("Data: seats.aero")).toBeVisible();
  await expect(footer).toContainText(/v\d+\.\d+\.\d+/);
  await expect(footer.getByRole("link", { name: "Legal" })).toHaveAttribute("href", "/legal");
  await expect(footer).not.toContainText("·");
}

test.describe("shell", () => {
  test.beforeEach(async ({ page }) => {
    await applyTheme(page);
  });

  test("top bar and footer, signed in", async ({ page, asUser }) => {
    await asUser("demo");
    await page.goto("/queries");
    const header = page.getByRole("banner");
    await expect(header).toHaveCSS("height", "48px");
    await expect(header.getByRole("link", { name: "awardgrid" })).toHaveAttribute("href", "/grid");
    await expectFooter(page);

    if (isMobile()) {
      // Name, quota and a menu button; nav/toggles live in the panel.
      await expect(header.getByRole("navigation")).toBeHidden();
      const menu = menuButton(page);
      await expect(menu).toBeVisible();
      await shellShot(page, "topbar", header);
      await menu.click();
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      const nav = page.getByRole("banner").getByRole("navigation");
      await expect(nav.getByRole("link", { name: "Queries" })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("group", { name: "Language" })).toBeVisible();
      await expect(themeButton(page)).toBeVisible();
      await expect(page.getByRole("button", { name: en["nav.logout"] })).toBeVisible();
      await shellShot(page, "topbar-menu");
      await page.keyboard.press("Escape");
      await expect(nav).toBeHidden();
    } else {
      const nav = header.getByRole("navigation");
      await expect(nav.getByRole("link")).toHaveCount(3);
      await expect(nav.getByRole("link", { name: "Queries" })).toHaveAttribute("aria-current", "page");
      await expect(nav.getByRole("link", { name: "Grid" })).not.toHaveAttribute("aria-current", "page");
      await expect(header.getByRole("group", { name: "Language" })).toBeVisible();
      await expect(themeButton(header)).toBeVisible();
      await expect(menuButton(page)).toBeHidden();
      await shellShot(page, "topbar", header);

      // User menu: username button → popover with "Log out"; Escape closes and refocuses.
      const userButton = header.getByRole("button", { name: /demo/ });
      await userButton.click();
      await expect(page.getByRole("menu")).toBeVisible();
      await expect(page.getByRole("menuitem", { name: en["nav.logout"] })).toBeVisible();
      await shellShot(page, "topbar-user-menu", undefined, 160);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toBeHidden();
      await expect(userButton).toBeFocused();
    }
  });

  test("top bar on the grid page, signed in", async ({ page, asUser }) => {
    await asUser("demo");
    await page.goto("/grid");
    await expect(page.getByRole("textbox", { name: en["grid.search"] })).toBeVisible();
    const header = page.getByRole("banner");
    const quota = header.getByTestId("quota-indicator");
    await expect(quota).toBeVisible();
    await expect(quota).toHaveAttribute("data-quota-state", "ok");
    // The soft limit is the denominator on both surfaces now (the settings bar fills toward it);
    // the 1,000 hard allowance is left to the tooltip and the settings caption.
    await expect(quota).toHaveAccessibleName(/950/);
    if (!isMobile()) {
      await expect(header.getByRole("navigation").getByRole("link", { name: "Grid" })).toHaveAttribute("aria-current", "page");
    }
    await shellShot(page, "topbar-grid", header);
  });

  test("theme toggle flips data-theme and persists across reload", async ({ page, asUser }) => {
    await asUser("demo");
    await page.goto("/queries");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "system");

    if (isMobile()) await menuButton(page).click();
    const toggle = themeButton(page);
    await expect(toggle).toHaveText(en["theme.system"]);
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(toggle).toHaveText(en["theme.light"]);
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toHaveText(en["theme.dark"]);

    // Cookie: ag_theme=dark, Lax, about a year.
    const cookie = (await page.context().cookies()).find((c) => c.name === "ag_theme");
    expect(cookie?.value).toBe("dark");
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.httpOnly).toBe(false);
    expect((cookie?.expires ?? 0) * 1000 - Date.now()).toBeGreaterThan(300 * 24 * 3600 * 1000);

    // Reload: the server renders the attribute from the cookie, so there is no flash to hide.
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    const res = await page.request.get("/queries");
    const markup = await res.text();
    expect(markup).toMatch(/<html[^>]*\sdata-theme="dark"/);
    expect(markup).toContain("ag_theme=(system|light|dark)");

    // Also stored for the account (seeds a new device).
    const me = await page.request.get("/api/auth/me");
    expect(me.ok()).toBe(true);
    expect(((await me.json()) as { user: { theme: string } }).user.theme).toBe("dark");

    // Back to system, so the other tests start from the default.
    if (isMobile()) await menuButton(page).click();
    await themeButton(page).click();
    await expect(html).toHaveAttribute("data-theme", "system");
    if (isMobile()) await page.keyboard.press("Escape");
    await shellShot(page, "theme-system", page.getByRole("banner"));
  });

  test("stored theme seeds a device that has no cookie", async ({ page, asUser }) => {
    await asUser("demo");
    const baseURL = test.info().project.use.baseURL ?? "";
    const put = (theme: string) =>
      page.request.put("/api/settings", { headers: { origin: baseURL, "content-type": "application/json" }, data: { theme } });
    expect((await put("dark")).ok()).toBe(true);
    try {
      // A new device: session cookie only. The server renders the stored choice and the
      // pre-paint script must leave it alone; the toggle names the theme that is painted.
      await page.context().clearCookies({ name: "ag_theme" });
      await page.goto("/queries");
      const html = page.locator("html");
      await expect(html).toHaveAttribute("data-theme", "dark");
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(17, 17, 17)");
      if (isMobile()) await menuButton(page).click();
      await expect(themeButton(page)).toHaveText(en["theme.dark"]);
      // Reload after the toggle has been hydrated: still dark, still no flash to hide.
      await page.reload();
      await expect(html).toHaveAttribute("data-theme", "dark");
      expect((await page.context().cookies()).find((c) => c.name === "ag_theme")).toBeUndefined();
    } finally {
      expect((await put("system")).ok()).toBe(true);
    }
  });

  test("language toggle keeps keyboard focus through the refresh", async ({ page, asUser }) => {
    await asUser("demo");
    await page.goto("/queries");
    if (isMobile()) await menuButton(page).click();
    // The group is renamed in the new language, so match it in both.
    const group = page.getByRole("group", { name: new RegExp(`^(${en["locale.label"]}|${zh["locale.label"]})$`) });
    const zhButton = group.getByRole("button", { name: en["locale.zh"] });
    await zhButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(zhButton).toHaveAttribute("aria-pressed", "true");
    await expect(zhButton).toBeFocused();
    await expect(group).not.toHaveAttribute("aria-busy", "true");
    // And back, so the button is never disabled either way.
    const enButton = group.getByRole("button", { name: en["locale.en"] });
    await expect(enButton).toBeEnabled();
    await enButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(enButton).toBeFocused();
  });

  test("login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
    // One verb through the register flow: the cross-link says "Create one", the page "Create account".
    await expect(page.getByRole("link", { name: en["auth.login.register_link"] })).toHaveAttribute("href", "/register");
    const header = page.getByRole("banner");
    await expect(header.getByRole("navigation")).toHaveCount(0);
    await expect(menuButton(page)).toHaveCount(0);
    await expect(header.getByRole("group", { name: "Language" })).toBeVisible();
    await expect(themeButton(header)).toBeVisible();
    await expectFooter(page);
    // 360 px column, no card: the form has no border and no shadow.
    const form = page.getByRole("form").or(page.locator("form")).first();
    const box = await form.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(360);
    await expect(form).toHaveCSS("box-shadow", "none");
    await shellShot(page, "login");

    // Wrong password → inline error under the password field (a username nobody owns, so the
    // per-username login throttle for the seeded users is never touched).
    await page.getByLabel("Username").fill("nobody-e2e");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Log in" }).click();
    const error = fieldAlert(page);
    await expect(error).toHaveText(en["error.invalid_credentials"]);
    await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Password")).toHaveAttribute("aria-describedby", /password-error/);
    await shellShot(page, "login-error");
  });

  test("register page", async ({ page }) => {
    await page.goto("/register?code=E2E-CODE");
    await expect(page.getByRole("heading", { level: 1, name: en["auth.register.title"] })).toBeVisible();
    await expect(page.getByLabel("Invite code")).toHaveValue("E2E-CODE");
    const hint = page.getByText(en["auth.password_hint"]);
    await expect(hint).toBeVisible();
    await expect(hint).not.toHaveAttribute("data-satisfied", "true");
    await expectFooter(page);
    await shellShot(page, "register");

    // The password rule reads muted until it is met, then in --fg (plan §6.9).
    const fg = await page.locator("body").evaluate((el) => getComputedStyle(el).color);
    await expect(hint).not.toHaveCSS("color", fg);
    await page.getByLabel("Username").fill("nobody-e2e");
    await page.getByLabel("Password").fill("short");
    await expect(hint).not.toHaveCSS("color", fg);
    await page.getByLabel("Password").fill("eight-chars-long");
    await expect(hint).toHaveAttribute("data-satisfied", "true");
    await expect(hint).toHaveCSS("color", fg);
    await page.getByRole("button", { name: en["auth.register.submit"] }).click();
    await expect(fieldAlert(page)).toHaveText(en["error.invalid_invite"]);
    await expect(page.getByLabel("Invite code")).toHaveAttribute("aria-invalid", "true");
    await shellShot(page, "register-error");
  });

  test("legal page in the reading column", async ({ page, asUser }) => {
    await asUser("demo");
    await page.goto("/legal");
    const article = page.getByRole("article");
    await expect(article).toBeVisible();
    // The page owns the h1 (sentence case); the file's "# LEGAL" line is not rendered.
    await expect(article.getByRole("heading", { level: 1 })).toHaveText(en["legal.title"]);
    await expect(article).not.toContainText("LEGAL");
    const box = await article.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(880);
    await expectFooter(page);
    await shellShot(page, "legal");
  });

  test("unknown route shows the not-found page with the shell", async ({ page, asUser }) => {
    await asUser("demo");
    await page.goto("/this-page-does-not-exist");
    await expect(page.getByText(en["common.not_found"])).toBeVisible();
    await expect(page.getByRole("link", { name: en["common.go_to_grid"] })).toHaveAttribute("href", "/grid");
    await expectFooter(page);
  });
});
