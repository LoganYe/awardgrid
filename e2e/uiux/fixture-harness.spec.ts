/**
 * T01 — the isolated fixture harness (plan 01 T01, acceptance A01).
 *
 * The fixture host mounts the real iOS `App` through the real `bootstrap()`, with fake ports passed in
 * explicitly: memory key stores, a namespaced browser file store, and synthetic seats.aero / Anthropic
 * transports. These tests pin what makes it safe to build every later UI test on it: a scenario must be named
 * explicitly and really seeded, nothing falls back, the counters count what the app actually tried, and
 * nothing leaves the machine (./test.ts fails any test that attempted a non-loopback request).
 */
import { expect, test } from "./test";
import { evidenceShot, openScenario, realHostPattern, requestLog, searchByText, takeExternalRequests } from "./helpers";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";

async function search(page: import("@playwright/test").Page, text = SEARCH_TEXT) {
  await searchByText(page, text);
}

/**
 * A result card showing these miles (T07: results are cards, in the query's sort order — cheapest first here — and
 * the older grid is the Matrix view). Which card it is does not matter to the harness; that it came through does.
 */
const cardMiles = (page: import("@playwright/test").Page, miles: string) => page.getByTestId("availability-card").getByTestId("card-miles").filter({ hasText: miles });

test("fixture entry is explicit and does not call paid APIs", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (req) => {
    if (/^https:\/\/(seats\.aero|api\.anthropic\.com)\//.test(req.url())) external.push(req.url());
  });
  await openScenario(page, "no-seats-key", "ios", { lang: "zh" });
  await expect(page.getByTestId("fixture-ready")).toHaveAttribute("data-state", "ready");
  expect((await requestLog(page)).anthropic).toBe(0);
  expect(external).toEqual([]);
  // Beyond the plan's snippet: every paid counter, and the requested language is recorded by the host. The host
  // does not apply it; the app does, from the device language it is given, on <html> since T11.
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0, trips: 0 });
  await expect(page.getByTestId("fixture-ready")).toHaveAttribute("data-lang", "zh");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("zh-CN");
});

test("an unknown scenario id is refused before any page is opened", async ({ page }) => {
  await expect(openScenario(page, "not-a-scenario")).rejects.toThrow(/Unknown synthetic scenario: not-a-scenario/);
  expect(page.url()).toBe("about:blank");
});

test("the host refuses a missing, unknown or unseeded scenario and never mounts the app", async ({ page }) => {
  const cases: Array<[string, RegExp]> = [
    ["", /No scenario given/],
    ["?scenario=not-a-scenario", /Unknown synthetic scenario/],
    // A real id whose state is not built yet is refused, not booted as the base environment.
    ["?scenario=ai-stopped", /not seeded by the fixture host yet \(T17/],
  ];
  for (const [query, reason] of cases) {
    await page.goto(`/${query}`);
    await expect(page.getByTestId("fixture-ready")).toHaveAttribute("data-state", "error");
    await expect(page.getByTestId("fixture-ready")).toHaveText(reason);
    // Nothing mounts later either: no root marker, no children, no scenario, well after the refusal.
    await page.waitForTimeout(750);
    expect(await page.evaluate(() => document.getElementById("root")!.childElementCount)).toBe(0);
    expect(await page.evaluate(() => document.getElementById("root")!.dataset.mounted ?? null)).toBeNull();
    expect(await page.evaluate(() => window.__uiuxFixture?.scenario ?? null)).toBeNull();
  }
  await expect(openScenario(page, "ai-stopped")).rejects.toThrow(/not seeded/);
});

test("no-seats-key boots the real app without a key and sends nothing", async ({ page }) => {
  await openScenario(page, "no-seats-key");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  // The shell's own no-key state (the T11 first run): connect first or see a marked example; there is no search to
  // run, and nothing is invented to fill the screen.
  await expect(page.getByTestId("welcome").getByRole("link", { name: "Connect seats.aero" })).toBeVisible();
  await expect(page.getByTestId("text-search-run")).toHaveCount(0);
  await expect(page.getByTestId("availability-list")).toHaveCount(0);
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0, trips: 0 });
  await evidenceShot(page, "t01-host-no-seats-key");
});

test("a search in the complete scenario goes through the synthetic transport, never a real host", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (req) => {
    if (realHostPattern.test(req.url())) external.push(req.url());
  });
  await openScenario(page, "complete");
  await search(page);
  // The row came from the synthetic payload through the production parse → runFind → normalize → snapshot path.
  await expect(cardMiles(page, "75,000")).toBeVisible();
  const log = await requestLog(page);
  expect(log.seats).toBeGreaterThanOrEqual(1);
  expect(log.trips).toBe(0);
  expect(log.anthropic).toBe(0);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => window.__uiuxFixture!.log.seatsPaths)).toContain("GET search");
  await evidenceShot(page, "t01-host-complete-search");
});

