/**
 * The keyless trip planner in the App Store flavour (release plan step 18; project `ios-store`, the fixture host served
 * with UIUX_STORE=1, which runs e2e/uiux/store-*.spec.ts).
 *
 *   - With no data source, the Search screen's welcome is followed by the planner: a typed trip, in English or Chinese,
 *     is read by the deterministic parser as a plan — each city with its airports, the dates with their year, the
 *     cabins, the parser's notices in the screen's language — and nothing is sent.
 *   - "Save plan" keeps it on this device (Saved › Trip plans), once; it can be deleted, and the deletion undone.
 *   - "Try with sample data", from the plan or from Saved, switches to sample data and searches the plan there. Sample
 *     mode's plans are its own: the account's are not shown there, and are back after Exit.
 *   - With an account connected, a kept plan's action is "Search", which runs it through the account.
 *   - No Pro, subscribe or live anywhere; no link out of the app (no program site, no aa.com); axe clean in light and dark.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { evidenceShot, openScenario, requestLog } from "./helpers";
import { expect, test } from "./test";

const tab = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });
const PAID = /\bPro\b|subscri|订阅|upgrade|unlock|purchas|\bbuy\b|购买|解锁|付费|\bpaid\b|\blive\b|实时/i;
const OUTBOUND = 'a[href^="http"]:not([href^="https://awardgrid.dowhiz.com/"])';

/** Type a trip into the planner and show its plan (or the reason it could not be read). */
async function showPlan(page: Page, text: string) {
  const planner = page.getByTestId("planner");
  await planner.locator("#q").fill(text);
  await planner.getByTestId("plan-run").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='plan-view'], #q-error") !== null && !document.querySelector("[data-testid='plan-run'][aria-busy='true']"));
}

test("no data source: a typed trip is shown as a plan, saved once, kept in Saved, and tried on sample data", async ({ page }) => {
  test.setTimeout(90_000);
  await openScenario(page, "no-seats-key", "ios", { lang: "en" });
  // The welcome first (sample data, then the account), then the planner. There is no search to run.
  await expect(page.getByTestId("welcome")).toBeVisible();
  const planner = page.getByTestId("planner");
  await expect(planner.getByRole("heading", { level: 2, name: "Plan a trip" })).toBeVisible();
  const [welcomeBox, plannerBox] = await Promise.all([page.getByTestId("welcome").boundingBox(), planner.boundingBox()]);
  expect(welcomeBox!.y).toBeLessThan(plannerBox!.y);
  await expect(page.getByTestId("text-search-run")).toHaveCount(0);
  await expect(planner.getByRole("textbox", { name: "Describe a trip" })).toBeVisible();
  // The welcome's "Try with sample data" stays the screen's one filled button.
  await expect(planner.locator(".ag-button-primary")).toHaveCount(0);

  await showPlan(page, "Tokyo to New York next month, first");
  const plan = page.getByTestId("plan-view");
  await expect(plan.getByRole("heading", { level: 3, name: "Your plan" })).toBeFocused();
  await expect(plan).toContainText("You typed: Tokyo to New York next month, first");
  await expect(plan.locator("q")).toHaveText("Tokyo to New York next month, first");
  await expect(plan.locator("dd").nth(0)).toHaveText("Tokyo · NRT, HND");
  await expect(plan.locator("dd").nth(1)).toHaveText("New York · JFK, EWR, LGA");
  await expect(plan.locator("dd").nth(2)).toHaveText("Oct 18 – Nov 16, 2026 · 30 days");
  await expect(plan.locator("dd").nth(3)).toHaveText("First");
  await expect(plan).toContainText("Read on this device. Nothing was sent.");
  await expect(plan.getByRole("button", { name: "Try with sample data: NRT, HND → JFK, EWR, LGA, Oct 18 – Nov 16, 2026" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(PAID);
  await expect(page.locator(OUTBOUND)).toHaveCount(0);
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0, trips: 0 });
  await evidenceShot(page, "planner-plan");

  // Saved once: the same plan again is the one already there.
  await plan.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Plan saved on this device." })).toBeVisible();
  await plan.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "This plan is already saved." })).toBeVisible();
  await page.getByRole("link", { name: "View in Saved" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Trip plans" })).toBeFocused();
  const card = page.getByTestId("plan-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Tokyo · NRT, HND");
  await expect(page.getByTestId("saved-plans")).toContainText("1 of 100 plans");
  await expect(page.getByText("Nothing saved yet")).toHaveCount(0);
  // A plan links nowhere; the only link out on Saved is the tab's own "Data: seats.aero" attribution.
  await expect(card.locator("a")).toHaveCount(0);
  await expect(page.locator(`${OUTBOUND}:not([href="https://seats.aero"])`)).toHaveCount(0);
  await evidenceShot(page, "planner-saved");

  // Delete, then Undo: back in its place, its heading focused.
  await card.getByRole("button", { name: "Delete plan: NRT, HND → JFK, EWR, LGA, Oct 18 – Nov 16, 2026" }).click();
  await expect(page.getByTestId("plan-card")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Deleted. Undo is available for 5 seconds." })).toBeVisible();
  await page.getByTestId("undo-bar").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("plan-card")).toHaveCount(1);
  await expect(page.getByTestId("plan-card").getByRole("heading", { level: 3 })).toBeFocused();

  // Try with sample data, from Saved: sample mode, and the plan searched there.
  await page.getByTestId("plan-card").getByRole("button", { name: /^Try with sample data: / }).click();
  await expect(page.getByTestId("sample-banner")).toBeVisible();
  await expect(page.getByTestId("query-summary")).toContainText("NRT, HND → JFK, EWR, LGA");
  await expect(page.locator(".ag-results[data-run]")).toHaveAttribute("data-busy", "false");
  const cards = page.getByTestId("availability-list").getByTestId("availability-card");
  await expect(cards.first()).toBeVisible();
  await expect(cards.first()).toContainText(/(NRT|HND) → (JFK|EWR|LGA)/);
  // In sample mode the text box searches the sample data: there is no planner.
  await expect(page.getByTestId("planner")).toHaveCount(0);
  // Sample mode's plans are its own: the account's are not here.
  await tab(page, "Saved").click();
  await expect(page.getByTestId("saved-plans")).toHaveCount(0);
  // Exit: the account again, and its plan is still kept.
  await page.getByTestId("sample-banner").getByRole("button", { name: "Exit sample data" }).click();
  await expect(page.getByTestId("welcome")).toBeVisible();
  await tab(page, "Saved").click();
  await expect(page.getByTestId("plan-card")).toHaveCount(1);
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0, trips: 0 });
});

