/**
 * T07 — mobile navigation, query summary and readable result cards (plan 02 T07; acceptance A12).
 *
 * The results come from the shown snapshot. Scenarios that start with results (missing-values, partial,
 * coverage-unknown, legacy-cache) launch with a workspace saved by an earlier launch, so nothing is fetched to show
 * them. Geometry follows docs/04 S01 at the 390 pt default: header 52, query summary 64, filters 44, view 44, status
 * 28, gap 12 — the first card starts 244 below the top of the page (the fixture page has no safe-area inset).
 */
import type { Page } from "@playwright/test";
import { evidenceShot, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

/** The tab chrome scrolls inside `.app-main`, so a sideways overflow can hide there as well as on the page. */
async function overflows(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const main = document.querySelector(".app-main");
    return document.documentElement.scrollWidth > innerWidth || (main !== null && main.scrollWidth > main.clientWidth);
  });
}

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`${testId} not rendered`);
  return b;
}

test("unknown values remain readable on the actual card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openScenario(page, "missing-values", "ios", { lang: "zh" });
  const list = page.getByTestId("availability-list");
  await expect(list.getByText("税费待确认").first()).toBeVisible();
  await expect(list.getByText("席位未提供").first()).toBeVisible();
  await expect(list.getByText("75,000").first()).toBeVisible();
  expect(await overflows(page)).toBe(false);
});

test("an explicit zero fee is zero with its currency; a known seat count is a count (English)", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  const list = page.getByTestId("availability-list");
  await expect(list.getByText("USD 0.00")).toBeVisible();
  await expect(list.getByText("1 seat", { exact: true })).toBeVisible();
  await expect(list.getByText("Fees not yet confirmed")).toBeVisible();
  await expect(list.getByText("Seat count not provided")).toBeVisible();
  expect((await requestLog(page)).seats).toBe(0);
});

test("390 default: 52 / 64 / 44 / 44 / 28 / 12 before the first card, cards at least 164, 16 gutters", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  const header = await box(page, "results-header");
  const summary = await box(page, "query-summary");
  const filters = await box(page, "results-filters");
  const view = await box(page, "results-view");
  const status = await box(page, "results-status");
  const first = await page.getByTestId("availability-card").first().boundingBox();
  expect(Math.round(header.y)).toBe(0);
  expect(Math.round(header.height)).toBe(52);
  expect(Math.round(summary.height)).toBe(64);
  expect(Math.round(filters.height)).toBe(44);
  expect(Math.round(view.height)).toBe(44);
  expect(Math.round(status.height)).toBe(28);
  expect(Math.round(first!.y)).toBe(244);
  expect(Math.round(first!.x)).toBe(16);
  expect(Math.round(first!.width)).toBe(358);
  for (const card of await page.getByTestId("availability-card").all()) expect((await card.boundingBox())!.height).toBeGreaterThanOrEqual(164);
});

test("the card: route, date and cabin in words, miles, program, fees, seats, source time; selection is a separate 44 control", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  const card = page.getByTestId("availability-card").first();
  await expect(card.getByRole("heading", { name: "HKG → SEA" })).toBeVisible();
  await expect(card.getByText("Sun, Oct 18")).toBeVisible();
  await expect(card.getByText("Business", { exact: true })).toBeVisible();
  await expect(card.getByText("75,000")).toBeVisible();
  await expect(card.getByText("Air Canada Aeroplan")).toBeVisible();
  // Source time: the provider's, with its age on the scenario clock (2026-10-17 06:00 → 2026-10-18 08:30).
  await expect(card.getByText("Source updated 1 d ago")).toBeVisible();
  const select = card.getByRole("checkbox");
  // The target is the 44 pt label around the 20 pt box: a tap near its corner toggles it.
  const target = select.locator("xpath=..");
  const b = (await target.boundingBox())!;
  expect(b.width).toBeGreaterThanOrEqual(44);
  expect(b.height).toBeGreaterThanOrEqual(44);
  await page.mouse.click(b.x + 3, b.y + b.height - 3);
  await expect(select).toBeChecked();
  // It is not inside another control.
  expect(await select.evaluate((el) => el.parentElement?.closest("button, a, [role='button']") === null)).toBe(true);
  expect((await requestLog(page)).seats).toBe(0);
});

test("the query summary is the shown snapshot's, and opens the editor", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  const summary = page.getByTestId("query-summary");
  await expect(summary).toContainText("HKG → SEA");
  await expect(summary).toContainText("Oct 1 – 30");
  await expect(summary).toContainText("Business, First");
  await summary.getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Edit search", level: 1 })).toBeVisible();
});

