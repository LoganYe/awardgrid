/**
 * T09 — the pro matrix: whole columns, one slot per cabin, a keyboard grid (plan 02 T09; acceptance A15, A16).
 *
 * The matrix reads the T08 projection's cells: rows are the search's dates, columns its routes, and each cell holds
 * one slot per cabin asked for, in cabin order. Geometry follows docs/04 S03 at 390: date column 88, whole data
 * columns of (358 − 88) / 2 = 135, header 44, a J/F row at least 88; scrolling settles on whole columns. Keyboard
 * follows the APG data grid: one tab stop, arrows, Home/End, Ctrl/Cmd+Home/End, Enter opens a cell's options, Esc
 * returns to the cell.
 *
 * Adapted from the plan's Step 1: "complete" starts with no results here, so a search comes first; the view switch
 * is a radio group (T04 SegmentedControl), not tabs.
 */
import type { Page } from "@playwright/test";
import { evidenceShot, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";
/** Three routes: HKG → SEA has the synthetic rows; PVG and NRT are not in the synthetic routes catalog. */
const THREE_ROUTES = "HKG, PVG, NRT to SEA, 2026-10-01 to 2026-10-30, business and first, on Air Canada Aeroplan";
/** The same, with the priced route in the middle column, so it is on screen before and after a sideways scroll. */
const PRICED_MIDDLE = "PVG, HKG, NRT to SEA, 2026-10-01 to 2026-10-30, business and first, on Air Canada Aeroplan";

/** Every miles figure wholly inside the visible data area (right of the dates, left of the edge); how many it checked. */
async function uncroppedFigures(page: Page): Promise<number> {
  const scroller = page.getByTestId("matrix-view").locator(".ag-mx-scroll");
  const box = (await scroller.boundingBox())!;
  const date = (await page.getByRole("columnheader").first().boundingBox())!.width;
  let checked = 0;
  for (const m of await page.getByTestId("matrix-view").locator(".ag-mx-miles").all()) {
    const b = await m.boundingBox();
    if (!b || b.y + b.height <= box.y || b.y >= box.y + box.height) continue; // scrolled out vertically
    if (b.x + b.width <= box.x + date || b.x >= box.x + box.width) continue; // under the dates, or past the edge
    expect(b.x, "a miles figure starts under the date column").toBeGreaterThanOrEqual(box.x + date - 0.5);
    expect(b.x + b.width, "a miles figure runs past the right edge").toBeLessThanOrEqual(box.x + box.width + 0.5);
    checked += 1;
  }
  return checked;
}

/** No cell's content spills out of its column. */
async function noCellOverflows(page: Page) {
  const over = await page
    .getByRole("gridcell")
    .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.getAttribute("aria-label")));
  expect(over).toEqual([]);
}

async function openMatrix(page: Page, name = "Matrix") {
  await page.getByTestId("results-view").getByRole("radio", { name, exact: true }).click();
  await expect(page.getByRole("grid")).toBeVisible();
}

const focusedCell = (page: Page) => page.getByRole("grid").locator("[role=gridcell]:focus");
const at = async (page: Page) => {
  const cell = focusedCell(page);
  return [Number(await cell.getAttribute("aria-colindex")), Number(await cell.locator("xpath=..").getAttribute("aria-rowindex"))];
};

test("keyboard navigation stays within one grid without refetch", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "zh" });
  await searchByText(page, SEARCH_TEXT);
  await openMatrix(page, "矩阵");
  const grid = page.getByRole("grid");
  await grid.focus();
  await page.keyboard.press("ArrowRight");
  const before = await requestLog(page);
  await expect(grid.locator("[role=gridcell]:focus")).toHaveCount(1);
  await page.keyboard.press("Home");
  await expect(grid.locator("[role=gridcell]:focus")).toHaveCount(1);
  expect((await requestLog(page)).seats).toBe(before.seats);
});

