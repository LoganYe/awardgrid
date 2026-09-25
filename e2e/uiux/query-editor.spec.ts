/**
 * T06 — the query editor (plan 02 T06; acceptance A10, A11).
 *
 * The editor is the real app's /edit page in the fixture host. Editing sends nothing — no seats.aero request, no
 * Anthropic request — until "Find award options", which runs the resolved query on the shared search path.
 */
import type { Page } from "@playwright/test";
import { evidenceShot, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";

async function searchFirst(page: Page) {
  await searchByText(page, SEARCH_TEXT);
  await expect(page.getByTestId("availability-list")).toBeVisible();
}

/** Open the editor the way the screen offers it: the query summary with results, "Build a search" without. */
async function openEditor(page: Page) {
  const summaryLink = page.getByTestId("query-summary").getByRole("link");
  if (await summaryLink.isVisible()) await summaryLink.click();
  else await page.getByRole("link", { name: "Build a search" }).click();
  // The summary's own name holds the conditions ("mixed cabin ≥ 75%"): wait for the editor before asking for a field.
  await expect(editor(page)).toBeVisible();
}

/** The shown search's second summary line: dates, cabins and conditions. */
const subline = (page: Page) => page.getByTestId("query-summary").locator(".ag-query-summary-sub").first();

/** Wait until the Search screen is no longer searching. */
async function settled(page: Page) {
  await expect(page.locator(".ag-results[data-run]")).toHaveAttribute("data-busy", "false");
  await expect(page.locator(".ag-results[data-run]")).not.toHaveAttribute("data-run", "running");
}

const editor = (page: Page) => page.getByRole("heading", { name: "Edit search", level: 1 });

async function pick(page: Page, field: "Departure airports" | "Arrival airports", typed: string, option: RegExp) {
  const input = page.getByRole("combobox", { name: `${field}: Add airport` });
  await input.fill(typed);
  await page.getByRole("listbox", { name: field }).getByRole("option", { name: option }).first().click();
}

test("from the results: Edit search, change a cabin, Find — three steps, no AI", async ({ page }) => {
  await openScenario(page, "complete");
  await searchFirst(page);
  const before = await requestLog(page);

  await openEditor(page); // 1
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "First", pressed: true }).click(); // 2
  // Nothing has been sent by opening the editor or changing a field.
  expect(await requestLog(page)).toMatchObject({ seats: before.seats, anthropic: before.anthropic });
  await page.getByRole("button", { name: "Find award options" }).click(); // 3

  // The new search is on screen: the text search read "October" on the scenario's clock (18 October) as 18–31
  // October, and the edit kept those days and dropped First.
  await settled(page);
  await expect(subline(page)).toHaveText("Oct 18 – 31 · Business");
  // Focus is back on the control that opened the editor.
  await expect(page.locator("#edit-search")).toBeFocused();
  // No Anthropic request. (This scenario has no Anthropic key, so the counter proves nothing was attempted through
  // the fixture transport; that the editor has no AI path at all rests on the code: evidence/T06-query-editor.md.)
  expect((await requestLog(page)).anthropic).toBe(0);
});