test("the tab bar: Search, Watches, Settings; AI assistance from the header; Saved hidden until it exists", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  const tabs = page.getByRole("navigation", { name: "Main navigation" });
  await expect(tabs.getByRole("link")).toHaveText(["Search", "Watches", "Settings"]);
  await expect(tabs.getByRole("link", { name: "Search" })).toHaveAttribute("aria-current", "page");
  for (const link of await tabs.getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByTestId("results-header").getByRole("link", { name: "AI assistance" }).click();
  await expect(page).toHaveURL(/#\/ask/);
});

test("coverage is said, not implied: partial, unknown, empty and unmonitored each have their own words", async ({ page }) => {
  await openScenario(page, "partial", "ios", { lang: "en" });
  await expect(page.getByText("Results are incomplete.")).toBeVisible();
  await openScenario(page, "coverage-unknown", "ios", { lang: "en" });
  await expect(page.getByText("Coverage completeness is unknown.")).toBeVisible();
  await openScenario(page, "legacy-cache", "ios", { lang: "en" });
  await expect(page.getByTestId("availability-list").getByText("Source update time unknown").first()).toBeVisible();
  // A checked, complete, empty range, and a route the provider does not monitor, after a real (synthetic) search.
  await openScenario(page, "complete-empty", "ios", { lang: "en" });
  await searchByText(page, "Synthetic HKG to SEA October business and first");
  await expect(page.getByText("No matches in the checked range.")).toBeVisible();
  await expect(page.getByTestId("availability-list")).toHaveCount(0);
  await openScenario(page, "unmonitored", "ios", { lang: "zh" });
  await searchByText(page, "Synthetic HKG to SEA October business and first");
  await expect(page.getByText("数据源未监测这些机场对。")).toBeVisible();
});

test("320 wide: nothing clips, miles stay whole, and chips that do not fit say they scroll", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openScenario(page, "missing-values", "ios", { lang: "zh" });
  expect(await overflows(page)).toBe(false);
  for (const miles of await page.getByTestId("card-miles").all()) {
    expect(await miles.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  // Either every chip sits inside the 16 pt gutters, or the row scrolls and its edge fades to say so.
  const filters = page.getByTestId("results-filters");
  const scrolls = await filters.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(await filters.evaluate((el) => el.hasAttribute("data-overflow"))).toBe(scrolls);
  if (!scrolls) {
    for (const chip of await filters.getByRole("link").all()) {
      const b = (await chip.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(16);
      expect(b.x + b.width).toBeLessThanOrEqual(320 - 16);
    }
  }
});

test("each selection box is named for its own result — program and miles included — and no two are alike", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  const boxes = page.getByTestId("availability-list").getByRole("checkbox");
  const names = await boxes.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
  expect(names.length).toBeGreaterThan(1);
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) {
    expect(name).toMatch(/^Select HKG → SEA, /);
    expect(name).toContain("Air Canada Aeroplan");
    expect(name).toMatch(/[\d,]+ miles/);
  }
  await boxes.first().check();
  const card = page.getByTestId("availability-card").first();
  await expect(card.getByText("Selected", { exact: true })).toBeVisible();
});

test("focus comes back to what opened the editor: a chip, or the summary even mid-search", async ({ page }) => {
  await openScenario(page, "inflight-old", "ios", { lang: "en" });
  await page.locator("#chip-stops").click();
  await expect(page.getByRole("heading", { name: "Edit search", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).first().click();
  await expect(page.locator("#chip-stops")).toBeFocused();
  // A typed search from the editor starts a run that never answers here; the summary, now not a link, takes focus.
  await page.getByTestId("query-summary").getByRole("link").click();
  await page.locator("#q").fill("Synthetic HKG to SEA October business and first");
  await page.getByRole("button", { name: /^Run/ }).click();
  await expect(page.getByTestId("query-summary")).toContainText("A search is running.");
  await expect(page.locator("#edit-search")).toBeFocused();
  expect((await requestLog(page)).anthropic).toBe(0);
});

test("in Chinese, the parts still in English say so (the text search); the matrix speaks Chinese since T09", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "zh" });
  await expect(page.locator(".ag-results")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("#q").locator("xpath=ancestor::*[@lang][1]")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await openScenario(page, "missing-values", "ios", { lang: "zh" });
  await page.getByTestId("results-view").getByText("矩阵", { exact: true }).click();
  // The T09 matrix is translated: no English island around it, and its headers are Chinese.
  const grid = page.getByRole("grid");
  await expect(grid.locator("xpath=ancestor::*[@lang][1]")).toHaveAttribute("lang", "zh-CN");
  await expect(grid.getByRole("columnheader").first()).toHaveText("出发日期");
  expect((await requestLog(page)).seats).toBe(0);
});

test("no key: the first search is refused before anything is sent, and says where to add one", async ({ page }) => {
  await openScenario(page, "no-seats-key", "ios", { lang: "en" });
  await expect(page.getByText(/Add your own Pro key in/)).toBeVisible();
  expect((await requestLog(page)).seats).toBe(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: results at 390`, async ({ page }) => {
    await openScenario(page, "missing-values", "ios", { theme, lang: "zh" });
    await expect(page.getByTestId("availability-list")).toBeVisible();
    await evidenceShot(page, `t07-results-${theme}`, { fullPage: true });
  });
}
