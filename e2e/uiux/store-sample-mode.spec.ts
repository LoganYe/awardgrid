/**
 * Sample mode in the App Store flavour (release plan steps 16-17; project `ios-store`, the fixture host served with
 * UIUX_STORE=1): the first run's "Try with sample data" opens every feature on made-up data for any route the app
 * knows, with nothing sent anywhere.
 *
 *   - Welcome › Try with sample data › "Hong Kong to Seattle next month, business" → rows › List, Calendar, Matrix ›
 *     an option's details › the comparison › Save › Watch › Exit, back to the welcome.
 *   - "LAX to Tokyo next month" → rows. A code outside the seed → what sample data covers, and one tap to rows.
 *   - The banner on every screen; no "Source updated", "min ago" or "来源" anywhere; no booking or program link; and
 *     zero seats.aero requests: the host's seats.aero stand-in is never called, and nothing leaves the machine.
 *
 * The sample transport is the app's own (apps/ios/src/sample/sample-fetch.ts), loaded in sample mode: the host's
 * synthetic seats.aero transport and its rows play no part here, which is what `seats: 0` shows.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { evidenceShot, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const tab = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });
const banner = (page: Page) => page.getByTestId("sample-banner");
const SOURCE_TIME = /Source updated|Source update time|min ago|来源/;

/** The first run, then "Try with sample data": the app boots again on sample data, on Search. */
async function enterSample(page: Page, lang: "en" | "zh" = "en", theme: "light" | "dark" = "light") {
  await openScenario(page, "no-seats-key", "ios", { lang, theme });
  const welcome = page.getByTestId("welcome");
  const tryIt = lang === "en" ? "Try with sample data" : "试用示例数据";
  // Sample data first, then the account.
  await expect(welcome.getByRole("button").first()).toHaveText(tryIt);
  await welcome.getByRole("button", { name: tryIt }).click();
  await expect(banner(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: lang === "en" ? "Search" : "查票" })).toBeFocused();
}

/**
 * What every sample screen must hold: one banner with its title, the approved sentence and Exit (in `scope`: an
 * option's details and the comparison draw over the Search screen, which keeps its own), and no source time or age.
 */
async function sampleScreen(page: Page, where: string, lang: "en" | "zh" = "en", scope = page.locator("body")) {
  const one = scope.getByTestId("sample-banner").filter({ visible: true });
  await expect(one, where).toHaveCount(1);
  await expect(one, where).toContainText(lang === "en" ? "Sample data" : "示例数据");
  await expect(one, where).toContainText(lang === "en" ? "Illustrative data — not live availability" : "虚构示例数据，并非实时库存");
  await expect(one.getByRole("button", { name: lang === "en" ? "Exit sample data" : "退出示例数据" }), where).toBeVisible();
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  expect(text.match(SOURCE_TIME)?.[0] ?? null, `${where}: ${text.slice(0, 300)}`).toBeNull();
  // No booking or program link, and no seats.aero attribution link over made-up rows.
  await expect(page.locator('a[href^="http"]:not([href^="https://awardgrid.dowhiz.com/"])'), where).toHaveCount(0);
}

