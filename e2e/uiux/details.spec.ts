/**
 * T10 — plain itinerary details and the way back (plan 02 T10; acceptance A17, A18, A19).
 *
 * Details open over the results from a card's "View option" (or a one-option matrix cell). They show the aggregate
 * first — nothing is fetched — and only "View flight itineraries" spends a seats.aero call, through the app's own
 * Get Trips path and quota. Back (the button, Esc, the browser) returns to the results exactly as they were: view,
 * selection, scroll, and focus on what opened the details, with no further call.
 *
 * Adapted from the plan's Step 1: "complete" starts with no results here, so a search comes first.
 */
import type { Page } from "@playwright/test";
import { evidenceShot, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";

const details = (page: Page) => page.getByTestId("detail-screen");
const openFirst = (page: Page, name: RegExp) => page.getByTestId("availability-list").locator("[data-row-key]").first().getByRole("button", { name }).click();

test("details are read only after explicit request", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "zh" });
  await searchByText(page, SEARCH_TEXT);
  const before = await requestLog(page);
  await openFirst(page, /查看选项/);
  await expect(details(page)).toBeVisible();
  expect((await requestLog(page)).trips).toBe(before.trips);
  await page.getByRole("button", { name: "查看具体航班", exact: true }).click();
  await expect(details(page).getByTestId("trip-card").first()).toBeVisible();
  expect((await requestLog(page)).trips).toBe(before.trips + 1);
  await page.getByRole("button", { name: "返回结果", exact: true }).click();
  await expect(details(page)).toHaveCount(0);
  expect((await requestLog(page)).trips).toBe(before.trips + 1);
});

test("the aggregate comes first and costs nothing; hovering never fetches", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  const card = page.getByTestId("availability-list").getByTestId("availability-card").first();
  await card.hover();
  await card.getByRole("button", { name: /^View option/ }).hover();
  await card.getByRole("button", { name: /^View option/ }).click();
  const d = details(page);
  await expect(d.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(d).toContainText("HKG → SEA");
  await expect(d).toContainText("75,000");
  await expect(d).toContainText("Fees not yet confirmed");
  await expect(d).toContainText("Air Canada Aeroplan");
  await expect(d).toContainText("Seat count not provided");
  await expect(d).toContainText("Source updated 1 d ago");
  await expect(d.getByRole("button", { name: "View flight itineraries", exact: true })).toBeVisible();
  expect(await requestLog(page)).toMatchObject({ seats: 0, trips: 0, anthropic: 0 });
});

test("back — by button, Esc or the browser — restores the results as they were, focus on what opened them, no call", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  // Through the editor: its return-focus state stays on this history entry, and must not be applied again on return.
  await page.getByRole("link", { name: "Build a search" }).click();
  await expect(page.getByRole("heading", { name: "Edit search", level: 1 })).toBeVisible();
  await page.locator("#q").fill(SEARCH_TEXT);
  await page.getByRole("button", { name: /^Run/ }).click();
  await expect(page.locator(".ag-results[data-run]")).toHaveAttribute("data-run", "finished");
  const list = page.getByTestId("availability-list");
  await list.getByRole("checkbox").nth(1).check();
  await page.locator(".app-main").evaluate((el) => (el.scrollTop = 180));
  const scrolled = await page.locator(".app-main").evaluate((el) => el.scrollTop);
  const sent = await requestLog(page);
  const opener = list.getByTestId("availability-card").nth(2).getByRole("button", { name: /^View option/ });

  for (const back of ["button", "Escape", "browser"] as const) {
    await opener.click();
    await expect(details(page)).toBeVisible();
    await expect(page.getByRole("dialog")).toBeVisible();
    // The results and the tab bar under the details cannot be reached.
    expect(await page.locator(".ag-results").evaluate((el) => el.hasAttribute("inert"))).toBe(true);
    expect(await page.locator(".app-tabs").evaluate((el) => el.hasAttribute("inert"))).toBe(true);
    if (back === "button") await page.getByRole("button", { name: "Return to results", exact: true }).click();
    if (back === "Escape") await page.keyboard.press("Escape");
    if (back === "browser") await page.goBack();
    await expect(details(page)).toHaveCount(0);
    await expect(opener, back).toBeFocused();
    await expect(list.getByRole("checkbox").nth(1)).toBeChecked();
    expect(await page.locator(".app-main").evaluate((el) => el.scrollTop), back).toBe(scrolled);
  }
  const after = await requestLog(page);
  expect([after.seats, after.trips, after.anthropic]).toEqual([sent.seats, sent.trips, 0]);
});