test("in Chinese: the plan, the parser's notices and why a text could not be read, all in Chinese", async ({ page }) => {
  await openScenario(page, "no-seats-key", "ios", { lang: "zh" });
  const planner = page.getByTestId("planner");
  await expect(planner.getByRole("heading", { level: 2, name: "规划行程" })).toBeVisible();

  // No dates: the parser's own words, in Chinese, under the box; no plan.
  await showPlan(page, "香港到西雅图");
  await expect(planner.getByRole("alert")).toHaveText("无法从“香港到西雅图”中识别开始日期、结束日期。请写明城市（如 香港到西雅图 或 HKG to SEA）和日期范围（如 未来一个月 或 next month）。");
  await expect(planner.locator("#q")).toBeFocused();
  await expect(page.getByTestId("plan-view")).toHaveCount(0);

  await showPlan(page, "东京到纽约 下个月 头等舱");
  const plan = page.getByTestId("plan-view");
  await expect(plan.getByRole("heading", { level: 3, name: "你的规划" })).toBeFocused();
  await expect(plan.locator("dd").nth(0)).toHaveText("东京 · NRT、HND");
  await expect(plan.locator("dd").nth(1)).toHaveText("纽约 · JFK、EWR、LGA");
  await expect(plan.locator("dd").nth(2)).toHaveText("2026年10月18日–11月16日 · 30 天");
  await expect(plan.locator("dd").nth(3)).toHaveText("头等舱");
  await expect(planner.getByRole("alert")).toHaveCount(0);

  // Dates that have passed: the parser's notice in Chinese, and the plan cannot be tried, saying why.
  await showPlan(page, "LAX to Tokyo 2026-09-01 to 2026-09-10");
  await expect(plan.getByTestId("plan-notices")).toContainText("开始日期 2026-09-01 早于今天（2026-10-18）。");
  await expect(plan.getByTestId("plan-notices")).toContainText("这些日期已经过去。");
  await expect(plan.getByRole("button", { name: /^试用示例数据：/ })).toBeDisabled();
  await expect(page.locator("main")).not.toContainText(PAID);
  await expect(page.locator(OUTBOUND)).toHaveCount(0);
  await evidenceShot(page, "planner-zh");
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0, trips: 0 });
});

