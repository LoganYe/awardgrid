/**
 * The App Store flavour (apps/ios/src/app/flags.ts STORE; release plan steps 14-15), on the fixture host served with
 * UIUX_STORE=1 (project `ios-store`, playwright.uiux.config.ts). Ask is compiled out: no way into it from Search or
 * Settings, no Anthropic key page, `#/ask` and `#/settings/anthropic` open Search, and nothing is ever sent to
 * Anthropic. Everything else works as in the default build.
 */
import type { Page } from "@playwright/test";
import { openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";

/** Ask, Claude, Anthropic or the AI entry, in either language. */
const ASK_WORDS = /\bAsk\b|Anthropic|Claude|AI assistance|AI ?辅助|AI 对话|AI（可选）|AI \(optional\)/;

const tab = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });

test("Search: the results carry no way into Ask, in the header or under the results", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  await expect(page.getByTestId("availability-list")).toBeVisible();
  await expect(page.getByRole("button", { name: "Watch this search" })).toBeVisible();
  await expect(page.locator('a[href="#/ask"]')).toHaveCount(0);
  await expect(page.getByTestId("results-header")).toHaveText("Search");
  await expect(page.locator("main")).not.toContainText(ASK_WORDS);
  expect((await requestLog(page)).anthropic).toBe(0);
});

test("an address of Ask's, typed or left over, opens Search", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  for (const hash of ["#/ask", "#/settings/anthropic", "#/no-such-page"]) {
    await page.evaluate((h) => (location.hash = h), hash);
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
    await expect(page).toHaveURL(/#\/$/);
  }
  expect((await requestLog(page)).anthropic).toBe(0);
});

for (const [lang, settings, groups] of [
  ["en", "Settings", ["Data connection", "Appearance and language", "Local data", "About"]],
  ["zh", "设置", ["数据连接", "外观与语言", "本地数据", "关于"]],
] as const) {
  test(`${lang}: Settings has no AI group, no Anthropic row, and names neither Ask nor Anthropic`, async ({ page }) => {
    await openScenario(page, "complete", "ios", { lang });
    await tab(page, settings).click();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([...groups]);
    await expect(page.locator("#settings-row-anthropic")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(ASK_WORDS);
    expect((await requestLog(page)).anthropic).toBe(0);
  });
}

test("the seats.aero key's removal sheet says what it affects, and nothing about AI", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await tab(page, "Settings").click();
  await page.locator("#settings-row-seats").click();
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Search stops until you add a key again.");
  await expect(sheet).toContainText("Today's call count is kept.");
  await expect(sheet).not.toContainText(ASK_WORDS);
});

test("clearing the cache says what it keeps without naming Ask", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await tab(page, "Settings").click();
  await expect(page.getByText("This does not touch your seats.aero key.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Clear cached results" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cached results cleared. Your seats.aero key is untouched." })).toBeVisible();
});
