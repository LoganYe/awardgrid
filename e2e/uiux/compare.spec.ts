/**
 * T12: the selection set and the comparison (plan 03 T12; docs/04 S05; acceptance A22).
 *
 * Two to four options are chosen from any view and kept across views and searches, and a fifth is refused and said
 * so. A phone compares two at a time, with a picker for the others and a one-by-one reading. Nothing is ranked or
 * scored, and nothing is sent.
 */
import type { Page } from "@playwright/test";
import { evidenceShot, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";

/** Choose the first `n` options in the list view. */
async function choose(page: Page, n: number) {
  const boxes = page.getByTestId("availability-list").getByRole("checkbox");
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
}

async function searched(page: Page, lang: "en" | "zh" = "en") {
  await openScenario(page, "complete", "ios", { lang });
  await searchByText(page, SEARCH_TEXT);
  await expect(page.getByTestId("availability-list")).toBeVisible();
  return (await requestLog(page)).seats;
}

test("choose two to four from any view; a fifth is refused and said so, nothing is swapped out, nothing is sent", async ({ page }) => {
  let sent = await searched(page);
  const boxes = page.getByTestId("availability-list").getByRole("checkbox");
  expect(await boxes.count()).toBe(4);
  const tray = page.getByTestId("compare-tray");
  await expect(tray).toHaveCount(0);

  await boxes.nth(0).check();
  await expect(tray).toContainText("1 of 4 chosen");
  // One is not a comparison: the button says why, and stays focusable.
  const open = tray.locator("#compare-open");
  await expect(open).toHaveAttribute("aria-disabled", "true");
  await expect(tray).toContainText("Choose at least two options to compare.");

  for (let i = 1; i < 4; i++) await boxes.nth(i).check();
  await expect(tray).toContainText("4 of 4 chosen");

  // Views share the selection: the calendar and matrix keep it, and coming back shows the same four.
  const view = page.getByTestId("results-view");
  await view.getByText("Calendar", { exact: true }).click();
  await expect(tray).toContainText("4 of 4 chosen");
  await view.getByText("Matrix", { exact: true }).click();
  await expect(tray).toContainText("4 of 4 chosen");
  await view.getByText("List", { exact: true }).click();
  for (let i = 0; i < 4; i++) await expect(boxes.nth(i)).toBeChecked();
  // A second press clears one; choosing it again brings it back.
  await boxes.nth(0).uncheck();
  await expect(tray).toContainText("3 of 4 chosen");
  await boxes.nth(0).check();
  expect((await requestLog(page)).seats).toBe(sent);

  // The refusal's live region is in the accessibility tree before anything is said in it (hidden only visually).
  const status = tray.getByRole("status");
  await expect(status).toHaveText("");
  expect(await status.evaluate((el) => getComputedStyle(el).display)).not.toBe("none");

  // This search has four; the fifth comes from a newer search, and is refused there: from the list, a calendar day
  // and a matrix cell alike, and again each time.
  await searchByText(page, SEARCH_TEXT);
  sent = (await requestLog(page)).seats;
  await boxes.nth(0).click();
  await expect(boxes.nth(0)).not.toBeChecked();
  await expect(status).toHaveText("You can compare up to 4 options.");
  await expect(tray).toContainText("4 of 4 chosen");
  await boxes.nth(1).click();
  await expect(boxes.nth(1)).not.toBeChecked();
  await expect(status).toHaveText("You can compare up to 4 options.");

  await view.getByText("Calendar", { exact: true }).click();
  await page.getByTestId("calendar-view").locator('[data-date="2026-10-18"]').click();
  const dayBox = page.getByTestId("calendar-day-list").getByRole("checkbox").first();
  await dayBox.click();
  await expect(dayBox).not.toBeChecked();
  await expect(status).toHaveText("You can compare up to 4 options.");

  await view.getByText("Matrix", { exact: true }).click();
  await page.getByRole("gridcell", { name: /^HKG → SEA, Sun, Oct 18:/ }).focus();
  await page.keyboard.press("Enter");
  const cellBox = page.getByTestId("matrix-cell-list").getByRole("checkbox").first();
  await cellBox.click();
  await expect(cellBox).not.toBeChecked();
  await expect(status).toHaveText("You can compare up to 4 options.");
  await expect(tray).toContainText("4 of 4 chosen");
  expect((await requestLog(page)).seats).toBe(sent);
  expect((await requestLog(page)).anthropic).toBe(0);
});

test("a phone compares two at a time, with a labelled picker for the others; swapping, one by one, and nothing sent", async ({ page }) => {
  const sent = await searched(page);
  await choose(page, 4);
  await page.getByRole("link", { name: "Compare selected options" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compare selected options" })).toBeFocused();
  await expect(page.locator(".ag-compare-count")).toHaveText("4 of 4");

  const table = page.locator(".ag-compare-table");
  await expect(table.locator("thead th")).toHaveCount(2);
  // Columns 173 wide, 12 apart, inside the 16 pt gutters.
  const [a, b] = await Promise.all([table.locator("thead th").nth(0).boundingBox(), table.locator("thead th").nth(1).boundingBox()]);
  expect(Math.round(a!.width)).toBe(173);
  expect(Math.round(b!.x - (a!.x + a!.width))).toBe(12);
  expect(Math.round(a!.x)).toBe(16);

  // The fields, in the fixed order.
  await expect(table.locator("tbody th")).toHaveText(["Route and date", "Cabin", "Program", "Miles", "Fees", "Itineraries", "Seats", "Source time", "Program website"]);
  // Each value is announced with its option and its field.
  await expect(table.locator("tbody td[headers]").first()).toHaveAttribute("headers", "compare-col-0 compare-field-route_date");
  // A column's header names the option and nothing else: its Remove button is in a row of its own.
  await expect(table.locator("thead button")).toHaveCount(0);

  const first = page.getByLabel("Column 1 shows");
  const second = page.getByLabel("Column 2 shows");
  for (const picker of [first, second]) expect((await picker.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const options = await second.locator("option").allTextContents();
  expect(options).toHaveLength(4);
  const headBefore = await table.locator("thead th").nth(1).textContent();
  await second.selectOption({ index: 3 });
  await expect(table.locator("thead th").nth(1)).not.toHaveText(headBefore!);
  // Choosing in one column what the other shows swaps them.
  const col1 = await first.inputValue();
  const col2 = await second.inputValue();
  await first.selectOption(col2);
  await expect(first).toHaveValue(col2);
  await expect(second).toHaveValue(col1);

  await page.getByRole("button", { name: "Read one by one" }).click();
  const cards = page.locator(".ag-compare-card");
  await expect(cards).toHaveCount(4);
  // The button pressed is replaced by the one that switches back, which takes focus.
  await expect(page.getByRole("button", { name: "Side by side" })).toBeFocused();
  await expect(cards.first().locator("dt")).toHaveText(["Route and date", "Cabin", "Program", "Miles", "Fees", "Itineraries", "Seats", "Source time", "Program website"]);
  await page.getByRole("button", { name: "Side by side" }).click();
  await expect(table.locator("thead th")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Read one by one" })).toBeFocused();

  // No ranking, score or total anywhere on the page; itineraries are not loaded by looking.
  const text = (await page.locator(".ag-compare").textContent()) ?? "";
  expect(text).not.toMatch(/\b(best|cheapest|better|score|value for|CPP|cents per point|total cost|recommended)\b/i);
  await expect(page.getByText("Comparing sends nothing: every figure is from the searches on this device.")).toBeVisible();
  expect(await requestLog(page)).toMatchObject({ seats: sent, trips: 0, anthropic: 0 });
});

test("removing from the comparison; under two it says so; Back and Esc return to the results with focus on Compare", async ({ page }) => {
  await searched(page);
  await choose(page, 3);
  await page.getByRole("link", { name: "Compare selected options" }).click();
  await expect(page.locator(".ag-compare-count")).toHaveText("3 of 4");
  await page.getByRole("button", { name: /^Remove from comparison: / }).first().click();
  await expect(page.locator(".ag-compare-count")).toHaveText("2 of 4");
  // The button pressed is gone with its option: the removal is said, and focus is on the page title.
  await expect(page.locator(".ag-compare-body").getByRole("status")).toHaveText("Removed. 2 of 4 chosen.");
  await expect(page.getByRole("heading", { level: 1, name: "Compare selected options" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#compare-open")).toBeFocused();
  await expect(page.getByTestId("compare-tray")).toContainText("2 of 4 chosen");
  // Two checked in the list, matching the comparison.
  await expect(page.getByTestId("availability-list").getByRole("checkbox", { checked: true })).toHaveCount(2);

  await page.getByRole("link", { name: "Compare selected options" }).click();
  await page.getByRole("button", { name: /^Remove from comparison: / }).first().click();
  await expect(page.locator(".ag-compare-empty").getByText("Choose at least two options to compare.")).toBeVisible();
  await page.locator(".ag-compare-empty").getByRole("button", { name: "Back to results" }).click();
  await expect(page.locator("#compare-open")).toBeFocused();
  await expect(page.locator("#compare-open")).toHaveAttribute("aria-disabled", "true");

  // Nothing chosen any more: Back lands on the results' title (there is no bar to return to).
  await page.getByTestId("availability-list").getByRole("checkbox").first().check();
  await page.getByRole("link", { name: "Compare selected options" }).click();
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: /^Remove from comparison: / }).first().click();
  await expect(page.locator(".ag-compare-count")).toHaveText("0 of 4");
  await page.locator(".ag-compare-empty").getByRole("button", { name: "Back to results" }).click();
  await expect(page.getByTestId("compare-tray")).toHaveCount(0);
  await expect(page.locator("#search-title")).toBeFocused();
  await page.getByTestId("availability-list").getByRole("checkbox").first().check();

  // Clearing takes the bar away, and focus goes to the results' title.
  await page.getByTestId("compare-tray").getByRole("button", { name: "Clear" }).click();
  await expect(page.getByTestId("compare-tray")).toHaveCount(0);
  await expect(page.locator("#search-title")).toBeFocused();
});

test("a newer search keeps what was chosen from the older one, as it was; the same row in the new results is another option", async ({ page }) => {
  await searched(page);
  await choose(page, 2);
  const boxes = page.getByTestId("availability-list").getByRole("checkbox");
  await searchByText(page, SEARCH_TEXT);
  // The new snapshot's rows are not the chosen ones: nothing is quietly moved over.
  await expect(boxes.nth(0)).not.toBeChecked();
  await expect(page.getByTestId("compare-tray")).toContainText("2 of 4 chosen");
  await boxes.nth(0).check();
  await expect(page.getByTestId("compare-tray")).toContainText("3 of 4 chosen");
  await page.getByRole("link", { name: "Compare selected options" }).click();
  // Numbered in the order chosen, and each says which search it came from: the same row twice is never two
  // identical options.
  await expect(page.getByLabel("Column 1 shows")).toBeVisible();
  const pickerTexts = await page.getByLabel("Column 1 shows").locator("option").allTextContents();
  expect(new Set(pickerTexts).size).toBe(3);
  expect(pickerTexts.map((t) => t.slice(0, 2))).toEqual(["1.", "2.", "3."]);
  const removeNames = await page.getByRole("button", { name: /^Remove from comparison: / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect(new Set(removeNames).size).toBe(removeNames.length);
  await expect(page.locator(".ag-compare-table thead th").first()).toContainText("From the search of");
  await page.getByRole("button", { name: "Read one by one" }).click();
  await expect(page.locator(".ag-compare-card")).toHaveCount(3);
  await expect(page.locator(".ag-compare-card h2")).toHaveText([/^Option 1/, /^Option 2/, /^Option 3/]);
});

test("two programs, two currencies: said not to be ranked or converted, and nothing on the page scores them", async ({ page }) => {
  await openScenario(page, "multi-program", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  const cards = page.getByTestId("availability-list").getByTestId("availability-card");
  await expect(cards).toHaveCount(3);
  await choose(page, 3);
  await page.getByRole("link", { name: "Compare selected options" }).click();
  await expect(page.getByText("Miles from different programs are not worth the same, so options are not ranked or scored.")).toBeVisible();
  // Two of the three fees are unknown here: said as such, never as zero (the currency note is unit-tested: one known
  // currency here).
  await expect(page.getByText("Fees are not confirmed for 2 options.")).toBeVisible();
  // Apart from that note saying so, nothing on the page ranks, scores or totals.
  const note = "Miles from different programs are not worth the same, so options are not ranked or scored.";
  const text = ((await page.locator(".ag-compare").textContent()) ?? "").replace(note, "");
  expect(text).not.toMatch(/\b(best|cheapest|better|score[ds]?|ranked|value for|CPP|cents per point|total cost|recommended|worth it)\b/i);
  expect((await requestLog(page)).anthropic).toBe(0);
});

test("the bar sits above the tab bar, never over the results; returning from the comparison keeps the scroll and the calendar day", async ({ page }) => {
  await searched(page);
  await choose(page, 2);
  const tray = page.getByTestId("compare-tray");
  const tabs = page.getByRole("navigation", { name: "Main navigation" });
  const [bar, nav] = await Promise.all([tray.boundingBox(), tabs.boundingBox()]);
  expect(Math.abs(bar!.y + bar!.height - nav!.y)).toBeLessThanOrEqual(1);
  // The last control of the results, reached by keyboard, is above the bar, not under it.
  const main = page.locator(".app-main");
  expect((await main.boundingBox())!.y + (await main.boundingBox())!.height).toBeLessThanOrEqual(bar!.y + 1);
  const ask = page.getByRole("link", { name: "Ask Claude about this search" });
  await ask.focus();
  const askBox = (await ask.boundingBox())!;
  expect(askBox.y + askBox.height).toBeLessThanOrEqual(bar!.y + 0.5);

  // The calendar on a chosen day, the page scrolled: the comparison opens over it and closes back onto it.
  await page.getByTestId("results-view").getByText("Calendar", { exact: true }).click();
  await page.getByTestId("calendar-view").locator('[data-date="2026-10-19"]').click();
  await expect(page.getByTestId("calendar-day-list")).toBeVisible();
  await main.evaluate((el) => el.scrollTo(0, 200));
  const scrolled = await main.evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Compare selected options" }).click();
  await expect(page.getByRole("dialog", { name: "Compare selected options" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#compare-open")).toBeFocused();
  await expect(page.getByTestId("calendar-day-list")).toBeVisible();
  expect(await main.evaluate((el) => el.scrollTop)).toBe(scrolled);
});

test("320 wide, or 200% text: one option at a time, and nothing runs off the side", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await searched(page);
  await choose(page, 3);
  await page.getByRole("link", { name: "Compare selected options" }).click();
  await expect(page.locator(".ag-compare-card")).toHaveCount(3);
  await expect(page.locator(".ag-compare-table")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Side by side" })).toHaveCount(0);
  expect(await page.locator(".ag-compare-body").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ content: ":root { --ag-text-scale: 2; }" });
  await expect(page.locator(".ag-compare-card")).toHaveCount(3);
  expect(await page.locator(".ag-compare-body").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("a wide screen shows all four side by side, 220 or more each; a narrower one scrolls sideways rather than squeezing", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await searched(page);
  await choose(page, 4);
  await page.getByRole("link", { name: "Compare selected options" }).click();
  const heads = page.locator(".ag-compare-table thead th");
  await expect(heads).toHaveCount(4);
  await expect(page.getByLabel("Column 1 shows")).toHaveCount(0);
  for (const head of await heads.all()) expect((await head.boundingBox())!.width).toBeGreaterThanOrEqual(220);

  await page.setViewportSize({ width: 700, height: 768 });
  await expect(heads).toHaveCount(4);
  // Measured again after the resize (a ResizeObserver): wait for the layout to settle.
  await expect.poll(async () => Math.min(...(await Promise.all((await heads.all()).map(async (h) => (await h.boundingBox())!.width))))).toBeGreaterThanOrEqual(219.5);
  const scroller = page.locator(".ag-compare-scroll");
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  // Only the table scrolls; the page does not.
  expect(await page.locator(".ag-compare-body").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("in Chinese: the bar, the limit and the comparison speak Chinese", async ({ page }) => {
  await searched(page, "zh");
  await choose(page, 4);
  const tray = page.getByTestId("compare-tray");
  await expect(tray).toContainText("已选 4/4");
  await searchByText(page, SEARCH_TEXT);
  await page.getByTestId("availability-list").getByRole("checkbox").nth(0).click();
  await expect(tray.getByRole("status")).toHaveText("最多比较4个选项。");
  await tray.getByRole("link", { name: "比较所选" }).click();
  await expect(page.locator(".ag-compare-count")).toHaveText("4/4 项");
  await expect(page.locator(".ag-compare-table tbody th").first()).toHaveText("航线与日期");
  await expect(page.getByLabel("第 1 列显示")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: the comparison at 390`, async ({ page }) => {
    await openScenario(page, "complete", "ios", { theme, lang: "zh" });
    await searchByText(page, SEARCH_TEXT);
    await choose(page, 3);
    await evidenceShot(page, `t12-tray-${theme}`);
    await page.getByRole("link", { name: "比较所选" }).click();
    await expect(page.locator(".ag-compare-table")).toBeVisible();
    await evidenceShot(page, `t12-compare-${theme}`);
    // The page scrolls inside its own body: the rest of the fields.
    await page.locator(".ag-compare-body").evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await evidenceShot(page, `t12-compare-end-${theme}`);
    await page.getByRole("button", { name: "逐项阅读" }).click();
    // The switch lands on "并排比较", at the top of the reading.
    await expect(page.getByRole("button", { name: "并排比较" })).toBeFocused();
    expect(await page.locator(".ag-compare-body").evaluate((el) => el.scrollTop)).toBe(0);
    await expect(page.getByRole("button", { name: "并排比较" })).toBeInViewport();
    await evidenceShot(page, `t12-compare-one-by-one-${theme}`);
  });
}