test("Welcome › Try sample › Hong Kong to Seattle › List, Calendar, Matrix › details › compare › save › watch › exit", async ({ page }) => {
  test.setTimeout(90_000);
  await enterSample(page);
  await sampleScreen(page, "search, empty");
  await evidenceShot(page, "sample-search-empty");

  await searchByText(page, "Hong Kong to Seattle next month, business");
  const list = page.getByTestId("availability-list");
  await expect(list.getByTestId("availability-card").first()).toBeVisible();
  expect(await list.getByTestId("availability-card").count()).toBeGreaterThan(5);
  await expect(list.getByTestId("availability-card").first()).toContainText("HKG → SEA");
  await expect(list.getByTestId("availability-card").first().locator(".ag-result-time")).toHaveText("Sample data");
  const status = page.getByTestId("results-status");
  await expect(status).toContainText("Sample data · on this device");
  await expect(status).not.toContainText("seats.aero");
  await expect(page.getByText(/seats\.aero calls today/)).toHaveCount(0);
  await sampleScreen(page, "search, list");
  await evidenceShot(page, "sample-search-list");

  const views = page.getByTestId("results-view");
  await views.getByText("Calendar", { exact: true }).click();
  await expect(page.getByTestId("calendar-view")).toBeVisible();
  await sampleScreen(page, "search, calendar");
  await views.getByText("Matrix", { exact: true }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await sampleScreen(page, "search, matrix");
  await views.getByText("List", { exact: true }).click();

  // An option's details: sample time, no program link, and the itineraries drawn by the sample transport.
  await list.getByTestId("availability-card").first().getByRole("button", { name: /^View option/ }).click();
  const details = page.getByTestId("detail-screen");
  await expect(details.getByTestId("sample-banner")).toBeVisible();
  await expect(details).toContainText("Sample options have no booking links.");
  await expect(details).toContainText("Sample data · on this device");
  await expect(details.getByRole("link", { name: /Program website/ })).toHaveCount(0);
  await details.getByRole("button", { name: "View flight itineraries" }).click();
  await expect(details.getByTestId("trip-card").first()).toBeVisible();
  // Drawn on this device, not loaded from anywhere: no "Loaded on this device …" age, which would read "1 min ago" later.
  await expect(details).not.toContainText("Loaded on this device");
  await sampleScreen(page, "details", "en", details);
  await evidenceShot(page, "sample-details");
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);

  // The comparison.
  const boxes = list.getByRole("checkbox");
  for (let i = 0; i < 2; i++) await boxes.nth(i).check();
  await page.getByRole("link", { name: "Compare selected options" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compare selected options" })).toBeFocused();
  const compare = page.locator(".ag-compare");
  await expect(compare.getByTestId("sample-banner")).toBeVisible();
  await expect(compare).toContainText("Sample options have no booking links.");
  await expect(compare).toContainText("Sample data · on this device");
  await sampleScreen(page, "compare", "en", compare);
  await evidenceShot(page, "sample-compare");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();

  // Save and watch, then each tab carries the banner, and Watches and Saved say where their data comes from.
  await page.getByRole("button", { name: "Save results" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved on this device." })).toBeVisible();
  await page.getByRole("button", { name: "Watch this search" }).click();
  await expect(page.getByText("Watching this search.", { exact: false })).toBeVisible();
  await tab(page, "Watches").click();
  await expect(page.getByTestId("watch-card")).toHaveCount(1);
  await expect(page.getByText("A check sooner than 45 minutes after the previous one is skipped.")).toBeVisible();
  await expect(page.locator(".app-attribution")).toHaveText("Sample data · on this device");
  await sampleScreen(page, "watches");
  await tab(page, "Saved").click();
  await expect(page.getByRole("link", { name: /^Open saved results: / })).toHaveCount(1);
  await expect(page.locator(".app-attribution")).toHaveText("Sample data · on this device");
  await sampleScreen(page, "saved");
  await page.getByRole("link", { name: /^Open saved results: / }).click();
  await expect(page.getByTestId("availability-card").first().locator(".ag-result-time")).toHaveText("Sample data");
  await sampleScreen(page, "saved results");
  await tab(page, "Settings").click();
  await expect(page.locator("#settings-row-seats")).toContainText("Sample data");
  await expect(page.locator("#settings-row-seats")).not.toContainText("Key on file");
  await sampleScreen(page, "settings");
  await page.locator("#settings-row-seats").click();
  await expect(page.getByText("Exit sample data to connect your account.")).toBeVisible();
  await expect(page.getByLabel("seats.aero API key")).toHaveCount(0);
  await sampleScreen(page, "settings/seats");
  await page.evaluate(() => (location.hash = "#/edit"));
  await expect(page.getByRole("heading", { level: 1, name: "Edit search" })).toBeVisible();
  await expect(page.getByText("Searches the sample data on this device · No AI")).toBeVisible();
  await sampleScreen(page, "edit");

  // Exit: the account's first run again, with nothing of sample mode left.
  await banner(page).getByRole("button", { name: "Exit sample data" }).click();
  await expect(page.getByTestId("welcome")).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/$/);
  const leftOver = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("uiux-fixture:files:sample/")));
  expect(leftOver).toEqual([]);
  await tab(page, "Watches").click();
  await expect(page.getByTestId("watch-card")).toHaveCount(0);
  await tab(page, "Saved").click();
  await expect(page.getByRole("link", { name: /^Open saved results: / })).toHaveCount(0);

  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0, trips: 0 });
});

