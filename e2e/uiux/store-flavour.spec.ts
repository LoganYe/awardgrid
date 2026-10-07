/**
 * The App Store flavour (apps/ios/src/app/flags.ts STORE; release plan steps 14-15), on the fixture host served with
 * UIUX_STORE=1 (project `ios-store`, playwright.uiux.config.ts). Ask is compiled out: no way into it from Search or
 * Settings, no Anthropic key page, `#/ask` and `#/settings/anthropic` open Search, and nothing is ever sent to
 * Anthropic. The wording is neutral: a seats.aero account and its API key, no paid plan, nothing live. "Data:
 * seats.aero" links to seats.aero, beside seats.aero's data only. Everything else works as in the default build.
 */
import type { Page } from "@playwright/test";
import { openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";
/** A search sample mode answers (apps/ios/src/sample): any route the app knows. */
const SAMPLE_TEXT = "Hong Kong to Seattle next month, business";

/** A paid plan, a purchase, an unlock or live data, in either language (the store-copy.test.ts deny-list). */
const PAID = /\bPro\b|Pro 密钥|subscri|订阅|upgrade|unlock|purchas|\bbuy\b|购买|解锁|付费|\bpaid\b|premium|trial|\blive (?:results|data)\b|实时结果/i;

/** Ask, Claude, Anthropic, the AI entry, or a note that no AI is used, in either language. */
const ASK_WORDS = /\bAsk\b|Anthropic|Claude|AI assistance|AI ?辅助|AI 对话|AI（可选）|AI \(optional\)|\bNo AI\b|不使用 AI/;

const tab = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true });

test("Search: the results carry no way into Ask, in the header or under the results", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  await expect(page.getByTestId("availability-list")).toBeVisible();
  await expect(page.getByRole("button", { name: "Watch this search" })).toBeVisible();
  await expect(page.locator('a[href="#/ask"]')).toHaveCount(0);
  await expect(page.getByTestId("results-header")).toHaveText("Search");
  await expect(page.locator("main")).not.toContainText(ASK_WORDS);
  expect((await requestLog(page)).anthropic).toBe(0);
});

test("an address of Ask's, typed or left over, opens Search", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  for (const hash of ["#/ask", "#/settings/anthropic", "#/no-such-page"]) {
    await page.evaluate((h) => (location.hash = h), hash);
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
    await expect(page).toHaveURL(/#\/$/);
  }
  expect((await requestLog(page)).anthropic).toBe(0);
});

for (const [lang, settings, groups] of [
  ["en", "Settings", ["Data connection", "Appearance and language", "Local data", "About"]],
  ["zh", "设置", ["数据连接", "外观与语言", "本地数据", "关于"]],
] as const) {
  test(`${lang}: Settings has no AI group, no Anthropic row, and names neither Ask nor Anthropic`, async ({ page }) => {
    await openScenario(page, "complete", "ios", { lang });
    await tab(page, settings).click();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([...groups]);
    await expect(page.locator("#settings-row-anthropic")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(ASK_WORDS);
    expect((await requestLog(page)).anthropic).toBe(0);
  });
}

test("the seats.aero key's removal sheet says what it affects, and nothing about AI", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await tab(page, "Settings").click();
  await page.locator("#settings-row-seats").click();
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Search stops until you add a key again.");
  await expect(sheet).toContainText("Today's call count is kept.");
  await expect(sheet).not.toContainText(ASK_WORDS);
});

