/**
 * Shared Playwright fixtures and page helpers for the awardgrid e2e suite.
 *
 * Users come from scripts/seed-e2e.ts (fake passwords, fake keys that select a scenario on the
 * DEMO=1 mock). Login goes through POST /api/auth/login with an Origin header (the cross-site
 * guard in src/proxy.ts) and the resulting httpOnly cookie is copied into the test's browser
 * context — one login per user per worker, so the per-username login throttle is never hit.
 *
 * Selectors are role/text based on the current UI (no data-testids were added in 6.0).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test as base, expect, request as playwrightRequest, type Locator, type Page } from "@playwright/test";
import { E2E_PASSWORD, type E2eUsername } from "./users";

export { expect };
export type { E2eUsername };

/** The canonical zh query from the spec (parses deterministically — no language model needed). */
export const CANONICAL_QUERY_ZH = "香港、上海、东京、首尔到西雅图，未来一个月最便宜的头等舱";
export const CANONICAL_QUERY_EN = "HKG, SHA, TYO, SEL to SEA, next 30 days, business and first";

export const BEFORE_DIR = path.resolve(import.meta.dirname, "..", "docs", "screenshots", "v0.2", "before");

type Cookie = Awaited<ReturnType<import("@playwright/test").APIRequestContext["storageState"]>>["cookies"][number];
const cookieCache = new Map<string, Cookie[]>();

/** Log `username` in through the JSON API and return the session cookie(s); cached per worker. */
export async function loginCookies(baseURL: string, username: E2eUsername): Promise<Cookie[]> {
  const cached = cookieCache.get(username);
  if (cached) return cached;
  const ctx = await playwrightRequest.newContext({ baseURL });
  try {
    const res = await ctx.post("/api/auth/login", {
      headers: { origin: baseURL, "content-type": "application/json" },
      data: { username, password: E2E_PASSWORD },
    });
    if (!res.ok()) throw new Error(`login as ${username} failed: HTTP ${res.status()} (is the e2e database seeded?)`);
    const { cookies } = await ctx.storageState();
    if (cookies.length === 0) throw new Error(`login as ${username} set no cookie`);
    cookieCache.set(username, cookies);
    return cookies;
  } finally {
    await ctx.dispose();
  }
}

/** Put `username`'s session cookie into the page's browser context (replacing any other user). */
export async function loginAs(page: Page, username: E2eUsername): Promise<void> {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("baseURL is not configured");
  const cookies = await loginCookies(baseURL, username);
  await page.context().clearCookies();
  await page.context().addCookies(cookies);
}

/** Project name → the `-<viewport>-<theme>` suffix used for screenshot file names. */
export function projectSuffix(projectName: string): { viewport: "desktop" | "mobile"; theme: "light" | "dark" } {
  const viewport = projectName.startsWith("mobile") ? "mobile" : "desktop";
  const theme = projectName.endsWith("dark") ? "dark" : "light";
  return { viewport, theme };
}

/** Apply the project's colour scheme through emulateMedia as well (the app only knows prefers-color-scheme today). */
export async function applyTheme(page: Page): Promise<void> {
  const { theme } = projectSuffix(test.info().project.name);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

/** Full-page PNG at docs/screenshots/v0.2/before/<page>-<state>-<viewport>-<theme>.png. */
export async function beforeShot(page: Page, name: string): Promise<string> {
  const { viewport, theme } = projectSuffix(test.info().project.name);
  mkdirSync(BEFORE_DIR, { recursive: true });
  const file = path.join(BEFORE_DIR, `${name}-${viewport}-${theme}.png`);
  // Let fonts, the sticky header and any pending re-render settle before capturing.
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled", caret: "hide" });
  return file;
}

// ---------------------------------------------------------------------------
// Page helpers (current UI)
// ---------------------------------------------------------------------------

/** The natural-language query box on /grid. */
export function queryBox(page: Page): Locator {
  return page.getByRole("textbox", { name: "Search" });
}

/** Grid cells that carry a best row: their button's aria-label starts with the miles figure. */
export function availableCells(page: Page): Locator {
  return page.locator("table td button[aria-label*='miles']");
}

/** Type `text` into the query box and submit it; resolves once parsing has finished. */
export async function submitQuery(page: Page, text: string): Promise<void> {
  const box = queryBox(page);
  await box.fill(text);
  await box.press("Enter");
}

/** Open /grid as `username`, submit the query and wait for the results table to render. */
export async function openGridWithResults(page: Page, username: E2eUsername = "demo", text: string = CANONICAL_QUERY_ZH): Promise<void> {
  await loginAs(page, username);
  await page.goto("/grid");
  await submitQuery(page, text);
  await expect(page.getByRole("table")).toBeVisible({ timeout: 60_000 });
  await expect(availableCells(page).first()).toBeVisible({ timeout: 60_000 });
}

/** Click the first cell that has miles and wait for the cell drawer (a dialog) to open. */
export async function openCellDrawer(page: Page): Promise<Locator> {
  const cell = availableCells(page).first();
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /flights|trips/i }).first()).toBeVisible();
  return dialog;
}

/** Close whichever drawer is open (Escape) and wait for it to disappear. */
export async function closeDrawer(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
}

/** Open the Ask drawer from the grid header bar and wait for its prompt box. */
export async function openAskDrawer(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Ask" })).toBeVisible();
  return dialog;
}

export interface Fixtures {
  /** Log the page's context in as the given seeded user. */
  asUser: (username: E2eUsername) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  asUser: async ({ page }, provide) => {
    await provide((username) => loginAs(page, username));
  },
});