test("one tab stop; arrows, Home/End and Ctrl+Home/End move by true row and column indices", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, THREE_ROUTES);
  await openMatrix(page);
  const grid = page.getByRole("grid");
  // Header row + 30 dates; date column + 3 routes.
  await expect(grid).toHaveAttribute("aria-rowcount", "31");
  await expect(grid).toHaveAttribute("aria-colcount", "4");
  expect(await grid.locator('[role=gridcell][tabindex="0"]').count()).toBe(1);

  await grid.locator('[role=gridcell][tabindex="0"]').focus();
  expect(await at(page)).toEqual([2, 2]);
  await page.keyboard.press("ArrowRight");
  expect(await at(page)).toEqual([3, 2]);
  await page.keyboard.press("ArrowDown");
  expect(await at(page)).toEqual([3, 3]);
  await page.keyboard.press("End");
  expect(await at(page)).toEqual([4, 3]);
  await page.keyboard.press("ArrowRight");
  expect(await at(page)).toEqual([4, 3]);
  await page.keyboard.press("Home");
  expect(await at(page)).toEqual([2, 3]);
  await page.keyboard.press("Control+End");
  expect(await at(page)).toEqual([4, 31]);
  await page.keyboard.press("Control+Home");
  expect(await at(page)).toEqual([2, 2]);
  // Still one tab stop, on the cell last focused; Tab leaves the grid.
  expect(await grid.locator('[role=gridcell][tabindex="0"]').count()).toBe(1);
  await page.keyboard.press("Tab");
  await expect(focusedCell(page)).toHaveCount(0);
  expect((await requestLog(page)).anthropic).toBe(0);
});

test("Enter opens the cell's options; Esc returns focus to the cell; nothing is sent", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  const sent = await requestLog(page);
  await openMatrix(page);
  const cell = page.getByRole("gridcell", { name: /^HKG → SEA, Sun, Oct 18:/ });
  await cell.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByTestId("matrix-cell-list");
  await expect(page.getByRole("heading", { name: /Sun, Oct 18 · HKG → SEA · 2 options/ })).toBeFocused();
  await expect(panel.getByTestId("card-miles")).toHaveText(["75,000 miles", "110,000 miles"]);
  await page.keyboard.press("Escape");
  await expect(cell).toBeFocused();
  const after = await requestLog(page);
  expect([after.seats, after.trips, after.anthropic]).toEqual([sent.seats, sent.trips, 0]);
});

test("each cell names its route, day and every cabin slot; empty slots say why, in words", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, THREE_ROUTES);
  await openMatrix(page);
  await expect(page.getByRole("gridcell", { name: "HKG → SEA, Sun, Oct 18: Business J lowest 75,000 miles, Air Canada Aeroplan, seat count not provided; First F lowest 110,000 miles, Air Canada Aeroplan, seat count not provided" })).toBeVisible();
  await expect(page.getByRole("gridcell", { name: "HKG → SEA, Mon, Oct 19: Business J lowest 68,000 miles, Air Canada Aeroplan, 2 seats; First F no matches" })).toBeVisible();
  // A route the source does not monitor: its words, not a bare dash.
  const pvg = page.getByRole("gridcell", { name: /^PVG → SEA, Sun, Oct 18: Business J not monitored; First F not monitored$/ });
  await expect(pvg).toContainText("Not monitored");
  // Slots in cabin order, each labelled.
  await expect(page.getByRole("gridcell", { name: /^HKG → SEA, Sun, Oct 18:/ }).locator(".ag-mx-cabin")).toHaveText(["J", "F"]);
  // Headers: dates and routes.
  await expect(page.getByRole("columnheader")).toHaveText(["Date", "HKG → SEA", "PVG → SEA", "NRT → SEA"]);
  await expect(page.getByRole("rowheader").first()).toContainText("Oct 1");
});

test("390: date 88, whole columns of 135, header 44, J/F rows at least 88; scrolling settles on whole columns, no cropped miles", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, PRICED_MIDDLE);
  await openMatrix(page);
  const scroller = page.getByTestId("matrix-view").locator(".ag-mx-scroll");
  const box = (await scroller.boundingBox())!;
  expect(Math.round(box.x)).toBe(16);
  expect(Math.round(box.width)).toBe(358);
  const headers = page.getByRole("columnheader");
  expect(Math.round((await headers.nth(0).boundingBox())!.width)).toBe(88);
  expect(Math.round((await headers.nth(1).boundingBox())!.width)).toBe(135);
  expect(Math.round((await headers.nth(0).boundingBox())!.height)).toBe(44);
  for (const row of (await page.getByRole("row").all()).slice(1, 4)) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(88);

  // Bring the days with prices into the grid's view, then check the figures at rest and after a sideways scroll.
  await page.getByRole("gridcell", { name: /^HKG → SEA, Sun, Oct 18:/ }).focus();
  expect(await uncroppedFigures(page)).toBeGreaterThan(0);
  await noCellOverflows(page);
  // A scroll that stops mid-column settles on the nearest whole one: 100 of 135 settles on the next column; a
  // further 40 settles back on it. HKG → SEA is then the first whole column after the dates.
  await scroller.hover();
  await page.mouse.wheel(100, 0);
  await expect.poll(async () => scroller.evaluate((el) => el.scrollLeft)).toBe(135);
  await page.mouse.wheel(40, 0);
  await page.waitForTimeout(300);
  await expect.poll(async () => scroller.evaluate((el) => el.scrollLeft)).toBe(135);
  expect(await uncroppedFigures(page)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.querySelector(".app-main")!.scrollWidth <= innerWidth)).toBe(true);
});

