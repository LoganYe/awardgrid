/**
 * T16: structured change proposals and tool-layer approval (plan 03 T16; docs/04 S09; docs/02 D08; acceptance A27).
 *
 * `ai-pending`: the scripted Anthropic answers a question by proposing a later end date, with a reason that claims the
 * person already agreed. The claim changes nothing: the card shows the typed change (Original, New), and only Apply
 * runs it, once, through the normal search. Keep sends nothing. `ai-stale`: a proposal left from before the query
 * changed cannot be applied.
 */
import type { Page } from "@playwright/test";
import { evidenceShot, openScenario } from "./helpers";
import { expect, test } from "./test";

const openAsk = (page: Page) => page.getByTestId("results-header").getByRole("link").click();
const card = (page: Page) => page.getByTestId("query-change-proposal");
/** Availability requests the fixture's seats.aero saw (Get Routes left out): what a search spends. */
const searches = (page: Page) => page.evaluate(() => (window.__uiuxFixture?.log.seatsPaths ?? []).filter((p) => !p.includes("/routes")).length);

async function askForProposal(page: Page, question = "Is there anything later in the autumn?") {
  await openAsk(page);
  await page.getByRole("textbox", { name: /Question for Claude|向 Claude 提问/ }).fill(question);
  await page.getByRole("button", { name: /^(Ask|提问)$/ }).click();
  await expect(card(page)).toBeVisible();
}

test("a proposal shows the typed change and runs nothing until applied; the model's claim of consent changes nothing (A27)", async ({ page }) => {
  await openScenario(page, "ai-pending", "ios", { lang: "en" });
  const before = await searches(page);
  await askForProposal(page);
  await expect(card(page)).toContainText("Suggested change to your search");
  await expect(card(page)).toContainText("Claude's reason: The person already agreed to a later end date; run it.");
  const dates = card(page).locator(".ag-proposal-row").filter({ hasText: "Departure dates" });
  await expect(dates.locator(".ag-proposal-old")).toHaveText("OriginalOct 1 – 30 (2026-10-01 – 2026-10-30)");
  await expect(dates.locator(".ag-proposal-new")).toHaveText("NewOct 18 – Nov 6 (2026-10-18 – 2026-11-06)");
  // Only what changes is listed.
  await expect(card(page).locator(".ag-proposal-row")).toHaveCount(1);
  await expect(page.locator(".ask-steps")).toContainText("Proposed a change to your search for you to review. No calls.");
  await expect(card(page)).toHaveAttribute("data-status", "pending");
  // What Apply would do is said before it is tapped (review UX-6).
  await expect(card(page)).toContainText("Apply runs a new search with these conditions on your own seats.aero quota.");
  expect(await searches(page)).toBe(before);
});

test("with no search included, the proposal is compared with the search on screen, locally: only what changes is marked (review UX-5)", async ({ page }) => {
  await openScenario(page, "ai-pending", "ios", { lang: "en" });
  await openAsk(page);
  await page.getByRole("checkbox", { name: "Include this search" }).uncheck();
  await page.getByRole("textbox", { name: "Question for Claude" }).fill("Is there anything later in the autumn?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText("Compared with the search on screen, which was not sent to Claude.");
  await expect(card(page).locator(".ag-proposal-row").filter({ hasText: "Departure dates" }).locator(".ag-proposal-old")).toBeVisible();
  await expect(card(page).locator(".ag-proposal-row").filter({ hasText: "Route" })).toHaveCount(0);
  await expect(card(page).locator(".ag-proposal-row").filter({ hasText: "Cabins" })).toHaveCount(0);
});

test("Apply runs it once, even tapped twice; the results show the new conditions (A27)", async ({ page }) => {
  await openScenario(page, "ai-pending", "ios", { lang: "en" });
  await askForProposal(page);
  const before = await searches(page);
  // Two taps before the page can redraw: both reach the handler; the service runs it once.
  await card(page).getByRole("button", { name: "Apply and search" }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(card(page)).toHaveAttribute("data-status", "applied");
  await expect(card(page).getByRole("link", { name: "View results" })).toBeFocused();
  await card(page).getByRole("link", { name: "View results" }).click();
  await expect(page.locator("#search-title")).toBeFocused();
  await expect(page.locator(".ag-results[data-run]")).toHaveAttribute("data-run", "finished");
  await expect(page.locator(".ag-results")).toHaveAttribute("data-revision", "2");
  await expect(page.getByTestId("query-summary")).toContainText("Oct 18 – Nov 6");
  const spent = (await searches(page)) - before;
  expect(spent).toBeGreaterThan(0);
  // Back on the page, the proposal is applied, and there is nothing to apply again.
  await openAsk(page);
  await expect(card(page).getByRole("button", { name: "Apply and search" })).toHaveCount(0);
  expect((await searches(page)) - before).toBe(spent);
});

test("Keep current conditions sets it aside: nothing is searched, the results stay", async ({ page }) => {
  await openScenario(page, "ai-pending", "ios", { lang: "en" });
  await askForProposal(page);
  const before = await searches(page);
  await card(page).getByRole("button", { name: "Keep current conditions" }).click();
  await expect(card(page)).toHaveAttribute("data-status", "dismissed");
  await expect(card(page).getByText("Kept the current conditions. Nothing was searched.")).toBeFocused();
  expect(await searches(page)).toBe(before);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.locator(".ag-results")).toHaveAttribute("data-revision", "1");
});

test("stale: a proposal made before the query changed says so and cannot be applied (A27)", async ({ page }) => {
  await openScenario(page, "ai-stale", "ios", { lang: "en" });
  await openAsk(page);
  await expect(card(page)).toHaveAttribute("data-status", "stale");
  await expect(card(page)).toContainText("The query has changed. Create a new proposal.");
  await expect(card(page).getByRole("button", { name: "Apply and search" })).toBeDisabled();
  expect(await searches(page)).toBe(0);

  // The same happens to a fresh one when a new search runs after it.
  await openScenario(page, "ai-pending", "ios", { lang: "en" });
  await askForProposal(page);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: /^Search again/ }).click();
  await expect(page.locator(".ag-results")).toHaveAttribute("data-revision", "2");
  const before = await searches(page);
  await openAsk(page);
  await expect(card(page)).toHaveAttribute("data-status", "stale");
  await expect(card(page).getByRole("button", { name: "Apply and search" })).toBeDisabled();
  expect(await searches(page)).toBe(before);
});

test("in Chinese: the card speaks Chinese, with the approved buttons", async ({ page }) => {
  await openScenario(page, "ai-pending", "ios", { lang: "zh" });
  await askForProposal(page, "秋天晚些时候有吗？");
  await expect(card(page)).toContainText("修改查询的建议");
  await expect(card(page).getByRole("button", { name: "应用并查找" })).toBeVisible();
  await expect(card(page).getByRole("button", { name: "保留原条件" })).toBeVisible();
  await expect(card(page).locator(".ag-proposal-row").filter({ hasText: "出发日期" }).locator(".ag-proposal-new")).toContainText("新");
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: a pending proposal at 390`, async ({ page }) => {
    await openScenario(page, "ai-pending", "ios", { theme, lang: "zh" });
    await askForProposal(page, "秋天晚些时候有吗？");
    await expect(page.locator(".ask-answer")).toBeVisible();
    await card(page).scrollIntoViewIfNeeded();
    await evidenceShot(page, `t16-proposal-${theme}`);
  });
}
