/**
 * Shared Playwright fixtures and page helpers for the awardgrid e2e suite.
 *
 * Users come from scripts/seed-e2e.ts (fake passwords, fake keys that select a scenario on the
 * DEMO=1 mock). Login goes through POST /api/auth/login with an Origin header (the cross-site
 * guard in src/proxy.ts) and the resulting httpOnly cookie is copied into the test's browser
 * context — one login per user per worker, so the per-username login throttle is never hit.
 *
 * Selectors are role/text based; copy comes from the en dictionary so the harness follows the
 * i18n audit instead of pinning strings.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test as base, expect, request as playwrightRequest, type Locator, type Page } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import type { QueryObject } from "../src/lib/query/schema";
import { E2E_PASSWORD, type E2eUsername } from "./users";

export { expect };
export type { E2eUsername };

/**
 * The canonical query from the spec (parses deterministically — no language model needed).
 *
 * Seoul is named as ICN, not SEL: `data/places.json` expands the SEL metro to ICN **and** GMP,
 * while spec §3.2's worked example, §7's demo dataset and docs/UI_PLAN.md §6.2 all show six
 * origins ending in ICN. Naming the airport keeps the demo grid the six routes the fixtures
 * actually carry instead of a seventh, permanently hatched GMP → SEA column. The deviation is
 * recorded in docs/UI_PLAN.md §6.2a.
 */
export const CANONICAL_QUERY_ZH = "香港、上海、东京、首尔到西雅图，未来一个月最便宜的头等舱";
export const CANONICAL_QUERY_EN = "HKG, SHA, TYO, SEL to SEA, next 30 days, business and first";

/**
 * The Phase 6.0 "before" record. It documents the v0.1 UI and is never regenerated: to re-run
 * before.spec.ts against a later UI (to prove the spec still works), point E2E_BEFORE_DIR at a
 * scratch directory.
 */
export const BEFORE_DIR = process.env.E2E_BEFORE_DIR
  ? path.resolve(process.env.E2E_BEFORE_DIR)
  : // Default to a gitignored folder so a routine `pnpm e2e` never overwrites the committed record.
    path.resolve(import.meta.dirname, "..", "test-results", "before");

/** Live axe summary of the current UI (counts per impact per page and project). */
export const AXE_SUMMARY_FILE = path.resolve(import.meta.dirname, "..", "docs", "screenshots", "v0.2", "axe-summary.json");

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

/**
 * /grid?q=… for a QueryObject — the shareable-URL codec of src/components/grid/state.ts
 * (base64url of the JSON), inlined because importing state.ts would pull data/places.json
 * through Playwright's loader, which has no JSON import attribute. The page runs the query on
 * load, so a test can start from any exact QueryObject without going through the parser.
 */
export function gridQueryHref(q: QueryObject): string {
  return `/grid?q=${Buffer.from(JSON.stringify(q), "utf8").toString("base64url")}`;
}

/** Playwright project name → 0..3, for per-project query variants that must not share a cache. */
export function projectIndex(projectName: string): number {
  const { viewport, theme } = projectSuffix(projectName);
  return (viewport === "mobile" ? 2 : 0) + (theme === "dark" ? 1 : 0);
}

/** ISO date `days` calendar days after today (UTC, the e2e timezone). */
export function isoDaysFromToday(days: number): string {
  const t = new Date();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The natural-language query box on /grid. */
export function queryBox(page: Page): Locator {
  return page.getByRole("textbox", { name: en["grid.search"] });
}

/** Grid cells that carry a best row (the 6.2 grid: <td role="gridcell" data-state="ok">). */
export function availableCells(page: Page): Locator {
  return page.locator("td[role='gridcell'][data-state='ok']");
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
  await expect(page.getByRole("grid")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("grid")).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
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

/** Open the Ask drawer from the grid toolbar (inside the "Filters" sheet below 768 px) and wait for its prompt box. */
export async function openAskDrawer(page: Page): Promise<Locator> {
  const ask = page.getByRole("button", { name: en["ask.open"], exact: true });
  if (!(await ask.isVisible())) await page.getByRole("button", { name: en["grid.toolbar.filters"] }).click();
  await ask.click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: en["ask.open"] }) });
  await expect(dialog).toBeVisible();
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
