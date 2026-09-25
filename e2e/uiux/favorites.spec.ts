/**
 * T13: saved snapshots (plan 03 T13; docs/04 S06; acceptance A23).
 *
 * Saving copies the results on screen to this device. The Saved tab lists them with the fixed "Saved snapshot;
 * availability may change."; opening one fetches nothing, even after a relaunch; searching again shows the
 * conditions first and runs only when confirmed. Deleting can be undone for 5 seconds. A full store refuses and keeps
 * everything; a store that cannot be written says so and keeps what was saved.
 */
import type { Page } from "@playwright/test";
import { evidenceShot, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";
const NOTE = "Saved snapshot; availability may change.";

const tab = (page: Page, name: string) => page.getByRole("navigation", { name: /Main navigation|主导航/ }).getByRole("link", { name, exact: true });

async function saveFromSearch(page: Page) {
  await searchByText(page, SEARCH_TEXT);
  await page.getByRole("button", { name: "Save results", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved on this device." })).toBeVisible();
}

test("the tab bar has four tabs: Search, Watches, Saved, Settings", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link")).toHaveText(["Search", "Watches", "Saved", "Settings"]);
});

test("saving copies the results on screen; Saved lists it with the fixed note; opening it sends nothing", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await saveFromSearch(page);
  const sent = await requestLog(page);
  // Saving the same results again is the one item already there.
  await page.getByRole("button", { name: "Save results", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "These results are already saved." })).toBeVisible();

  // "View in Saved" lands on the Saved title (the link that opened it is gone).
  await page.getByRole("link", { name: "View in Saved" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Saved" })).toBeFocused();
  const cards = page.getByTestId("favorite-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("HKG → SEA");
  await expect(cards.first()).toContainText("4 options when saved");
  await expect(cards.first()).toContainText(NOTE);
  await expect(cards.first()).toContainText(/Saved \w{3} \d{1,2}, \d{2}:\d{2}/);
  // By count and by size: either limit can be the one that fills.
  await expect(page.getByText(/^1 of 100 saved · 0\.\d of 5\.0 MB$/)).toBeVisible();
  // At least 156 tall, 16 corners.
  expect((await cards.first().boundingBox())!.height).toBeGreaterThanOrEqual(156);

  await cards.first().getByRole("link", { name: /^Open saved results: / }).click();
  await expect(page.getByTestId("saved-snapshot")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(page.getByTestId("saved-snapshot")).toContainText(NOTE);
  const list = page.getByTestId("saved-list");
  await expect(list.getByTestId("availability-card")).toHaveCount(4);
  // Read only: nothing to choose for comparison from a saved copy.
  await expect(list.getByRole("checkbox")).toHaveCount(0);
  expect(await requestLog(page)).toEqual(sent);

  // Back to Saved: focus on the item's Open.
  await page.getByRole("link", { name: "Back to Saved" }).click();
  await expect(cards.first().getByRole("link", { name: /^Open saved results: / })).toBeFocused();
});

test("the save line belongs to the results it was said of: after a new search it is gone", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await saveFromSearch(page);
  await searchByText(page, SEARCH_TEXT);
  await expect(page.getByText("Saved on this device.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View in Saved" })).toHaveCount(0);
});

test("a saved snapshot from an earlier launch opens offline, with its partial coverage said, nothing fetched, the quota untouched", async ({ page }) => {
  await openScenario(page, "favorite-snapshot", "ios", { lang: "en" });
  await tab(page, "Saved").click();
  await expect(page.getByTestId("favorite-card")).toHaveCount(1);
  await page.getByRole("link", { name: /^Open saved results: / }).click();
  const saved = page.getByTestId("saved-snapshot");
  await expect(saved).toContainText(NOTE);
  await expect(saved.getByTestId("availability-card")).toHaveCount(2);
  // Partial when saved: said, not claimed complete.
  await expect(saved).toContainText("Results are incomplete. Not checked to the end: HKG → SEA.");
  expect(await requestLog(page)).toMatchObject({ seats: 0, trips: 0, anthropic: 0 });
  // The quota file is untouched: nothing was spent to show it.
  expect(await page.evaluate(() => localStorage.getItem("uiux-fixture:files:quota.json"))).toBeNull();
});

test("search again from a saved snapshot shows the conditions first and runs only when confirmed", async ({ page }) => {
  await openScenario(page, "favorite-snapshot", "ios", { lang: "en" });
  await tab(page, "Saved").click();
  await page.getByRole("link", { name: /^Open saved results: / }).click();
  await page.getByRole("button", { name: "Search again", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Search again with these conditions?" });
  await expect(sheet).toContainText("HKG → SEA");
  // With the year, and what has already passed (the scenario's today is Oct 18; the dates start Oct 1).
  await expect(sheet).toContainText("2026-10-01 to 2026-10-30");
  await expect(sheet).toContainText("Some of these dates have passed");
  await expect(sheet).toContainText("It sends requests to seats.aero with your key");
  await sheet.getByRole("button", { name: "Not now" }).click();
  expect((await requestLog(page)).seats).toBe(0);

  await page.getByRole("button", { name: "Search again", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".ag-results[data-run]")).toHaveAttribute("data-run", /finished|failed/);
  expect((await requestLog(page)).seats).toBeGreaterThanOrEqual(1);
  // The saved copy is as it was.
  await tab(page, "Saved").click();
  await expect(page.getByTestId("favorite-card")).toContainText("2 options when saved");
});

test("deleting is said with the way back: focus on Undo, which puts it back in its place", async ({ page }) => {
  await openScenario(page, "favorite-snapshot", "ios", { lang: "en" });
  await tab(page, "Saved").click();
  const card = page.getByTestId("favorite-card");
  await card.getByRole("button", { name: /^Delete saved results: / }).click();
  await expect(card).toHaveCount(0);
  const bar = page.getByTestId("undo-bar");
  await expect(bar).toContainText("Deleted.");
  await expect(page.getByRole("status").filter({ hasText: "Deleted. Undo is available for 5 seconds." })).toBeVisible();
  const undo = bar.getByRole("button", { name: "Undo" });
  await expect(undo).toBeFocused();
  await undo.click();
  await expect(card).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: "Restored." })).toBeVisible();
  await expect(card.getByRole("link", { name: /^Open saved results: / })).toBeFocused();
});

test("the undo lasts 5 seconds, held while focus is on it; after that it is gone, focus is not dropped, and a relaunch agrees", async ({ page }) => {
  await page.clock.install();
  await openScenario(page, "favorite-snapshot", "ios", { lang: "en" });
  await tab(page, "Saved").click();
  await page.getByTestId("favorite-card").getByRole("button", { name: /^Delete saved results: / }).click();
  const bar = page.getByTestId("undo-bar");
  await expect(bar.getByRole("button", { name: "Undo" })).toBeFocused();
  // Held while focus is on it.
  await page.clock.fastForward(8000);
  await expect(bar).toBeVisible();
  // Focus elsewhere: 5 seconds, then gone.
  await page.getByRole("heading", { level: 1, name: "Saved" }).focus();
  await page.clock.fastForward(4800);
  await expect(bar).toBeVisible({ timeout: 0 });
  await page.clock.fastForward(400);
  await expect(bar).toHaveCount(0);
  // The empty page: what saving is for, and the way to Search; no made-up saved items.
  await expect(page.getByRole("heading", { name: "Nothing saved yet" })).toBeVisible();
  expect((await page.getByRole("link", { name: "Go to Search" }).boundingBox())!.height).toBeGreaterThanOrEqual(48);

  // A relaunch keeping storage: still deleted. (The scenario's seed is written to the first slot again at launch, but
  // the deletion is a newer generation in the other slot, which is what the app reads.)
  await openScenario(page, "favorite-snapshot", "ios", { lang: "en", preserveStorage: true });
  await tab(page, "Saved").click();
  await expect(page.getByRole("heading", { name: "Nothing saved yet" })).toBeVisible();
  expect((await requestLog(page)).seats).toBe(0);
});

test("dates that have all passed: the sheet says so and offers to change them, not to search", async ({ page }) => {
  await openScenario(page, "favorite-snapshot", "ios", { lang: "en" });
  await page.evaluate(() => {
    const key = "uiux-fixture:files:favorites-v1.a.json";
    const slot = JSON.parse(localStorage.getItem(key)!) as { generation: number; value: { items: Array<{ query: Record<string, unknown> }> } };
    slot.value.items[0]!.query = { ...slot.value.items[0]!.query, date_from: "2026-09-01", date_to: "2026-09-30" };
    localStorage.setItem(key, JSON.stringify({ generation: 7, value: slot.value }));
  });
  await openScenario(page, "complete", "ios", { lang: "en", preserveStorage: true });
  await tab(page, "Saved").click();
  await page.getByRole("link", { name: /^Open saved results: / }).click();
  await page.getByRole("button", { name: "Search again", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("2026-09-01 to 2026-09-30");
  await expect(sheet).toContainText("These dates have passed. Change the dates to search again.");
  await expect(sheet.getByRole("button", { name: "Search", exact: true })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Change the dates" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edit search" })).toBeVisible();
  await expect(page.getByLabel("Start")).toHaveValue("2026-09-01");
  expect((await requestLog(page)).seats).toBe(0);
});

test("without a key, Search again is off and says where to add one; nothing is sent", async ({ page }) => {
  await openScenario(page, "favorite-snapshot", "ios", { lang: "en" });
  await tab(page, "Settings").click();
  await page.getByRole("link", { name: /seats\.aero Pro key/ }).click();
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await tab(page, "Saved").click();
  await page.getByRole("link", { name: /^Open saved results: / }).click();
  await expect(page.getByRole("button", { name: "Search again", exact: true })).toBeDisabled();
  await page.getByRole("link", { name: "Add a key in Settings" }).click();
  await expect(page.getByLabel("seats.aero Pro key")).toBeVisible();
  expect((await requestLog(page)).seats).toBe(0);
});

test("saved items this version cannot read are kept and said; a newer version's file leaves the store read-only, not 'empty'", async ({ page }) => {
  await openScenario(page, "favorite-snapshot", "ios", { lang: "en" });
  await page.evaluate(() => {
    const key = "uiux-fixture:files:favorites-v1.a.json";
    const slot = JSON.parse(localStorage.getItem(key)!) as { generation: number; value: { items: unknown[] } };
    slot.value.items.push({ schemaVersion: 1, id: "from-another-build", query: { odd: true } });
    localStorage.setItem(key, JSON.stringify({ generation: 7, value: slot.value }));
  });
  await openScenario(page, "complete", "ios", { lang: "en", preserveStorage: true });
  await tab(page, "Saved").click();
  await expect(page.getByTestId("favorite-card")).toHaveCount(1);
  await expect(page.getByText("1 saved item could not be read by this version of the app; it is kept as it is.")).toBeVisible();

  await page.evaluate(() => {
    localStorage.setItem("uiux-fixture:files:favorites-v1.a.json", JSON.stringify({ generation: 9, value: { schemaVersion: 2, items: [{ anything: true }] } }));
  });
  await openScenario(page, "complete", "ios", { lang: "en", preserveStorage: true });
  await tab(page, "Saved").click();
  await expect(page.getByText(/Saved results from a newer version of the app/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nothing saved yet" })).toHaveCount(0);
  // And it is left as it was.
  expect(await page.evaluate(() => localStorage.getItem("uiux-fixture:files:favorites-v1.a.json"))).toContain('"schemaVersion":2');
});

test("a full store refuses a new save with the approved sentence, and keeps every saved item", async ({ page }) => {
  // One hundred saved items, written as the device writes them.
  await openScenario(page, "favorite-snapshot", "ios", { lang: "en" });
  await page.evaluate(() => {
    const key = "uiux-fixture:files:favorites-v1.a.json";
    const slot = JSON.parse(localStorage.getItem(key)!) as { generation: number; value: { schemaVersion: 1; items: Array<Record<string, unknown>> } };
    const one = slot.value.items[0]!;
    slot.value.items = Array.from({ length: 100 }, (_, i) => ({ ...one, id: `fixture-favorite-${i}`, originalSnapshotId: `fixture-snapshot-${i}` }));
    localStorage.setItem(key, JSON.stringify({ generation: 5, value: slot.value }));
  });
  await openScenario(page, "complete", "ios", { lang: "en", preserveStorage: true });
  await searchByText(page, SEARCH_TEXT);
  await page.getByRole("button", { name: "Save results", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Saved storage is full. Remove an item before saving." })).toBeVisible();
  await tab(page, "Saved").click();
  await expect(page.getByText("100 of 100 saved")).toBeVisible();
  await expect(page.getByTestId("favorite-card")).toHaveCount(100);
});

test("a store that cannot be written: saving says so and changes nothing; the app says a save failed and offers to try again", async ({ page }) => {
  await openScenario(page, "storage-failure", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  // The search's own save failed: said above the tab bar, with a way to try again; the results stay on screen.
  const problem = page.locator(".app-save-problem");
  await expect(problem).toContainText("Some changes could not be saved on this device");
  await expect(page.getByTestId("availability-list")).toBeVisible();
  const writes = (await requestLog(page)).writes;
  await problem.getByRole("button", { name: "Try saving again" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Still could not save." })).toBeAttached();
  expect((await requestLog(page)).writes).toBeGreaterThan(writes);
  await expect(problem).toBeVisible();
  // The storage's own words are there on request; the bar stays one line.
  await problem.getByText("Details").click();
  await expect(problem).toContainText(/refused a write/);

  await page.getByRole("button", { name: "Save results", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Could not save on this device; nothing already saved was changed" })).toBeVisible();
  await tab(page, "Saved").click();
  await expect(page.getByRole("heading", { name: "Nothing saved yet" })).toBeVisible();
});

test("in Chinese: the tab, the note and the list speak Chinese", async ({ page }) => {
  await openScenario(page, "favorite-snapshot", "ios", { lang: "zh" });
  await tab(page, "收藏").click();
  await expect(page.getByRole("heading", { level: 1, name: "收藏" })).toBeVisible();
  await expect(page.getByTestId("favorite-card")).toContainText("收藏快照，库存可能变化。");
  await expect(page.getByTestId("favorite-card")).toContainText("收藏时 2 个选项");
  await expect(page.getByText("已收藏 1/100")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: Saved at 390`, async ({ page }) => {
    await openScenario(page, "favorite-snapshot", "ios", { theme, lang: "zh" });
    await tab(page, "收藏").click();
    await expect(page.getByTestId("favorite-card")).toBeVisible();
    await evidenceShot(page, `t13-saved-${theme}`);
    await page.getByRole("link", { name: /^打开收藏的结果：/ }).click();
    await expect(page.getByTestId("saved-snapshot")).toBeVisible();
    await evidenceShot(page, `t13-saved-snapshot-${theme}`);
    await page.getByRole("link", { name: "返回收藏" }).click();
    await page.getByRole("button", { name: /^删除收藏的结果：/ }).click();
    await expect(page.getByTestId("undo-bar")).toBeVisible();
    await evidenceShot(page, `t13-saved-undo-${theme}`);
  });
}