test("'Try with sample data' on the plan just read searches it on the sample data, without saving it", async ({ page }) => {
  await openScenario(page, "no-seats-key", "ios", { lang: "en" });
  await showPlan(page, "Hong Kong to Seattle next month, business");
  await page.getByTestId("plan-view").getByRole("button", { name: /^Try with sample data: HKG → SEA, / }).click();
  await expect(page.getByTestId("sample-banner")).toBeVisible();
  await expect(page.getByTestId("query-summary")).toContainText("HKG → SEA");
  await expect(page.getByTestId("query-summary")).toContainText("Business");
  const first = page.getByTestId("availability-list").getByTestId("availability-card").first();
  await expect(first).toContainText("HKG → SEA");
  await expect(first.locator(".ag-result-time")).toHaveText("Sample data");
  await page.getByTestId("sample-banner").getByRole("button", { name: "Exit sample data" }).click();
  await tab(page, "Saved").click();
  await expect(page.getByTestId("saved-plans")).toHaveCount(0);
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0, trips: 0 });
});

test("with an account connected, a kept plan's action is Search, which runs it through the account", async ({ page }) => {
  await openScenario(page, "no-seats-key", "ios", { lang: "en" });
  await showPlan(page, "HKG to SEA next 30 days business");
  await page.getByTestId("plan-view").getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Plan saved on this device." })).toBeVisible();

  // Connect an account (the host's stand-in accepts this test key).
  await page.getByTestId("welcome").getByRole("link", { name: "Connect your seats.aero account" }).click();
  await page.getByLabel("seats.aero API key", { exact: true }).fill("fixture-planner-key-WXYZ");
  await page.getByRole("button", { name: "Check and save", exact: true }).click();
  await expect(page.getByText(/Key on file ending in WXYZ/)).toBeVisible();
  const before = (await requestLog(page)).seats;

  // Search now runs searches: the planner is gone from it.
  await tab(page, "Search").click();
  await expect(page.getByTestId("planner")).toHaveCount(0);
  await expect(page.getByTestId("text-search-run")).toBeVisible();

  await tab(page, "Saved").click();
  const card = page.getByTestId("plan-card");
  await expect(page.getByTestId("saved-plans")).toContainText("Search sends requests to seats.aero through your seats.aero account, and they count toward today's calls.");
  await expect(card.getByRole("button", { name: /^Try with sample data/ })).toHaveCount(0);
  await card.getByRole("button", { name: "Search: HKG → SEA, Oct 18 – Nov 16, 2026" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  await expect(page.getByTestId("query-summary")).toContainText("HKG → SEA");
  await expect(page.locator(".ag-results[data-run]")).toHaveAttribute("data-busy", "false");
  await expect(page.getByTestId("sample-banner")).toHaveCount(0);
  expect((await requestLog(page)).seats).toBeGreaterThan(before);
  expect((await requestLog(page)).anthropic).toBe(0);
});

/** Serious or critical axe violations (WCAG 2.0/2.1 A and AA), as accessibility.spec.ts reads them. */
async function axeProblems(page: Page, key: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").flatMap((v) => v.nodes.map((n) => `${key} ${v.id}: ${n.target.join(" ")}`));
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: the planner, a plan and Saved › Trip plans have no serious or critical axe violation`, async ({ page }) => {
    await openScenario(page, "no-seats-key", "ios", { lang: "en", theme });
    const bad = await axeProblems(page, `${theme} planner`);
    await showPlan(page, "NRT to LHR 2026-11-01 to 2027-03-01 nonstop on United under 80000 miles business");
    await expect(page.getByTestId("plan-view")).toContainText("Also");
    bad.push(...(await axeProblems(page, `${theme} plan`)));
    await page.getByTestId("plan-view").getByRole("button", { name: "Save plan", exact: true }).click();
    await page.getByRole("link", { name: "View in Saved" }).click();
    await expect(page.getByTestId("plan-card")).toHaveCount(1);
    bad.push(...(await axeProblems(page, `${theme} saved plans`)));
    expect(bad).toEqual([]);
  });
}
