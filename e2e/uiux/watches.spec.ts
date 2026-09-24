/**
 * T14: structured watches and the foreground change loop (plan 03 T14; docs/04 S07; acceptance A24, A25).
 *
 * The first check sets a baseline and reports nothing new; a quiet check keeps the changes not yet seen, listed with
 * old and new values; a failed check keeps the previous baseline and says so. A watch keeps its search's structured
 * conditions, is edited as conditions (saving sends nothing), and a watch from before T14 is migrated at launch.
 */
import type { Page } from "@playwright/test";
import { evidenceShot, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";
const tabs = (page: Page) => page.getByRole("navigation", { name: /Main navigation|主导航/ });
const watchesFile = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("uiux-fixture:files:watches.json") ?? "null") as { version: number; watches: Array<Record<string, unknown>> } | null);

test("the first check sets a baseline and reports nothing new (A25)", async ({ page }) => {
  await openScenario(page, "watch-baseline", "ios", { lang: "en" });
  // The check runs on opening the app: one search, nothing reported.
  await expect.poll(async () => (await requestLog(page)).seats).toBeGreaterThanOrEqual(1);
  await tabs(page).getByRole("link", { name: "Watches" }).click();
  const card = page.getByTestId("watch-card");
  await expect(card).toContainText("Baseline saved just now. Later checks report what changes.");
  await expect(card).not.toContainText("since you last looked");
  await expect(card).not.toContainText("New:");
  // What the platform does, said from its capabilities (approved copy).
  await expect(page.getByText("Checked when you open or return to the app. No checks or push alerts while closed.")).toBeVisible();
});

test("a quiet check keeps the changes not yet seen, listed with old and new values and the dates compared (A25)", async ({ page }) => {
  await openScenario(page, "watch-changes", "ios", { lang: "en" });
  await expect.poll(async () => (await requestLog(page)).seats).toBeGreaterThanOrEqual(1);
  // The tab says there is news before the screen is opened.
  await expect(tabs(page).getByRole("link", { name: /Watches/ })).toContainText("1");
  await tabs(page).getByRole("link", { name: /Watches/ }).click();
  const card = page.getByTestId("watch-card");
  await expect(card).toContainText("1 new, 1 cheaper since you last looked");
  await card.getByText("What changed").click();
  await expect(card.getByRole("listitem")).toHaveText([
    "New: Sun, Oct 18 · Business · HKG → SEA · Aeroplan, 75,000 miles",
    "Cheaper: Sun, Oct 18 · First · HKG → SEA · Aeroplan, 120,000 miles → 110,000 miles",
  ]);
  await expect(card).toContainText(/Last checked just now/);
  await expect(card).toContainText(/Compared over Oct 1 – 30, the dates both checks covered\./);
  // Seen now: marked as such on disk, and gone after leaving and coming back.
  await expect.poll(async () => (await watchesFile(page))?.watches[0]?.unseen ?? null).toBeNull();
  await tabs(page).getByRole("link", { name: "Search" }).click();
  await tabs(page).getByRole("link", { name: "Watches" }).click();
  await expect(page.getByTestId("watch-card")).not.toContainText("since you last looked");
});

test("a failed check keeps the previous baseline, and says so (A25)", async ({ page }) => {
  await openScenario(page, "watch-failure", "ios", { lang: "en" });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("uiux-fixture:files:watches.json")!).watches[0].baseline);
  await expect.poll(async () => (await requestLog(page)).seats).toBeGreaterThanOrEqual(1);
  await tabs(page).getByRole("link", { name: "Watches" }).click();
  await expect(page.getByTestId("watch-card")).toContainText(/Check failed; previous baseline kept \(just now\)/);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(async () => JSON.stringify((await watchesFile(page))?.watches[0]?.lastResult ?? null)).toContain('"failed"');
  expect((await watchesFile(page))!.watches[0]!.baseline).toEqual(before);
});