test("LAX to Tokyo next month → rows; a code outside the seed → what sample data covers, and one tap to rows", async ({ page }) => {
  await enterSample(page);
  // A text with no dates: the parser's own words (they suggest "next month"), and one tap to a search with rows.
  await searchByText(page, "HKG to SEA");
  await expect(page.getByRole("alert").filter({ hasText: /Couldn't read the start date, end date/ })).toContainText("next month");
  await expect(page.getByRole("button", { name: "Try Hong Kong to Seattle, next 30 days, business" })).toBeVisible();

  await searchByText(page, "LAX to Tokyo next month");
  const cards = page.getByTestId("availability-list").getByTestId("availability-card");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(5);
  await expect(cards.first()).toContainText(/LAX → (NRT|HND)/);
  await sampleScreen(page, "LAX to Tokyo");

  // An airport outside the seed, typed as a code in the editor.
  await page.getByTestId("query-summary").getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: "Edit search" })).toBeVisible();
  // The arrival airports first, then the departure: focus ends in the departure field, where LIS is typed.
  for (const code of ["NRT", "HND", "LAX"]) await page.getByRole("button", { name: new RegExp(`^Remove ${code}\\b`) }).click();
  const departure = page.getByRole("combobox", { name: "Departure airports: Add airport" });
  await expect(departure).toBeFocused();
  await departure.fill("LIS");
  await expect(page.getByRole("listbox", { name: "Departure airports" }).getByRole("option", { name: "Use the code LIS" })).toBeVisible();
  await departure.press("Enter");
  const arrival = page.getByRole("combobox", { name: "Arrival airports: Add airport" });
  await arrival.click();
  await arrival.fill("SEA");
  await page.getByRole("listbox", { name: "Arrival airports" }).getByRole("option", { name: /Seattle/ }).first().click();
  await page.getByRole("button", { name: "Find award options" }).click();
  await expect(page.getByTestId("query-summary")).toContainText("LIS");
  await expect(page.locator(".ag-results[data-run]")).toHaveAttribute("data-busy", "false");
  await expect(page.getByTestId("sample-coverage")).toHaveText("Sample data covers the 84 airports AwardGrid recognises, for the next 12 months.");
  // It says what sample data covers instead of "not monitored", which would only repeat it.
  await expect(page.getByTestId("coverage-notice").filter({ hasText: "not monitored" })).toHaveCount(0);
  await sampleScreen(page, "outside the seed");
  await evidenceShot(page, "sample-coverage");

  // One tap: Hong Kong to Seattle, the next 30 days, business.
  await page.getByRole("button", { name: "Try Hong Kong to Seattle, next 30 days, business" }).click();
  await expect(page.getByTestId("query-summary")).toContainText("HKG");
  await expect(page.getByTestId("availability-list").getByTestId("availability-card").first()).toContainText("HKG → SEA");
  await expect(page.getByTestId("sample-coverage")).toHaveCount(0);
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0, trips: 0 });
});

test("in Chinese: the banner, the sample time line and nothing that says 来源, on every tab", async ({ page }) => {
  await enterSample(page, "zh");
  await searchByText(page, "香港到西雅图 未来一个月 商务舱");
  const first = page.getByTestId("availability-list").getByTestId("availability-card").first();
  await expect(first.locator(".ag-result-time")).toHaveText("示例数据");
  await expect(page.getByTestId("results-status")).toContainText("示例数据 · 仅在本机");
  await sampleScreen(page, "查票", "zh");
  await first.getByRole("button", { name: /^查看选项/ }).click();
  await expect(page.getByTestId("detail-screen")).toContainText("示例选项没有预订链接。");
  await sampleScreen(page, "详情", "zh", page.getByTestId("detail-screen"));
  await page.keyboard.press("Escape");
  for (const [name, where] of [
    ["关注", "关注"],
    ["收藏", "收藏"],
    ["设置", "设置"],
  ] as const) {
    await tab(page, name).click();
    await sampleScreen(page, where, "zh");
  }
  await evidenceShot(page, "sample-settings-zh");
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0, trips: 0 });
});

test("the old example's address enters sample mode, and an account removed after a search offers it too", async ({ page }) => {
  await openScenario(page, "no-seats-key", "ios", { lang: "en" });
  await page.evaluate(() => (location.hash = "#/example"));
  await expect(banner(page)).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  await sampleScreen(page, "from #/example");

  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, "Synthetic HKG to SEA October business and first");
  await tab(page, "Settings").click();
  await page.locator("#settings-row-seats").click();
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  // Removing the key returns to Search, which says so and offers sample data or the account again.
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("status").filter({ hasText: "seats.aero key removed from this device." })).toBeVisible();
  const callout = page.getByRole("alert").filter({ hasText: "No seats.aero account connected." });
  await callout.getByRole("link", { name: "Try sample data" }).click();
  await expect(banner(page)).toBeVisible();
  await sampleScreen(page, "after removing the key");
  // The account's search results are not in sample mode, and come back on exit.
  await expect(page.getByTestId("availability-list")).toHaveCount(0);
  await banner(page).getByRole("button", { name: "Exit sample data" }).click();
  await expect(page.getByTestId("availability-list")).toBeVisible();
  // The one seats.aero request is the account's own search, before sample mode.
  expect((await requestLog(page)).seats).toBe(1);
});

/** Serious or critical axe violations (WCAG 2.0/2.1 A and AA), as accessibility.spec.ts reads them. */
async function axeProblems(page: Page, key: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").flatMap((v) => v.nodes.map((n) => `${key} ${v.id}: ${n.target.join(" ")}`));
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: sample mode's banner and screens have no serious or critical axe violation`, async ({ page }) => {
    test.setTimeout(90_000);
    await enterSample(page, "en", theme);
    const bad = await axeProblems(page, `${theme} search empty`);
    await searchByText(page, "Hong Kong to Seattle next month, business");
    bad.push(...(await axeProblems(page, `${theme} search list`)));
    await page.getByTestId("availability-list").getByTestId("availability-card").first().getByRole("button", { name: /^View option/ }).click();
    await expect(page.getByTestId("detail-screen")).toBeVisible();
    bad.push(...(await axeProblems(page, `${theme} details`)));
    await page.keyboard.press("Escape");
    for (const name of ["Watches", "Saved", "Settings"]) {
      await tab(page, name).click();
      bad.push(...(await axeProblems(page, `${theme} ${name}`)));
    }
    expect(bad).toEqual([]);
  });
}