test("editing sends nothing: places, dates, cabins, switches, programs, and leaving with the prompt", async ({ page }) => {
  await openScenario(page, "complete");
  await openEditor(page);
  await expect(editor(page)).toBeVisible();

  await pick(page, "Departure airports", "tok", /Tokyo/);
  await expect(page.getByRole("button", { name: "Remove NRT Narita" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove HND Haneda" })).toBeVisible();
  await pick(page, "Arrival airports", "sea", /Seattle/);
  await page.getByRole("radio", { name: "Fixed dates" }).click();
  await page.getByLabel("Start").fill("2026-11-01");
  await page.getByLabel("End").fill("2026-11-20");
  await page.getByRole("button", { name: "Economy", exact: true }).click();
  await page.getByRole("switch", { name: "Nonstop only" }).click();
  await expect(page.getByRole("switch", { name: "Nonstop only" })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Mixed cabin", { exact: true }).selectOption("75");
  await page.getByRole("button", { name: /^Programs/ }).click();
  const sheet = page.getByRole("dialog", { name: "Programs" });
  await sheet.getByRole("button", { name: "Air Canada Aeroplan" }).click();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: /^Programs/ })).toContainText("1 selected");
  await page.getByRole("switch", { name: "Include dynamic-priced results" }).click();
  await page.getByLabel("Mileage cap").fill("80000");

  let log = await requestLog(page);
  expect(log.seats).toBe(0);
  expect(log.anthropic).toBe(0);

  // Leaving with changes asks first.
  await page.getByRole("button", { name: "Back" }).click();
  const confirm = page.getByRole("dialog", { name: "Discard your changes?" });
  await confirm.getByRole("button", { name: "Keep editing" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("dialog", { name: "Discard your changes?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(page.locator(".ag-results")).toBeVisible();
  log = await requestLog(page);
  expect(log.seats).toBe(0);
  expect(log.anthropic).toBe(0);
});

test("leaving without changes goes straight back, and focus comes and goes with the page", async ({ page }) => {
  await openScenario(page, "complete");
  await openEditor(page);
  await expect(editor(page)).toBeFocused();
  // The submit button is on screen when the page opens: the header and footer do not scroll away.
  const submit = await page.getByRole("button", { name: "Find award options" }).boundingBox();
  expect(submit!.y + submit!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#edit-search")).toBeFocused();
});

test("Esc is Back — with the prompt when there are changes — except when it closes the place list", async ({ page }) => {
  await openScenario(page, "complete");
  await openEditor(page);
  const input = page.getByRole("combobox", { name: "Departure airports: Add airport" });
  await input.fill("tok");
  await expect(page.getByRole("listbox", { name: "Departure airports" })).toBeVisible();
  await input.press("Escape");
  await expect(page.getByRole("listbox", { name: "Departure airports" })).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The typed text is a change: Esc now asks.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Discard your changes?" })).toBeVisible();
  // Esc inside the prompt closes the prompt, not the page.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor(page)).toBeVisible();
});

test("text typed in an airport box but never chosen stops the submit", async ({ page }) => {
  await openScenario(page, "complete");
  await searchFirst(page);
  await openEditor(page);
  const input = page.getByRole("combobox", { name: "Arrival airports: Add airport" });
  await input.fill("zzzz");
  await expect(page.getByText("No airport or city matches that.")).toBeVisible();
  await expect(input).toHaveAttribute("aria-expanded", "false");
  const seats = (await requestLog(page)).seats;
  await page.getByRole("button", { name: "Find award options" }).click();
  await expect(page.getByText("Choose an airport from the list, or clear this text.")).toBeVisible();
  await expect(input).toBeFocused();
  expect((await requestLog(page)).seats).toBe(seats);
});

test("a draft that cannot run: each error under its field, focus on the first, nothing sent", async ({ page }) => {
  await openScenario(page, "complete");
  await openEditor(page);
  await page.getByRole("button", { name: "Find award options" }).click();
  await expect(page.getByText("Add at least one departure airport.")).toBeVisible();
  await expect(page.getByText("Add at least one arrival airport.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Departure airports: Add airport" })).toBeFocused();

  await pick(page, "Departure airports", "HKG", /Hong Kong/);
  await pick(page, "Arrival airports", "SEA", /Seattle/);
  await expect(page.getByText("Add at least one departure airport.")).toHaveCount(0);

  // 93 days: over core's cap.
  await page.getByRole("radio", { name: "Fixed dates" }).click();
  await page.getByLabel("Start").fill("2026-10-01");
  await page.getByLabel("End").fill("2027-01-01");
  await page.getByRole("button", { name: "Find award options" }).click();
  await expect(page.getByText("The range is longer than 92 days. Shorten it or split the search.")).toBeVisible();
  await expect(page.getByLabel("Start")).toBeFocused();
  await expect(page.getByLabel("Start")).toHaveAttribute("aria-invalid", "true");

  // An End that is not a date at all.
  await page.getByLabel("End").fill("");
  await page.getByRole("button", { name: "Find award options" }).click();
  await expect(page.getByText("Enter a real calendar date.")).toBeVisible();
  await expect(page.getByLabel("Start")).toBeFocused();

  // End before start.
  await page.getByLabel("End").fill("2026-09-01");
  await page.getByRole("button", { name: "Find award options" }).click();
  await expect(page.getByText("The end date is before the start date.")).toBeVisible();

  // No cabin.
  await page.getByLabel("End").fill("2026-10-30");
  await page.getByRole("button", { name: "Business", pressed: true }).click();
  await page.getByRole("button", { name: "First", pressed: true }).click();
  await page.getByRole("button", { name: "Find award options" }).click();
  await expect(page.getByText("Choose at least one cabin.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Business", exact: true })).toBeFocused();

  // Relative days: 0 is refused; 30 shows exactly which days, on the scenario's clock (2026-10-18).
  await page.getByRole("radio", { name: "Next days" }).click();
  await page.getByLabel("Days from today").fill("0");
  await page.getByRole("button", { name: "Business", exact: true }).click();
  await page.getByRole("button", { name: "Find award options" }).click();
  await expect(page.getByText("Enter a number of days from 1 to 92.")).toBeVisible();
  await page.getByLabel("Days from today").fill("30");
  await expect(page.getByText("2026-10-18 to 2026-11-16, counted in UTC from today.")).toBeVisible();
  await page.getByRole("button", { name: "Next 60 days", exact: true }).click();
  await expect(page.getByText("2026-10-18 to 2026-12-16, counted in UTC from today.")).toBeVisible();
  // Back to fixed dates: the fixed range used before is restored, with its day count.
  await page.getByRole("radio", { name: "Fixed dates" }).click();
  await expect(page.getByLabel("Start")).toHaveValue("2026-10-01");
  await expect(page.getByText("30 days (up to 92).")).toBeVisible();

  const log = await requestLog(page);
  expect(log.seats).toBe(0);
  expect(log.anthropic).toBe(0);
});

test("a leap day runs: 29 February 2028 is a real date", async ({ page }) => {
  await openScenario(page, "complete");
  await openEditor(page);
  await pick(page, "Departure airports", "HKG", /Hong Kong/);
  await pick(page, "Arrival airports", "SEA", /Seattle/);
  await page.getByRole("radio", { name: "Fixed dates" }).click();
  await page.getByLabel("Start").fill("2028-02-29");
  await page.getByLabel("End").fill("2028-03-01");
  await page.getByRole("button", { name: "Find award options" }).click();
  await settled(page);
  await expect(subline(page)).toHaveText("Feb 29 – Mar 1 · Business, First");
  expect((await requestLog(page)).anthropic).toBe(0);
});

test("the place list works from the keyboard: arrows move, Enter picks, Esc closes", async ({ page }) => {
  await openScenario(page, "complete");
  await openEditor(page);
  const input = page.getByRole("combobox", { name: "Departure airports: Add airport" });
  await input.fill("tok");
  const list = page.getByRole("listbox", { name: "Departure airports" });
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  const optionBox = await list.getByRole("option").first().boundingBox();
  expect(optionBox!.height).toBeGreaterThanOrEqual(56);
  await input.press("ArrowDown");
  await expect(list.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: /^Remove (NRT|HND) / })).toHaveCount(1);
  await input.fill("sea");
  await expect(list).toBeVisible();
  await input.press("Escape");
  await expect(list).toBeHidden();
  await expect(editor(page)).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: the editor on a search`, async ({ page }) => {
    await openScenario(page, "complete", "ios", { theme });
    await searchFirst(page);
    await openEditor(page);
    await expect(editor(page)).toBeVisible();
    const submit = page.getByRole("button", { name: "Find award options" });
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await evidenceShot(page, `t06-query-editor-${theme}`, { fullPage: true });
  });
}

test.describe("where the UTC day is not the local day", () => {
  // 08:30Z on 18 October is 22:30 on 17 October in Honolulu: the rule counts in UTC, so it still starts on the 18th.
  test.use({ timezoneId: "Pacific/Honolulu" });
  test("relative days start on the UTC day", async ({ page }) => {
    await openScenario(page, "complete");
    await openEditor(page);
    await expect(page.getByText("2026-10-18 to 2026-11-16, counted in UTC from today.")).toBeVisible();
    // Switching to fixed dates for the first time keeps that range.
    await page.getByRole("radio", { name: "Fixed dates" }).click();
    await expect(page.getByLabel("Start")).toHaveValue("2026-10-18");
    await expect(page.getByLabel("End")).toHaveValue("2026-11-16");
    await expect(page.getByText("30 days (up to 92).")).toBeVisible();
  });
});

test("what the text cannot hold: a mileage cap is written; mixed cabin is kept by the search, and by a watch of it (T14)", async ({ page }) => {
  await openScenario(page, "complete");
  await searchFirst(page);
  await openEditor(page);
  await page.getByLabel("Mileage cap").fill("80000");
  await page.getByRole("button", { name: "Find award options" }).click();
  await settled(page);
  await expect(subline(page)).toHaveText("Oct 18 – 31 · Business, First · ≤ 80,000 miles");
  await expect(page.getByRole("button", { name: "Watch this search" })).toBeEnabled();

  await openEditor(page);
  await expect(page.getByLabel("Mileage cap")).toHaveValue("80000");
  await page.getByLabel("Mixed cabin", { exact: true }).selectOption("75");
  await page.getByRole("button", { name: "Find award options" }).click();
  await settled(page);
  // T14: a watch keeps the search's structured conditions, so a search its text cannot reproduce can be watched.
  const watch = page.getByRole("button", { name: "Watch this search" });
  await expect(watch).toBeEnabled();
  // Search again runs that search itself (75 % mixed cabin kept), not a re-reading of its words.
  await page.getByRole("button", { name: /^Search again/ }).click();
  await settled(page);
  await openEditor(page);
  await expect(page.getByLabel("Mixed cabin", { exact: true })).toHaveValue("75");
});

test("a program turned on and off again is all programs, and is not a change", async ({ page }) => {
  await openScenario(page, "complete");
  await searchFirst(page);
  await openEditor(page);
  await page.getByRole("button", { name: /^Programs/ }).click();
  const sheet = page.getByRole("dialog", { name: "Programs" });
  await sheet.getByRole("button", { name: "United MileagePlus" }).click();
  await sheet.getByRole("button", { name: "United MileagePlus" }).click();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: /^Programs/ })).toContainText(/1 selected|All programs/);
  await page.getByRole("button", { name: "Back" }).click();
  // The shown search named one program (aeroplan); after on/off of another it is unchanged, so Back does not ask.
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Hongqiao can be chosen on its own, not only as Shanghai", async ({ page }) => {
  await openScenario(page, "complete");
  await openEditor(page);
  await page.getByRole("combobox", { name: "Departure airports: Add airport" }).fill("hongqiao");
  await page.getByRole("listbox", { name: "Departure airports" }).getByRole("option", { name: /Hongqiao/ }).click();
  await expect(page.getByRole("button", { name: "Remove SHA Hongqiao" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove PVG/ })).toHaveCount(0);
});

test("the active place option is ringed, not only tinted", async ({ page }) => {
  await openScenario(page, "complete");
  await openEditor(page);
  await page.getByRole("combobox", { name: "Departure airports: Add airport" }).fill("tok");
  const active = page.getByRole("listbox", { name: "Departure airports" }).getByRole("option", { selected: true });
  expect(await active.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  expect(await active.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe("2px");
});

test("a search from the editor that fails says why, beside the previous results", async ({ page }) => {
  await openScenario(page, "failed-old");
  await openEditor(page);
  await page.getByRole("button", { name: "Business", pressed: true }).click();
  await page.getByRole("button", { name: "Find award options" }).click();
  await expect(page.getByText("seats.aero returned an error for this search.")).toBeVisible();
  await expect(page.getByText("Showing previous results; the new search failed.")).toBeVisible();
  await expect(page.getByTestId("availability-list").getByText("75,000")).toBeVisible();
});

test("typed text the parser cannot read says why, where it was typed, and sends nothing", async ({ page }) => {
  await openScenario(page, "failed-old");
  await openEditor(page);
  await page.locator("#q").fill("somewhere nice sometime");
  await page.getByRole("button", { name: /^Run/ }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("#q")).toBeFocused();
  await expect(editor(page)).toBeVisible();
  const log = await requestLog(page);
  expect(log.seats).toBe(0);
  expect(log.anthropic).toBe(0);
});

test("while a search runs, the way into the editor waits for it and says so", async ({ page }) => {
  await openScenario(page, "inflight-old");
  await openEditor(page);
  await page.locator("#q").fill(SEARCH_TEXT);
  await page.getByRole("button", { name: /^Run/ }).click();
  const summary = page.getByTestId("query-summary");
  await expect(summary).toContainText("A search is running. Edit it when it has finished.");
  await expect(summary.getByRole("link")).toHaveCount(0);
  // The condition chips are out of reach too.
  expect(await page.getByTestId("results-filters").evaluate((el) => el.hasAttribute("inert"))).toBe(true);
});
