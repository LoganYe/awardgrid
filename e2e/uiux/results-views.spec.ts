/**
 * T08 — one projection for List, Calendar and Matrix (plan 02 T08; acceptance A13, A14).
 *
 * The views read the same shown snapshot through core projection.ts. Switching view, sort or calendar cabin is local:
 * nothing is sent, and the selection stays. A calendar number opens to the rows behind it. Geometry follows docs/04
 * S03 at 390: day cells at least 64 tall, 4 apart, (358 − 24) / 7 ≈ 47.7 wide; narrower than 44 per column (320, or
 * larger text) the days become a list.
 */
import type { Page } from "@playwright/test";
import { evidenceShot, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";

const view = (page: Page, name: string) => page.getByTestId("results-view").getByRole("radio", { name, exact: true });
const calendar = (page: Page) => page.getByTestId("calendar-view");
const day = (page: Page, date: string) => calendar(page).locator(`[data-date="${date}"]`);
const sortPicker = (page: Page) => page.getByTestId("results-view").getByRole("combobox", { name: "Sort" });

/**
 * Give the saved workspace a local view filter — as a later version, or the Web workspace, may have saved one; iOS
 * has no filter control yet (U-032) — then relaunch onto it.
 */
async function relaunchWithViewFilter(page: Page, id: string, filter: { maxMiles?: number; onlyKnownSeats?: boolean }) {
  await page.evaluate((localFilter) => {
    const slots = Object.keys(localStorage)
      .filter((k) => k.startsWith("uiux-fixture:files:") && /workspace-v1\.[ab]\.json$/.test(k))
      .map((k) => ({ k, content: JSON.parse(localStorage.getItem(k)!) as { generation: number; value: { preferences: object } } }))
      .sort((a, b) => b.content.generation - a.content.generation);
    const newest = slots[0];
    if (!newest) throw new Error("no saved workspace to give a filter");
    // Into the other slot with the next generation, as a save would: the host re-seeds the scenario's own slot.
    const other = newest.k.endsWith(".a.json") ? newest.k.replace(/\.a\.json$/, ".b.json") : newest.k.replace(/\.b\.json$/, ".a.json");
    const value = { ...newest.content.value, preferences: { ...newest.content.value.preferences, localFilter } };
    localStorage.setItem(other, JSON.stringify({ generation: newest.content.generation + 1, value }));
  }, filter);
  await openScenario(page, id, "ios", { lang: "en", preserveStorage: true });
}

/** The app's own background save (App.tsx: visibilitychange → hidden), as iOS triggers it. */
async function sendToBackground(page: Page) {
  const before = (await requestLog(page)).writes;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => (await requestLog(page)).writes).toBeGreaterThan(before);
}

test("view, sort and calendar choices send nothing and keep the selection", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  const list = page.getByTestId("availability-list");
  const first = list.getByTestId("availability-card").first();
  const key = await first.getAttribute("data-row-key");
  await first.getByRole("checkbox").check();

  await view(page, "Calendar").click();
  await expect(calendar(page)).toBeVisible();
  await day(page, "2026-10-18").click();
  const dayCard = page.getByTestId("calendar-day-list").locator(`[data-row-key="${key}"]`);
  await expect(dayCard.getByRole("checkbox")).toBeChecked();
  // Switching the calendar's cabin and back keeps the selection too.
  const cabins = calendar(page).getByRole("radiogroup", { name: "Calendar cabin" });
  await cabins.getByRole("radio", { name: "First F" }).click();
  await cabins.getByRole("radio", { name: "Business J" }).click();
  await day(page, "2026-10-18").click();
  await expect(dayCard.getByRole("checkbox")).toBeChecked();

  // The Matrix reads the same rows: Oct 18's Business cell is the list's 75,000.
  await view(page, "Matrix").click();
  await expect(page.getByTestId("matrix-view").locator("table.ag-grid")).toContainText("75,000");
  await expect(page.getByTestId("matrix-view").locator("table.ag-grid")).toContainText("82,000");

  await view(page, "List").click();
  await expect(list.locator(`[data-row-key="${key}"]`).getByRole("checkbox")).toBeChecked();

  // Fees, lowest first: the explicit zero first; "not yet confirmed" last, never as the cheapest.
  await sortPicker(page).selectOption("fees_asc");
  await expect(page.getByTestId("results-view").locator(".ag-results-sort-text")).toHaveText("Lowest fees");
  await expect(sortPicker(page)).toHaveValue("fees_asc");
  await expect(list.getByTestId("availability-card").first()).toContainText("USD 0.00");
  await expect(list.getByTestId("availability-card").last()).toContainText("Fees not yet confirmed");
  await expect(list.locator(`[data-row-key="${key}"]`).getByRole("checkbox")).toBeChecked();

  const log = await requestLog(page);
  expect(log.seats).toBe(0);
  expect(log.anthropic).toBe(0);
  expect(log.trips).toBe(0);
});