test("a search with one route: its column fills the width", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  await openMatrix(page);
  expect(Math.round((await page.getByRole("columnheader").nth(1).boundingBox())!.width)).toBe(270);
  await noCellOverflows(page);
});

test("larger text: fewer, wider columns and a wider date column; nothing spills into the next column", async ({ page }) => {
  for (const [scale, date, width] of [
    [1.3, 114, 244],
    [2, 176, 182],
  ] as const) {
    await openScenario(page, "complete", "ios", { lang: "en" });
    await searchByText(page, PRICED_MIDDLE);
    await page.addStyleTag({ content: `:root { --ag-text-scale: ${scale}; }` });
    await openMatrix(page);
    const headers = page.getByRole("columnheader");
    expect(Math.round((await headers.nth(0).boundingBox())!.width), `${scale}`).toBe(date);
    expect(Math.round((await headers.nth(1).boundingBox())!.width), `${scale}`).toBe(width);
    await page.getByRole("gridcell", { name: /^HKG → SEA, Sun, Oct 18:/ }).focus();
    await noCellOverflows(page);
    expect(await uncroppedFigures(page)).toBeGreaterThan(0);
  }
});

test("a tap on a date or a route header leaves the grid where it is", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, PRICED_MIDDLE);
  await openMatrix(page);
  const scroller = page.getByTestId("matrix-view").locator(".ag-mx-scroll");
  await scroller.evaluate((el) => {
    el.scrollTop = 900;
    el.scrollLeft = 135;
  });
  const before = await scroller.evaluate((el) => [el.scrollTop, el.scrollLeft]);
  const pageBefore = await page.evaluate(() => document.querySelector(".app-main")!.scrollTop);
  // Taps where the headers are on screen now (a locator click would scroll them into view first).
  const view = (await scroller.boundingBox())!;
  const header = (await page.getByRole("columnheader", { name: "NRT → SEA" }).boundingBox())!;
  await page.mouse.click(header.x + header.width / 2, header.y + header.height / 2);
  await page.mouse.click(view.x + 20, view.y + view.height / 2); // a date, in the sticky date column
  await page.waitForTimeout(200);
  expect(await scroller.evaluate((el) => [el.scrollTop, el.scrollLeft])).toEqual(before);
  expect(await page.evaluate(() => document.querySelector(".app-main")!.scrollTop)).toBe(pageBefore);
  await expect(focusedCell(page)).toHaveCount(0);
});

test("a new search keeps focus on the same cell, and the opened options close", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  await openMatrix(page);
  const cell = page.getByRole("gridcell", { name: /^HKG → SEA, Sun, Oct 18:/ });
  await cell.focus();
  const revision = await page.locator(".ag-results").getAttribute("data-revision");
  await page.evaluate(() => window.__uiuxFixture!.rerunShown!());
  await expect(page.locator(".ag-results")).not.toHaveAttribute("data-revision", revision!);
  await expect(page.locator(".ag-results")).toHaveAttribute("data-run", "finished");
  await expect(cell).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("matrix-cell-list")).toBeVisible();
  await page.evaluate(() => window.__uiuxFixture!.rerunShown!());
  await expect(page.getByTestId("matrix-cell-list")).toHaveCount(0);
  await expect(cell).toBeFocused();
});

test("the opened cell is framed, not only tinted; the query's mileage cap holds in every view", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  // Oct 18 holds two options (Business and First): a tap opens them below, and the cell is framed.
  await openMatrix(page);
  const oct18 = page.getByRole("gridcell", { name: /^HKG → SEA, Sun, Oct 18:/ });
  await oct18.click();
  await expect(oct18).toHaveAttribute("aria-expanded", "true");
  expect(await oct18.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");

  // A mileage cap of 80,000: the 82,000 and 110,000 options are outside this search.
  await page.getByTestId("results-view").getByRole("radio", { name: "List", exact: true }).click();
  await page.getByTestId("query-summary").getByRole("link").click();
  await page.getByLabel("Mileage cap").fill("80000");
  await page.getByRole("button", { name: "Find award options" }).click();
  await expect(page.locator(".ag-results[data-run]")).toHaveAttribute("data-run", "finished");
  await expect(page.getByTestId("availability-list").getByTestId("card-miles")).toHaveText(["68,000 miles", "75,000 miles"]);
  await openMatrix(page);
  await expect(page.getByRole("gridcell", { name: /^HKG → SEA, Sun, Oct 18:/ })).toHaveAccessibleName(/Business J lowest 75,000 miles.*; First F no matches$/);
  await expect(page.getByRole("grid")).not.toContainText("110,000");
  await expect(page.getByRole("grid")).not.toContainText("82,000");
});