test("the calendar's chosen day, the matrix's scroll and the sort are as they were after the details", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  await page.getByTestId("results-view").getByRole("combobox", { name: "Sort" }).selectOption("seats_desc");
  // Calendar: a chosen day, then one of its options.
  await page.getByTestId("results-view").getByRole("radio", { name: "Calendar", exact: true }).click();
  await page.getByTestId("calendar-view").locator('[data-date="2026-10-18"]').click();
  const dayOption = page.getByTestId("calendar-day-list").getByRole("button", { name: /^View option/ }).first();
  await dayOption.click();
  await expect(details(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details(page)).toHaveCount(0);
  await expect(dayOption).toBeFocused();
  await expect(page.getByTestId("calendar-day-list")).toBeVisible();
  // Matrix: scrolled down, then a one-option cell.
  await page.getByTestId("results-view").getByRole("radio", { name: "Matrix", exact: true }).click();
  const scroller = page.getByTestId("matrix-view").locator(".ag-mx-scroll");
  const cell = page.getByRole("gridcell", { name: /^HKG → SEA, Mon, Oct 19:/ });
  await cell.focus();
  const before = await scroller.evaluate((el) => [el.scrollTop, el.scrollLeft]);
  await page.keyboard.press("Enter");
  await expect(details(page)).toBeVisible();
  await page.goBack();
  await expect(cell).toBeFocused();
  expect(await scroller.evaluate((el) => [el.scrollTop, el.scrollLeft])).toEqual(before);
  await expect(page.getByTestId("results-view").getByRole("combobox", { name: "Sort" })).toHaveValue("seats_desc");
  expect((await requestLog(page)).trips).toBe(0);
});

test("a view filter is still applied, and still said, after the details close", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  // A saved local filter (no iOS control yet, U-032): into the workspace's other slot with the next generation.
  await page.evaluate(() => {
    const [newest] = Object.keys(localStorage)
      .filter((k) => k.startsWith("uiux-fixture:files:") && /workspace-v1\.[ab]\.json$/.test(k))
      .map((k) => ({ k, c: JSON.parse(localStorage.getItem(k)!) as { generation: number; value: { preferences: object } } }))
      .sort((a, b) => b.c.generation - a.c.generation);
    const other = newest!.k.endsWith(".a.json") ? newest!.k.replace(/\.a\.json$/, ".b.json") : newest!.k.replace(/\.b\.json$/, ".a.json");
    const value = { ...newest!.c.value, preferences: { ...newest!.c.value.preferences, localFilter: { maxMiles: 80000 } } };
    localStorage.setItem(other, JSON.stringify({ generation: newest!.c.generation + 1, value }));
  });
  await openScenario(page, "missing-values", "ios", { lang: "en", preserveStorage: true });
  await expect(page.getByText("1 option is hidden by your view filter.")).toBeVisible();
  await openFirst(page, /^View option/);
  await expect(details(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details(page)).toHaveCount(0);
  await expect(page.getByTestId("availability-list").getByTestId("availability-card")).toHaveCount(1);
  await expect(page.getByText("1 option is hidden by your view filter.")).toBeVisible();
  expect((await requestLog(page)).seats).toBe(0);
});

test("from the matrix: Enter on a one-option cell opens its details, and Esc comes back to that cell", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  await page.getByTestId("results-view").getByRole("radio", { name: "Matrix", exact: true }).click();
  const cell = page.getByRole("gridcell", { name: /^HKG → SEA, Tue, Oct 20:/ });
  await cell.focus();
  await page.keyboard.press("Enter");
  await expect(details(page)).toContainText("82,000");
  await page.keyboard.press("Escape");
  await expect(cell).toBeFocused();
  await expect(page.getByRole("grid")).toBeVisible();
  expect((await requestLog(page)).trips).toBe(0);
});

test("an option that is not in the results is refused: nothing is fetched, the way back is offered", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  await page.evaluate(() => (location.hash = "#/detail/not-a-snapshot/not-a-row"));
  await expect(details(page)).toContainText("This option is not in your results.");
  await expect(details(page).getByRole("button", { name: "View flight itineraries" })).toHaveCount(0);
  await page.getByRole("button", { name: "Return to results", exact: true }).click();
  await expect(page.getByTestId("availability-list")).toBeVisible();
  // Nothing opened it: focus lands on the results' status line, not on the page.
  await expect(page.getByTestId("results-status")).toBeFocused();
  expect(await requestLog(page)).toMatchObject({ seats: 0, trips: 0 });
});