test("a calendar number opens to the rows behind it, for the cabin it names", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  await expect(page.getByTestId("availability-list")).toBeVisible();
  const sent = await requestLog(page);

  await view(page, "Calendar").click();
  await expect(calendar(page)).toContainText("Lowest miles by date · Business J");
  const cabins = calendar(page).getByRole("radiogroup", { name: "Calendar cabin" });
  await expect(cabins.getByRole("radio")).toHaveText(["Business J", "First F"]);

  // Business: Oct 18 shows 75K; opened, its rows are Business rows on Oct 18, and the lowest is 75,000.
  await expect(day(page, "2026-10-18")).toContainText("75K");
  await expect(day(page, "2026-10-18")).toHaveAccessibleName("Sun, Oct 18: lowest 75,000 miles, 1 option");
  await day(page, "2026-10-18").click();
  const dayList = page.getByTestId("calendar-day-list");
  await expect(page.getByRole("heading", { name: "Sun, Oct 18 · Business J · 1 option" })).toBeVisible();
  await expect(dayList.getByTestId("availability-card")).toHaveCount(1);
  await expect(dayList.getByTestId("card-miles")).toHaveText("75,000 miles");

  // First: the same day shows First's own number; a day with only Business is empty for First.
  await cabins.getByRole("radio", { name: "First F" }).click();
  await expect(calendar(page)).toContainText("Lowest miles by date · First F");
  await expect(day(page, "2026-10-18")).toContainText("110K");
  await expect(day(page, "2026-10-19").getByRole("button")).toHaveCount(0);
  await expect(day(page, "2026-10-19")).toHaveAttribute("data-coverage", "complete");
  await day(page, "2026-10-18").click();
  await expect(dayList.getByTestId("card-miles")).toHaveText("110,000 miles");
  await expect(calendar(page).locator(".ag-cal-legend")).toContainText("– no matches");

  const after = await requestLog(page);
  expect(after.seats).toBe(sent.seats);
  expect(after.anthropic).toBe(0);
});

test("partial or unknown coverage: the lowest retrieved, and an empty day is not 'no matches'", async ({ page }) => {
  await openScenario(page, "partial", "ios", { lang: "en" });
  await view(page, "Calendar").click();
  await expect(calendar(page)).toContainText("Lowest among the results retrieved");
  // Partial and unknown have their own marks: "…" not checked to the end, "?" coverage unknown.
  const empty = calendar(page).locator('.ag-cal-empty[data-coverage="partial"]').first();
  await expect(empty).toContainText("…");
  await expect(calendar(page).locator(".ag-cal-legend")).toContainText("… not checked to the end");
  await expect(calendar(page).locator('.ag-cal-empty[data-coverage="complete"]')).toHaveCount(0);

  await openScenario(page, "coverage-unknown", "ios", { lang: "zh" });
  await view(page, "日历").click();
  await expect(calendar(page)).toContainText("已取得结果中的最低值");
  await expect(calendar(page).locator(".ag-cal-legend")).toContainText("? 完整性未知");
  expect((await requestLog(page)).seats).toBe(0);
});

test("390: day cells 64 tall, 4 apart, ≈47.7 wide, lined up with the 16 pt gutters", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  await view(page, "Calendar").click();
  await expect(calendar(page)).toHaveAttribute("data-layout", "grid");
  const week = calendar(page).locator("tbody tr").nth(2).locator("td");
  const boxes = [];
  for (let i = 0; i < 7; i++) boxes.push((await week.nth(i).locator(".ag-cal-day").boundingBox())!);
  expect(Math.round(boxes[0]!.x)).toBe(16);
  expect(Math.round(boxes[6]!.x + boxes[6]!.width)).toBe(374);
  for (const b of boxes) {
    expect(b.width).toBeCloseTo((358 - 24) / 7, 0);
    expect(b.height).toBeGreaterThanOrEqual(64);
  }
  expect(boxes[1]!.x - (boxes[0]!.x + boxes[0]!.width)).toBeCloseTo(4, 0);
  // Every number fits its cell — the ones shown, and the widest forms core's compactMiles can produce.
  for (const min of await calendar(page).locator(".ag-cal-min").all()) {
    expect(await min.evaluate((el) => el.scrollWidth <= el.parentElement!.clientWidth)).toBe(true);
  }
  const widest = await calendar(page)
    .locator(".ag-cal-min")
    .first()
    .evaluate((el) => ["68.5K", "99.9K", "888K", "1.3M", "8,888"].filter((text) => ((el.textContent = text), el.scrollWidth > el.parentElement!.clientWidth)));
  expect(widest).toEqual([]);
});