test("320: one whole column of 200; the page never scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openScenario(page, "complete", "ios", { lang: "zh" });
  await searchByText(page, THREE_ROUTES);
  await openMatrix(page, "矩阵");
  expect(Math.round((await page.getByRole("columnheader").nth(1).boundingBox())!.width)).toBe(200);
  expect(await page.evaluate(() => document.querySelector(".app-main")!.scrollWidth <= innerWidth)).toBe(true);
});

test("a 92-day, three-route grid: true counts, Ctrl+End reaches the last cell, focus survives scrolling", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, "HKG, PVG, NRT to SEA, 2026-10-01 to 2026-12-31, business and first, on Air Canada Aeroplan");
  await openMatrix(page);
  const grid = page.getByRole("grid");
  await expect(grid).toHaveAttribute("aria-rowcount", "93");
  await grid.focus();
  await page.keyboard.press("Control+End");
  expect(await at(page)).toEqual([4, 93]);
  await expect(focusedCell(page)).toBeInViewport();
  await page.keyboard.press("Control+Home");
  expect(await at(page)).toEqual([2, 2]);
  await expect(focusedCell(page)).toBeInViewport();
  // Wholly on screen: not under the page's sticky header and summary (116), nor the grid's own header row (44),
  // nor past the top of the tab bar.
  await expectFocusedCellClear(page, ["Control+End", "Control+Home", "PageDown", "PageDown", "Control+End"]);
});

test("a long route summary makes the sticky block taller; the grid still keeps clear of it", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, "HKG, PVG, NRT, HND, ICN, TPE, BKK, SIN, KUL, MNL to SEA, LAX, SFO, YVR, 2026-10-01 to 2026-10-20, business and first, on Air Canada Aeroplan");
  await openMatrix(page);
  const sticky = (await page.locator(".ag-results-sticky").boundingBox())!;
  expect(sticky.height).toBeGreaterThan(116);
  await page.getByRole("grid").focus();
  await expectFocusedCellClear(page, ["Control+End", "Control+Home", "PageDown", "End"]);
});

/** After each key, the focused cell is wholly on screen: below the page's sticky block and the grid's header, above the tab bar. */
async function expectFocusedCellClear(page: Page, keys: string[]) {
  const tabs = (await page.getByRole("navigation", { name: "Main navigation" }).boundingBox())!;
  const sticky = (await page.locator(".ag-results-sticky").boundingBox())!;
  for (const key of keys) {
    await page.keyboard.press(key);
    const cell = (await focusedCell(page).boundingBox())!;
    const header = (await page.getByRole("columnheader").first().boundingBox())!;
    expect(header.y, `${key}: grid header under the page header`).toBeGreaterThanOrEqual(sticky.y + sticky.height - 1);
    expect(cell.y, `${key}: cell under the grid header`).toBeGreaterThanOrEqual(header.y + header.height - 1);
    expect(cell.y + cell.height, `${key}: cell under the tab bar`).toBeLessThanOrEqual(tabs.y + 1);
  }
}

test("the matrix keeps the selection and says it with a frame and a tick", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  const first = page.getByTestId("availability-list").getByTestId("availability-card").first();
  await first.getByRole("checkbox").check();
  await openMatrix(page);
  const slot = page.getByRole("gridcell", { name: /^HKG → SEA, Sun, Oct 18:/ }).locator(".ag-mx-slot").first();
  await expect(slot).toHaveAttribute("data-selected", "true");
  await expect(slot).toContainText("✓");
  expect((await requestLog(page)).seats).toBe(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: the matrix at 390`, async ({ page }) => {
    await openScenario(page, "complete", "ios", { theme, lang: "zh" });
    await searchByText(page, THREE_ROUTES);
    // One option selected, then the matrix brought to the days with results by keyboard.
    await page.getByTestId("availability-list").getByTestId("availability-card").first().getByRole("checkbox").check();
    await openMatrix(page, "矩阵");
    await page.getByRole("grid").focus();
    for (let i = 0; i < 17; i++) await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("gridcell", { name: /^HKG → SEA，10月18日/ })).toBeFocused();
    await evidenceShot(page, `t09-matrix-${theme}`);
  });
}