test("the Anthropic counter sees the app's real Anthropic path (positive control)", async ({ page }) => {
  // Without this, every `anthropic: 0` above could be vacuous. Saving a key makes the app check it, which sends
  // one request through the injected Anthropic transport; the fixture transport refuses it without sending.
  await openScenario(page, "complete");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /Anthropic API key/ }).click();
  await page.getByRole("textbox", { name: "Anthropic API key" }).fill("fixture-typed-anthropic-key");
  await page.getByRole("button", { name: "Save Anthropic key" }).click();
  await expect.poll(async () => (await requestLog(page)).anthropic).toBeGreaterThanOrEqual(1);
  expect((await requestLog(page)).seats).toBe(0);
});

test("storage: preserveStorage relaunches onto saved state; a default launch starts empty", async ({ page }) => {
  await openScenario(page, "complete");
  await search(page);
  expect((await requestLog(page)).seats).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k === "uiux-fixture:files:cache.json"))).toBe(true);

  // Relaunch keeping storage: the cache restored from the file store answers the same search with no call.
  await openScenario(page, "complete", "ios", { preserveStorage: true });
  await search(page);
  await expect(cardMiles(page, "75,000")).toBeVisible();
  expect((await requestLog(page)).seats).toBe(0);

  // Relaunch without it: the namespace was emptied, so the same search costs a call again.
  await openScenario(page, "complete");
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("uiux-fixture:files:")).length)).toBeLessThanOrEqual(1);
  await search(page);
  expect((await requestLog(page)).seats).toBe(1);
});

test("each seeded scenario applies its defining state", async ({ page }) => {
  // complete-empty: a successful, checked, empty range — not "unmonitored", not an error.
  await openScenario(page, "complete-empty");
  await search(page);
  await expect(page.getByText("No matches in the checked range.")).toBeVisible();

  // unmonitored: the provider's route catalog does not list the pair.
  await openScenario(page, "unmonitored");
  await search(page);
  await expect(page.getByText("These routes are not monitored by the data source.")).toBeVisible();

  // quota-low: the soft limit is already used, so the search is refused before any call is sent.
  await openScenario(page, "quota-low");
  await expect(page.getByText("seats.aero calls today: 950 of 950")).toBeVisible();
  await search(page);
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await requestLog(page)).seats).toBe(0);

  // no-ai-key: ordinary search works with no Anthropic key at all.
  await openScenario(page, "no-ai-key");
  await search(page);
  await expect(cardMiles(page, "75,000")).toBeVisible();
  expect((await requestLog(page)).anthropic).toBe(0);

  // multi-program: the override row is served as a second program.
  await openScenario(page, "multi-program");
  await search(page, "Synthetic HKG to SEA October business");
  await expect(page.getByTestId("availability-card").filter({ hasText: "American Airlines AAdvantage" })).toHaveCount(1);

  // storage-failure: the app's writes are attempted and all fail; nothing lands in storage.
  await openScenario(page, "storage-failure");
  await search(page);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(async () => (await requestLog(page)).writes).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("uiux-fixture:files:")))).toEqual([]);
});

test("the page has no `process` global, as on the phone", async ({ page }) => {
  await openScenario(page, "complete");
  expect(await page.evaluate(() => typeof (globalThis as { process?: unknown }).process)).toBe("undefined");
});

test("leaks are caught: a direct WebView fetch is counted, and a stray request is blocked and recorded", async ({ page }) => {
  await openScenario(page, "complete");
  // The WebView fetch guard refuses this before it exists; the host counts it as an Anthropic attempt.
  await page.evaluate(() => fetch("https://api.anthropic.com/v1/messages").catch(() => undefined));
  // An image is not fetch(): the context lockdown aborts and records it, trailing-dot host and all.
  await page.evaluate(() => {
    const img = document.createElement("img");
    img.src = "https://seats.aero./partnerapi/trips/leak";
    document.body.append(img);
  });
  await expect.poll(async () => (await requestLog(page)).trips).toBe(1);
  const log = await requestLog(page);
  expect(log.anthropic).toBe(1);
  expect(log.seats).toBe(1);
  // Taken here on purpose; any other external request would still fail this test at teardown.
  expect(takeExternalRequests(page)).toEqual(["https://seats.aero./partnerapi/trips/leak"]);
});