test("a watch keeps its search's structured conditions, and is edited as conditions: saving sends nothing and starts it again (A24)", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  // Mixed cabin 75%: a condition its words cannot hold; the watch keeps it anyway.
  await page.getByTestId("query-summary").getByRole("link").click();
  await page.getByLabel("Mixed cabin", { exact: true }).selectOption("75");
  await page.getByRole("button", { name: "Find award options" }).click();
  await expect(page.locator(".ag-results[data-run]")).toHaveAttribute("data-run", "finished");
  await page.getByRole("button", { name: "Watch this search" }).click();
  await expect.poll(async () => (await watchesFile(page))?.watches.length ?? 0).toBe(1);
  expect((await watchesFile(page))!.watches[0]!.draft).toMatchObject({ query: { min_cabin_pct: 75 } });

  await tabs(page).getByRole("link", { name: "Watches" }).click();
  const card = page.getByTestId("watch-card");
  await expect(card).toContainText("HKG → SEA");
  const sent = (await requestLog(page)).seats;
  await card.getByRole("link", { name: /^Edit watch: / }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edit watch" })).toBeVisible();
  // No text search here: a watch is its conditions.
  await expect(page.locator("#q")).toHaveCount(0);
  await expect(page.getByLabel("Mixed cabin", { exact: true })).toHaveValue("75");
  await page.getByRole("switch", { name: "Nonstop only" }).click();
  await page.getByRole("button", { name: "Save watch" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Watch saved. It starts again from these conditions." })).toBeVisible();
  await expect(card.getByRole("link", { name: /^Edit watch: / })).toBeFocused();
  const saved = (await watchesFile(page))!.watches[0]!;
  expect(saved).toMatchObject({ draft: { query: { direct_only: true, min_cabin_pct: 75 } }, baseline: [], lastCheckedAt: null, review: null });
  expect((await requestLog(page)).seats).toBe(sent);
});

test("watches from before T14 are migrated at launch: a relative one stays relative, an unclear one asks for review, none lost", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  const v1 = {
    version: 1,
    watches: [
      { id: "old-1", name: "HKG to SEA next 30 days business", text: "HKG to SEA next 30 days business", lastCheckedAt: null, baseline: [], dropThresholdPct: 10, enabled: false, createdAt: "2026-09-01T00:00:00.000Z" },
      { id: "old-2", name: "HKG to SEA October business", text: "HKG to SEA October business", lastCheckedAt: null, baseline: [], dropThresholdPct: 10, enabled: false, createdAt: "2026-09-01T00:00:00.000Z" },
      // Compared by its last check, before T14 recorded over which dates: unknown, so neither is claimed.
      {
        id: "old-3",
        name: "HKG to SEA next 60 days first",
        text: "HKG to SEA next 60 days first",
        lastCheckedAt: "2026-10-17T09:00:00.000Z",
        lastResult: { at: "2026-10-17T09:00:00.000Z", status: "checked", firstCheck: false },
        baseline: [],
        baselineWindow: { date_from: "2026-10-17", date_to: "2026-12-15" },
        dropThresholdPct: 10,
        enabled: false,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ],
  };
  await page.evaluate((file) => localStorage.setItem("uiux-fixture:files:watches.json", JSON.stringify(file)), v1);
  await openScenario(page, "complete", "ios", { lang: "en", preserveStorage: true });
  await tabs(page).getByRole("link", { name: "Watches" }).click();
  const cards = page.getByTestId("watch-card");
  await expect(cards).toHaveCount(3);
  // The relative one runs its conditions (its route, then its rule and today's window, as the results summary says
  // them); the unclear one keeps its name and words, and says why it waits.
  await expect(cards.nth(0).getByRole("heading", { level: 2 })).toHaveText("HKG → SEA");
  await expect(cards.nth(0)).toContainText(/Next 30 days · \w{3} \d{1,2} – /);
  await expect(cards.nth(0)).not.toContainText("Checked by its words");
  await expect(cards.nth(1)).toContainText("Checked by its words: “HKG to SEA October business”");
  await expect(cards.nth(1)).toContainText("Check the dates to set them.");
  await expect(cards.nth(2)).not.toContainText("Compared over");
  await expect(cards.nth(2)).not.toContainText("Could not compare");
  // The old file is kept aside, as it was; nothing was fetched (both are paused).
  expect(await page.evaluate(() => localStorage.getItem("uiux-fixture:files:watches.v1.json"))).toBe(JSON.stringify(v1));
  expect((await requestLog(page)).seats).toBe(0);
});

test("a damaged watches file is kept aside, unchanged, and said; a newer one is left alone and said", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  const torn = '{"version":2,"watches":[{"id":"w1","te';
  await page.evaluate((raw) => localStorage.setItem("uiux-fixture:files:watches.json", raw), torn);
  await openScenario(page, "complete", "ios", { lang: "en", preserveStorage: true });
  await tabs(page).getByRole("link", { name: "Watches" }).click();
  await expect(page.getByText(/The watches file on this device could not be read\. It was kept unchanged as watches\.damaged-.+\.json/)).toBeVisible();
  const aside = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("uiux-fixture:files:watches.damaged-")));
  expect(aside).toHaveLength(1);
  expect(await page.evaluate((k) => localStorage.getItem(k), aside[0]!)).toBe(torn);

  const newer = JSON.stringify({ version: 3, watches: [{ id: "future", text: "HKG to SEA" }] });
  await page.evaluate((raw) => localStorage.setItem("uiux-fixture:files:watches.json", raw), newer);
  await openScenario(page, "complete", "ios", { lang: "en", preserveStorage: true });
  await tabs(page).getByRole("link", { name: "Watches" }).click();
  await expect(page.getByText("Your watches were saved by a newer version of awardgrid.", { exact: false })).toBeVisible();
  await expect(page.getByText("You are not watching any searches yet.", { exact: false })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => localStorage.getItem("uiux-fixture:files:watches.json"))).toBe(newer);
});

