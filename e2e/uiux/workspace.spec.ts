/**
 * T05 — the versioned workspace in the real app (plan 01 T05; acceptance A08, A09), on the T07 results screen.
 *
 * `failed-old` and `inflight-old` launch with a workspace saved by an earlier launch (one snapshot, two synthetic
 * rows) and a seats.aero stand-in that fails, or never answers, a new search. The screen must keep the previous
 * results, say that they are the previous results, and never fetch just to show them.
 */
import type { Page } from "@playwright/test";
import { evidenceShot, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";
/** The saved snapshot's text in failed-old / inflight-old: the editor's sentence for the synthetic query. */
const SAVED_TEXT = "HKG to SEA, 2026-10-01 to 2026-10-30, business and first, on Air Canada Aeroplan";

/** Start a typed search from the results (through the editor) without waiting for it: it may never answer. */
async function startSearch(page: Page, text: string) {
  await page.getByTestId("query-summary").getByRole("link").click();
  await page.locator("#q").fill(text);
  await page.getByRole("button", { name: /^Run/ }).click();
}

const cards = (page: Page) => page.getByTestId("availability-list");
const status = (page: Page) => page.getByTestId("results-status");
const summary = (page: Page) => page.getByTestId("query-summary");

test("a relaunch shows the saved snapshot, labelled as saved, and sends nothing", async ({ page }) => {
  await openScenario(page, "failed-old");
  await expect(cards(page).getByText("75,000")).toBeVisible();
  // Dated by the app's clock: the snapshot was saved two hours before the scenario's "now".
  await expect(status(page)).toContainText("saved on this device 2 h ago");
  const log = await requestLog(page);
  expect(log.seats).toBe(0);
  expect(log.anthropic).toBe(0);
});

test("failed-old: a failed new search keeps the previous results with their own query, and says the new one failed", async ({ page }) => {
  await openScenario(page, "failed-old");
  await expect(cards(page).getByText("75,000")).toBeVisible();
  await searchByText(page, "HKG to SEA next 30 days business");
  await expect(page.getByText("Showing previous results; the new search failed.")).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(cards(page).getByText("75,000")).toBeVisible();
  await expect(status(page)).toContainText("saved on this device");
  // The summary names the query the results on screen answer, not the one that failed.
  await expect(summary(page).locator(".ag-query-summary-sub")).toHaveText("Oct 1 – 30 · Business, First · 1 program");
  // Watching watches the search on screen, not the one that failed.
  await page.getByRole("button", { name: "Watch this search" }).click();
  await expect(page.getByText("Watching this search.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("uiux-fixture:files:watches.json") ?? "")).toContain(SAVED_TEXT);
  const log = await requestLog(page);
  expect(log.seats).toBeGreaterThanOrEqual(1);
  expect(log.anthropic).toBe(0);
  await evidenceShot(page, "t05-failed-old", { fullPage: true });
});

test("inflight-old: while a new search runs, the previous results stay and are labelled", async ({ page }) => {
  await openScenario(page, "inflight-old");
  await expect(cards(page).getByText("75,000")).toBeVisible();
  await startSearch(page, SEARCH_TEXT);
  await expect(page.getByText("Searching; previous results remain available.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Search again/ })).toHaveAttribute("aria-busy", "true");
  await expect(cards(page).getByText("75,000")).toBeVisible();
  expect((await requestLog(page)).anthropic).toBe(0);
  await evidenceShot(page, "t05-inflight-old", { fullPage: true });

  // Leaving for Ask and coming back mid-search shows the same state: it is the workspace's, not the screen's.
  await page.getByTestId("results-header").getByRole("link", { name: /^AI assistance/ }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Search" }).click();
  await expect(page.getByText("Searching; previous results remain available.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Search again/ })).toHaveAttribute("aria-busy", "true");
  await expect(cards(page).getByText("75,000")).toBeVisible();
});

test("a search becomes the shown snapshot, is saved in the workspace's own file, and a relaunch shows it without a call", async ({ page }) => {
  await openScenario(page, "complete");
  await searchByText(page, SEARCH_TEXT);
  await expect(cards(page).getByText("75,000")).toBeVisible();
  // A fresh answer: neither run label, and not presented as a saved snapshot.
  await expect(page.getByText("Searching; previous results remain available.")).toHaveCount(0);
  await expect(page.getByText("Showing previous results; the new search failed.")).toHaveCount(0);
  await expect(status(page)).not.toContainText("saved on this device");
  expect((await requestLog(page)).seats).toBe(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("uiux-fixture:files:workspace-v1.a.json") !== null)).toBe(true);
  const saved = await page.evaluate(() => localStorage.getItem("uiux-fixture:files:workspace-v1.a.json") ?? "");
  expect(saved).not.toContain("fixture-not-a-real-key");

  await openScenario(page, "complete", "ios", { preserveStorage: true });
  await expect(cards(page).getByText("75,000")).toBeVisible();
  await expect(status(page)).toContainText("saved on this device just now");
  expect((await requestLog(page)).seats).toBe(0);
});