test("the view row: one 44 line at 390 in both languages, whatever view and sort; at 320 in English the sort takes its own line, no word broken", async ({ page }) => {
  const segmentsOneLine = async () => {
    for (const segment of await page.getByTestId("results-view").getByRole("radio").all()) expect(Math.round((await segment.boundingBox())!.height)).toBe(44);
  };
  for (const lang of ["en", "zh"] as const) {
    await openScenario(page, "missing-values", "ios", { lang });
    const radios = page.getByTestId("results-view").getByRole("radio");
    for (let v = 0; v < 3; v++) {
      await radios.nth(v).click();
      for (const sort of ["miles_asc", "fees_asc", "seats_desc", "date_asc"]) {
        await page.getByTestId("results-view").locator("select").selectOption(sort);
        expect(Math.round((await page.getByTestId("results-view").boundingBox())!.height), `${lang} view ${v} ${sort}`).toBe(44);
        await segmentsOneLine();
      }
    }
  }
  await page.setViewportSize({ width: 320, height: 720 });
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  await segmentsOneLine();
  const sort = (await page.getByTestId("results-view").locator(".ag-results-sort").boundingBox())!;
  expect(Math.round(sort.x + sort.width)).toBe(320 - 16);
  expect(await page.evaluate(() => document.querySelector(".app-main")!.scrollWidth <= innerWidth)).toBe(true);
});

test("320 wide, or larger text: the days become a list with full numbers", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openScenario(page, "missing-values", "ios", { lang: "zh" });
  await view(page, "日历").click();
  await expect(calendar(page)).toHaveAttribute("data-layout", "list");
  await expect(calendar(page).locator("table")).toHaveCount(0);
  const rows = calendar(page).locator(".ag-cal-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("75,000");
  await expect(calendar(page)).toContainText("其余 28 天：已查询的范围内没有匹配结果。");
  expect(await page.evaluate(() => document.querySelector(".app-main")!.scrollWidth <= innerWidth)).toBe(true);

  // Larger text: a column narrower than 44 × the scale is a list. At 390 a column is 47.7, so 1.15 (50.6) is a list.
  for (const [width, scale, layout] of [
    [390, 1, "grid"],
    [390, 1.15, "list"],
    [430, 1.3, "list"],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await openScenario(page, "missing-values", "ios", { lang: "en" });
    await page.addStyleTag({ content: `:root { --ag-text-scale: ${scale}; }` });
    await view(page, "Calendar").click();
    await expect(calendar(page), `${width} × ${scale}`).toHaveAttribute("data-layout", layout);
  }
});

test("in the date list a chosen day opens right under its own row", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  await view(page, "Calendar").click();
  const row = calendar(page).locator('.ag-cal-row[data-date="2026-10-18"]');
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  const panel = page.locator(`#${(await row.getAttribute("aria-controls"))!.replace(/:/g, "\\:")}`);
  // Inside the same list item, directly after the row.
  await expect(row.locator("xpath=following-sibling::section[1]")).toHaveAttribute("id", (await row.getAttribute("aria-controls"))!);
  await expect(panel.getByTestId("card-miles")).toHaveText("75,000 miles");
  const card = (await panel.getByTestId("availability-card").boundingBox())!;
  const rowBox = (await row.boundingBox())!;
  expect(card.y - (rowBox.y + rowBox.height)).toBeLessThan(80);
  await evidenceShot(page, "t08-calendar-list-320", { fullPage: true });
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("calendar-day-list")).toHaveCount(0);
});

test("four cabins: the calendar's cabin switch sits two by two and never breaks a word", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  await page.getByTestId("query-summary").getByRole("link").click();
  await page.getByRole("button", { name: "Economy", exact: true }).click();
  await page.getByRole("button", { name: "Premium economy", exact: true }).click();
  await page.getByRole("button", { name: "Find award options" }).click();
  await expect(page.locator(".ag-results[data-run]")).toHaveAttribute("data-run", "finished");
  await view(page, "Calendar").click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const radios = calendar(page).getByRole("radiogroup", { name: "Calendar cabin" }).getByRole("radio");
    await expect(radios).toHaveCount(4);
    // Every word of every label on one line: a word split across lines has more than one box.
    const split = await radios.evaluateAll((els) =>
      els.flatMap((el) => {
        const text = el.querySelector(".ag-segment-label")!.firstChild!;
        const words: string[] = [];
        const re = /\S+/g;
        for (let m = re.exec(text.textContent!); m; m = re.exec(text.textContent!)) {
          const range = document.createRange();
          range.setStart(text, m.index);
          range.setEnd(text, m.index + m[0].length);
          if (range.getClientRects().length > 1) words.push(m[0]);
        }
        return words;
      }),
    );
    expect(split, `${width}`).toEqual([]);
  }
});