test("clearing the cache says what it keeps without naming Ask", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await tab(page, "Settings").click();
  await expect(page.getByText("This does not touch your seats.aero key.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Clear cached results" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cached results cleared. Your seats.aero key is untouched." })).toBeVisible();
});

for (const l of [
  {
    lang: "en",
    connect: "Connect your seats.aero account",
    label: "seats.aero API key",
    placeholder: "Paste your seats.aero API key",
    where: "No API tab in your seats.aero settings? Then your account has no API access, and AwardGrid shows sample data only.",
  },
  {
    lang: "zh",
    connect: "连接你的 seats.aero 账户",
    label: "seats.aero API 密钥",
    placeholder: "粘贴你的 seats.aero API 密钥",
    where: "seats.aero 设置中没有 API 页？说明你的账户没有 API 访问权限，AwardGrid 只显示示例数据。",
  },
] as const) {
  test(`${l.lang}: the first run and the connect page speak of an account and its API key, never of a paid plan`, async ({ page }) => {
    await openScenario(page, "no-seats-key", "ios", { lang: l.lang });
    const welcome = page.getByTestId("welcome");
    await expect(welcome).not.toContainText(PAID);
    await welcome.getByRole("link", { name: l.connect }).click();
    await expect(page.getByRole("heading", { level: 1, name: l.connect })).toBeFocused();
    const field = page.getByLabel(l.label, { exact: true });
    await expect(field).toHaveAttribute("placeholder", l.placeholder);
    await expect(page.getByText(l.where)).toBeVisible();
    await expect(page.locator("main")).not.toContainText(PAID);
    await expect(page.locator("main")).not.toContainText(ASK_WORDS);
  });
}

test("a key seats.aero does not accept: says to check it was copied whole, and nothing was saved", async ({ page }) => {
  await openScenario(page, "no-seats-key", "ios", { lang: "en" });
  await page.getByTestId("welcome").getByRole("link", { name: "Connect your seats.aero account" }).click();
  await page.getByLabel("seats.aero API key", { exact: true }).fill("fixture-invalid-key");
  await page.getByRole("button", { name: "Check and save", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "seats.aero did not accept this key. Check that you copied all of it from the API tab of your seats.aero settings, then try again. Nothing was saved.",
  );
});

test("Data: seats.aero links to seats.aero beside seats.aero's data, and nowhere else", async ({ page }) => {
  const seatsLink = (scope: ReturnType<Page["locator"]>) => scope.getByRole("link", { name: "seats.aero Opens in Safari", exact: true });
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  const status = page.getByTestId("results-status");
  await expect(status).toContainText("Data: seats.aero");
  await expect(seatsLink(status)).toHaveAttribute("href", "https://seats.aero");
  await expect(seatsLink(status)).toHaveAttribute("target", "_blank");
  // An option's details, over the results.
  await page.getByTestId("availability-list").getByTestId("availability-card").first().getByRole("button", { name: /^View option/ }).click();
  await expect(seatsLink(page.locator(".ag-detail-meta").filter({ hasText: "Data: seats.aero" }))).toHaveAttribute("href", "https://seats.aero");
  await page.keyboard.press("Escape");
  // The comparison, over the results too.
  const boxes = page.getByTestId("availability-list").getByRole("checkbox");
  for (let i = 0; i < 2; i++) await boxes.nth(i).check();
  await page.getByRole("link", { name: "Compare selected options" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compare selected options" })).toBeFocused();
  await expect(seatsLink(page.locator(".ag-compare-note").filter({ hasText: "Data: seats.aero" }))).toHaveAttribute("href", "https://seats.aero");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  // Watches and Saved carry it at their end; Settings and its pages do not.
  await tab(page, "Watches").click();
  await expect(seatsLink(page.locator(".app-attribution"))).toHaveAttribute("href", "https://seats.aero");
  await tab(page, "Saved").click();
  await expect(seatsLink(page.locator(".app-attribution"))).toHaveAttribute("href", "https://seats.aero");
  await tab(page, "Settings").click();
  await expect(page.locator(".ag-attribution-link")).toHaveCount(0);
  await page.locator("#settings-row-seats").click();
  await expect(page.locator(".ag-attribution-link")).toHaveCount(0);
  // Nothing was opened: the link is never followed here.
  expect((await requestLog(page)).anthropic).toBe(0);
});

test("sample data, made up, carries no seats.aero attribution and names no paid plan (release plan step 17)", async ({ page }) => {
  await openScenario(page, "no-seats-key", "ios", { lang: "en" });
  await page.getByTestId("welcome").getByRole("button", { name: "Try with sample data" }).click();
  await expect(page.getByTestId("sample-banner")).toBeVisible();
  await searchByText(page, SAMPLE_TEXT);
  await expect(page.getByTestId("availability-list")).toBeVisible();
  await expect(page.locator(".ag-attribution-link, .app-attribution")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(PAID);
  await expect(page.locator("main")).not.toContainText(ASK_WORDS);
});

test("an account removed after a search: try sample data, or connect it again in Settings", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  await tab(page, "Settings").click();
  await page.locator("#settings-row-seats").click();
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await tab(page, "Search").click();
  const callout = page.getByRole("alert").filter({ hasText: "No seats.aero account connected." });
  await expect(callout).toHaveText("No seats.aero account connected. Try sample data, or connect your seats.aero account in Settings.");
  await callout.getByRole("link", { name: "Try sample data" }).click();
  await expect(page.getByTestId("sample-banner")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
});

for (const lang of ["en", "zh"] as const) {
  test(`${lang}: no screen of the store build names a paid plan, live data, Ask or Anthropic`, async ({ page }) => {
    const settings = lang === "en" ? "Settings" : "设置";
    const watches = lang === "en" ? "Watches" : "关注";
    const saved = lang === "en" ? "Saved" : "收藏";
    await openScenario(page, "complete", "ios", { lang });
    await searchByText(page, SEARCH_TEXT);
    // `ignore`: words a screen shows that only look like the deny-lists' (the editor's cabin "Premium economy").
    const checkScreen = async (where: string, ignore?: RegExp) => {
      const shown = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const text = ignore ? shown.replace(ignore, "") : shown;
      expect(text.match(PAID)?.[0] ?? null, `${where}: ${text.slice(0, 200)}`).toBeNull();
      expect(text.match(ASK_WORDS)?.[0] ?? null, `${where}: ${text.slice(0, 200)}`).toBeNull();
    };
    await checkScreen("search");
    for (const [name, path] of [
      [watches, "watches"],
      [saved, "saved"],
      [settings, "settings"],
    ] as const) {
      await tab(page, name).click();
      await expect(page).toHaveURL(new RegExp(`#/${path}$`));
      await checkScreen(path);
    }
    await page.locator("#settings-row-seats").click();
    await checkScreen("settings/seats");
    await page.evaluate(() => (location.hash = "#/edit"));
    await expect(page.getByRole("heading", { level: 1, name: lang === "en" ? "Edit search" : "编辑查询" })).toBeVisible();
    await checkScreen("edit", /Premium economy/g);
    // Not scanned: Settings › Licenses, which names @anthropic-ai/sdk among the packages that ship (a license notice,
    // not a feature: the SDK stays bundled with the Ask service this build never opens, release plan D3).
  });
}