test("a watch whose dates passed is edited to new dates: the stale reason goes, leaving asks in the watch's words, and saving is announced", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  await page.getByRole("button", { name: "Watch this search" }).click();
  await expect.poll(async () => (await watchesFile(page))?.watches.length ?? 0).toBe(1);
  // Its fixed dates, September, have passed on the scenario's clock (2026-10-18).
  await page.evaluate(() => {
    const file = JSON.parse(localStorage.getItem("uiux-fixture:files:watches.json")!);
    const w = file.watches[0];
    w.draft.dates = { kind: "fixed", from: "2026-09-01", to: "2026-09-30" };
    w.draft.query.date_from = "2026-09-01";
    w.draft.query.date_to = "2026-09-30";
    localStorage.setItem("uiux-fixture:files:watches.json", JSON.stringify(file));
  });
  await openScenario(page, "complete", "ios", { lang: "en", preserveStorage: true });
  await tabs(page).getByRole("link", { name: "Watches" }).click();
  const card = page.getByTestId("watch-card");
  await expect(card).toContainText("Not checked: these dates have passed. Edit the watch to choose new dates.");
  expect((await requestLog(page)).seats).toBe(0);

  // Stop is named for its watch in full, and its sheet says which one.
  await card.getByRole("button", { name: /^Stop watching: HKG → SEA, Sep 1 – 30/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Sep 1 – 30");
  await page.getByRole("button", { name: "Keep this watch" }).click();

  await card.getByRole("link", { name: /^Edit watch: / }).click();
  await page.getByRole("switch", { name: "Nonstop only" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("dialog")).toContainText("Your changes to this watch have not been saved.");
  await page.getByRole("button", { name: /Keep editing/ }).click();
  await page.getByLabel("Start").fill("2026-11-01");
  await page.getByLabel("End").fill("2026-11-15");
  // The status region must already be empty in the page when the words arrive, or they are not announced.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __statusAtMount: string[] }).__statusAtMount = seen;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement) for (const el of [n, ...n.querySelectorAll(".ag-watches-status")]) if (el.classList.contains("ag-watches-status")) seen.push(el.textContent ?? "");
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole("button", { name: "Save watch" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Watch saved. It starts again from these conditions." })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __statusAtMount: string[] }).__statusAtMount)).toEqual([""]);
  await expect(card).toContainText("Nov 1 – 15");
  await expect(card).not.toContainText("these dates have passed");
  await expect(card).toContainText("Not checked yet.");
  expect((await requestLog(page)).seats).toBe(0);
});

test("in Chinese: the platform line and the states speak Chinese", async ({ page }) => {
  await openScenario(page, "watch-baseline", "ios", { lang: "zh" });
  await expect.poll(async () => (await requestLog(page)).seats).toBeGreaterThanOrEqual(1);
  await tabs(page).getByRole("link", { name: "关注" }).click();
  await expect(page.getByText("打开或回到本应用时检查；关闭后不检查，不发送推送。")).toBeVisible();
  await expect(page.getByTestId("watch-card")).toContainText("基线已建立（刚刚）");
  await expect(page.getByRole("switch", { name: /关注中/ })).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: Watches with changes at 390`, async ({ page }) => {
    await openScenario(page, "watch-changes", "ios", { theme, lang: "zh" });
    await expect.poll(async () => (await requestLog(page)).seats).toBeGreaterThanOrEqual(1);
    await tabs(page).getByRole("link", { name: /关注/ }).click();
    await page.getByTestId("watch-card").getByText("变化").click();
    await evidenceShot(page, `t14-watches-${theme}`, { fullPage: true });
  });
}