test("320 at double text: the title stays inside its header, and nothing runs off the side", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  await page.addStyleTag({ content: ":root { --ag-text-scale: 2; }" });
  await openFirst(page, /^View option/);
  await page.getByRole("button", { name: "View flight itineraries", exact: true }).click();
  await expect(details(page).getByTestId("trip-card").first()).toBeVisible();
  const header = (await details(page).locator(".ag-detail-header").boundingBox())!;
  const title = (await details(page).getByRole("heading", { level: 1 }).boundingBox())!;
  expect(title.y).toBeGreaterThanOrEqual(header.y - 0.5);
  expect(title.y + title.height).toBeLessThanOrEqual(header.y + header.height + 0.5);
  expect(await details(page).locator(".ag-detail-body").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const card of await details(page).getByTestId("trip-card").all()) expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("copying says so every time, through a status that is there before the first copy; the quota line counts the load", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  const quota = page.locator(".ag-results-meta.tabular");
  const before = await quota.textContent();
  await openFirst(page, /^View option/);
  const status = details(page).getByRole("status");
  await expect(status).toHaveCount(1);
  await expect(status).toHaveText("");
  const copyButton = details(page).getByRole("button", { name: "Copy search details", exact: true });
  await copyButton.click();
  await expect(status).toHaveText("Copied.");
  await copyButton.click();
  await expect(status).toHaveText("Copied.");
  await page.getByRole("button", { name: "View flight itineraries", exact: true }).click();
  await expect(details(page).getByTestId("trip-card").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(quota).not.toHaveText(before!);
});

test("itineraries loaded once are read again from this device without a call", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  await openFirst(page, /^View option/);
  await page.getByRole("button", { name: "View flight itineraries", exact: true }).click();
  await expect(details(page).getByTestId("trip-card").first()).toBeVisible();
  const loaded = (await requestLog(page)).trips;
  await page.keyboard.press("Escape");
  await openFirst(page, /^View option/);
  await expect(details(page).getByTestId("trip-card").first()).toBeVisible();
  await expect(details(page)).toContainText("Loaded on this device");
  expect((await requestLog(page)).trips).toBe(loaded);
});

test("loaded itineraries: each its own miles, airport-local times with their dates, mixed cabin as seats.aero means it", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  // The cheapest option (68,000, Oct 19 Business) has a nonstop and a one-stop itinerary with mixed cabins.
  await openFirst(page, /^View option/);
  await page.getByRole("button", { name: "View flight itineraries", exact: true }).click();
  const cards = details(page).getByTestId("trip-card");
  await expect(cards).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Flight itineraries" })).toBeFocused();
  const nonstop = cards.nth(0);
  await expect(nonstop).toContainText("Nonstop · 12 h 10 min");
  // HKG 10:30 → SEA 07:40 the same calendar day: airport-local, never shifted through the device's zone.
  await expect(nonstop.locator(".ag-trip-time")).toHaveText(["10:30", "07:40"]);
  await expect(nonstop.locator(".ag-trip-day")).toHaveText(["Mon, Oct 19", "Mon, Oct 19"]);
  await expect(nonstop).toContainText("Local time at each airport");
  await expect(nonstop).toContainText("68,000 miles");
  await expect(nonstop).toContainText("XX · XX 120");
  await expect(nonstop).toContainText("USD 86.20");
  await expect(nonstop).toContainText("2 seats");
  const oneStop = cards.nth(1);
  // Its own price, not the option's lowest.
  await expect(oneStop).toContainText("73,000 miles");
  await expect(oneStop).toContainText("1 stop");
  await expect(oneStop.locator(".ag-trip-segments li")).toHaveText(["XX 150 · HKG Oct 19 08:05 → TPE Oct 19 09:55", "XX 151 · TPE Oct 19 12:20 → SEA Oct 19 09:55"]);
  // seats.aero's MixedCabinPct 20: a fifth of the distance below Business.
  await expect(oneStop).toContainText("Business · Mixed cabin: 20% of the distance below this cabin");
  await expect(oneStop).toContainText("One itinerary can include different cabins. Check every segment.");
  // This option's primary booking link is javascript: — refused; another program's link is not its way out either.
  await expect(details(page).getByRole("link")).toHaveCount(0);
  await expect(details(page).locator('a[href^="javascript:"], a[href^="data:"], a[href*="united.example"]')).toHaveCount(0);
  await expect(details(page).getByRole("button", { name: "Copy search details", exact: true })).toBeVisible();
});