test("the month arrows keep focus at the range's end, and say they can go no further", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, "HKG to SEA, 2026-10-01 to 2026-11-20, business and first, on Air Canada Aeroplan");
  await view(page, "Calendar").click();
  await expect(calendar(page).getByRole("heading", { name: "October 2026" })).toBeVisible();
  const previous = calendar(page).getByRole("button", { name: "Previous month" });
  const next = calendar(page).getByRole("button", { name: "Next month" });
  await expect(previous).toHaveAttribute("aria-disabled", "true");
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(calendar(page).getByRole("heading", { name: "November 2026" })).toBeVisible();
  await expect(next).toHaveAttribute("aria-disabled", "true");
  await expect(next).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(calendar(page).getByRole("heading", { name: "November 2026" })).toBeVisible();
  await expect(previous).not.toHaveAttribute("aria-disabled", "true");
});

test("a saved view filter: every view says what it hides, never 'no matches'; Show all brings it back, keeps the selection, sends nothing", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  await relaunchWithViewFilter(page, "missing-values", { maxMiles: 80000 });
  const list = page.getByTestId("availability-list");
  await expect(list.getByTestId("availability-card")).toHaveCount(1);
  await expect(page.getByText("1 option is hidden by your view filter.")).toBeVisible();
  await expect(page.getByTestId("results-status")).toContainText("1 option");
  await list.getByRole("checkbox").check();

  await view(page, "Calendar").click();
  const oct20 = day(page, "2026-10-20");
  await expect(oct20).toHaveAttribute("data-empty", "hidden");
  await expect(oct20).toContainText("∗");
  await expect(oct20).not.toContainText("no matches");
  await expect(calendar(page).locator(".ag-cal-legend")).toContainText("∗ hidden by your view filter");

  await view(page, "Matrix").click();
  await expect(page.getByTestId("matrix-view")).toContainText("The matrix cannot apply a view filter yet.");
  await expect(page.getByTestId("matrix-view").locator("table")).toHaveCount(0);

  await view(page, "List").click();
  await page.getByRole("button", { name: "Show all" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("results-status")).toBeFocused();
  await expect(page.getByTestId("results-status")).toContainText("2 options");
  await expect(page.getByRole("status").filter({ hasText: "Showing all 2 options." })).toHaveCount(1);
  await expect(list.getByTestId("availability-card")).toHaveCount(2);
  await expect(list.getByRole("checkbox").first()).toBeChecked();
  const log = await requestLog(page);
  expect([log.seats, log.anthropic, log.trips]).toEqual([0, 0, 0]);
});

test("under the fee sort the matrix picks cells by miles, and says so", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  await sortPicker(page).selectOption("fees_asc");
  await view(page, "Matrix").click();
  await expect(page.getByTestId("matrix-view")).toContainText("Matrix cells show the lowest miles; fees are sorted only in the list.");
  await expect(page.getByTestId("matrix-view").locator("table.ag-grid")).toBeVisible();
});

test("the chosen view and sort are kept on this device: a relaunch opens them without a request", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  await view(page, "Calendar").click();
  await sortPicker(page).selectOption("date_asc");
  await sendToBackground(page);
  await openScenario(page, "missing-values", "ios", { lang: "en", preserveStorage: true });
  await expect(calendar(page)).toBeVisible();
  await expect(sortPicker(page)).toHaveValue("date_asc");
  expect((await requestLog(page)).seats).toBe(0);
});

test("a search from the editor keeps the sort chosen for the results", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  await sortPicker(page).selectOption("seats_desc");
  await page.getByTestId("query-summary").getByRole("link").click();
  await page.getByRole("button", { name: "First", exact: true }).click();
  await page.getByRole("button", { name: "Find award options" }).click();
  await expect(page.locator(".ag-results[data-run]")).toHaveAttribute("data-run", "finished");
  await expect(page.getByTestId("query-summary")).not.toContainText("First");
  await expect(sortPicker(page)).toHaveValue("seats_desc");
  await expect(page.getByTestId("results-view").locator(".ag-results-sort-text")).toHaveText("Most seats");
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: the calendar at 390`, async ({ page }) => {
    await openScenario(page, "missing-values", "ios", { theme, lang: "zh" });
    await view(page, "日历").click();
    await day(page, "2026-10-18").click();
    await expect(page.getByTestId("calendar-day-list")).toBeVisible();
    await evidenceShot(page, `t08-calendar-${theme}`, { fullPage: true });
  });
}