test("an option's own program link, with the approved caveat above it; one primary action at a time", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  const card = page.getByTestId("availability-list").getByTestId("availability-card").filter({ hasText: "75,000" });
  await card.getByRole("button", { name: /^View option/ }).click();
  await page.getByRole("button", { name: "View flight itineraries", exact: true }).click();
  const out = details(page).getByRole("link", { name: "Program website (aeroplan.example)" });
  await expect(out).toHaveAttribute("href", "https://aeroplan.example/redeem-synthetic");
  await expect(details(page).locator("footer")).toContainText("Check availability and fees on the program website.");
  await expect(details(page).locator(".ag-button-primary")).toHaveCount(1);
});

test("a link known before loading (an American search page) carries the caveat too, and loading stays the one primary action", async ({ page }) => {
  await openScenario(page, "multi-program", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  const card = page.getByTestId("availability-list").getByTestId("availability-card").filter({ hasText: "American Airlines AAdvantage" });
  await card.getByRole("button", { name: /^View option/ }).click();
  await expect(details(page).getByRole("link", { name: "Program website (www.aa.com)" })).toBeVisible();
  await expect(details(page).locator("footer")).toContainText("Check availability and fees on the program website.");
  await expect(details(page).locator(".ag-button-primary")).toHaveText(["View flight itineraries"]);
  expect((await requestLog(page)).trips).toBe(0);
});

test("no itineraries in this cabin: said, not invented; with no trusted link, only 'Copy search details'", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  // The zero-fees option (82,000, Oct 20): the stand-in returns no itineraries and no links for it.
  const card = page.getByTestId("availability-list").getByTestId("availability-card").filter({ hasText: "82,000" });
  await card.getByRole("button", { name: /^View option/ }).click();
  await page.getByRole("button", { name: "View flight itineraries", exact: true }).click();
  await expect(details(page)).toContainText("seats.aero returned no itineraries in this cabin for this option.");
  await expect(details(page).getByTestId("trip-card")).toHaveCount(0);
  await expect(details(page).getByRole("link", { name: /Program website/ })).toHaveCount(0);
  await details(page).getByRole("button", { name: "Copy search details", exact: true }).click();
  await expect(details(page).getByRole("status")).toHaveText("Copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("HKG → SEA · Tue, Oct 20 · Business · Air Canada Aeroplan · 82,000 miles");
  expect((await requestLog(page)).trips).toBe(1);
});

test("a failed load keeps the option on screen and says why; the call it made is counted", async ({ page }) => {
  await openScenario(page, "failed-old", "ios", { lang: "en" });
  await openFirst(page, /^View option/);
  await page.getByRole("button", { name: "View flight itineraries", exact: true }).click();
  await expect(details(page).getByRole("alert")).toBeVisible();
  await expect(details(page)).toContainText("75,000");
  await expect(details(page).getByRole("button", { name: "View flight itineraries", exact: true })).toBeVisible();
  expect((await requestLog(page)).trips).toBe(1);
});

for (const lang of ["en", "zh"] as const) test(`390 (${lang}): header 52, 16 pt gutters, two bottom buttons of (358 − 8) / 2 by 48, labels on one line`, async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang });
  await searchByText(page, SEARCH_TEXT);
  // The 75,000 option: it has its program's link, so both bottom buttons show.
  const card = page.getByTestId("availability-list").getByTestId("availability-card").filter({ hasText: "75,000" });
  await card.getByRole("button", { name: lang === "en" ? /^View option/ : /查看选项/ }).click();
  await page.getByRole("button", { name: lang === "en" ? "View flight itineraries" : "查看具体航班", exact: true }).click();
  await expect(details(page).getByTestId("trip-card").first()).toBeVisible();
  expect(Math.round((await details(page).locator(".ag-detail-header").boundingBox())!.height)).toBe(52);
  const summary = (await details(page).locator(".ag-detail-summary").boundingBox())!;
  expect([Math.round(summary.x), Math.round(summary.width)]).toEqual([16, 358]);
  const buttons = details(page).locator(".ag-detail-actions > .ag-button");
  await expect(buttons).toHaveCount(2);
  for (const b of await buttons.all()) {
    const box = (await b.boundingBox())!;
    expect(Math.round(box.width)).toBe(175);
    expect(Math.round(box.height)).toBe(48);
    expect(await b.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: details with itineraries at 390`, async ({ page }) => {
    await openScenario(page, "complete", "ios", { theme, lang: "zh" });
    await searchByText(page, SEARCH_TEXT);
    // The 75,000 option: its program's link, with the caveat above it.
    await page.getByTestId("availability-list").getByTestId("availability-card").filter({ hasText: "75,000" }).getByRole("button", { name: /查看选项/ }).click();
    await page.getByRole("button", { name: "查看具体航班", exact: true }).click();
    await expect(details(page).getByTestId("trip-card").first()).toBeVisible();
    await evidenceShot(page, `t10-details-${theme}`);
  });
}
