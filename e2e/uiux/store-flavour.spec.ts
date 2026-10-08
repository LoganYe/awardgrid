/**
 * The App Store flavour (apps/ios/src/app/flags.ts STORE and OAUTH, as `npm run build:store` builds it; release plan
 * steps 14-15 and 47F), on the fixture host served with UIUX_STORE=1 (project `ios-store`, playwright.uiux.config.ts).
 * Ask is compiled out: no way into it from Search or Settings, no Anthropic key page, `#/ask` and
 * `#/settings/anthropic` open Search, and nothing is ever sent to Anthropic. A seats.aero account is connected only
 * through seats.aero's own sign-in: the connect page has Connect seats.aero and no paste field, and the sign-in is
 * played in the page (fixture-host/transports.ts fixtureOAuth, the HTTP mock's own consent and token rules). The
 * wording is neutral: a seats.aero account, no API key to paste, no paid plan, nothing live. "Data: seats.aero" links
 * to seats.aero, beside seats.aero's data only. Everything else works as in the default build.
 */
import type { Page } from "@playwright/test";
import { oauthLog, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";
/** A search sample mode answers (apps/ios/src/sample): any route the app knows. */
const SAMPLE_TEXT = "Hong Kong to Seattle next month, business";

/** A paid plan, a purchase, an unlock or live data, in either language (the store-copy.test.ts deny-list). */
const PAID = /\bPro\b|Pro 密钥|subscri|订阅|upgrade|unlock|purchas|\bbuy\b|购买|解锁|付费|\bpaid\b|premium|trial|\blive (?:results|data)\b|实时结果/i;

/** Ask, Claude, Anthropic, the AI entry, or a note that no AI is used, in either language. */
const ASK_WORDS = /\bAsk\b|Anthropic|Claude|AI assistance|AI ?辅助|AI 对话|AI（可选）|AI \(optional\)|\bNo AI\b|不使用 AI/;

/** The paste-a-key connection, in either language (the store-copy.test.ts KEY list): none of it in this build. */
const KEY_WORDS = /API key|API tab|\bPaste\b|Check and save|Key on file|Remove key|API 密钥|API 页|粘贴|检查并保存|已保存密钥|移除密钥/;

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

test("Disconnect asks first and says what it removes, and nothing about AI", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await tab(page, "Settings").click();
  await expect(page.locator("#settings-row-seats")).toContainText("Connected");
  await page.locator("#settings-row-seats").click();
  await expect(page.getByText("Your seats.aero account is connected.")).toBeVisible();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Search stops until you connect again.");
  await expect(sheet).toContainText("Today's call count is kept.");
  await expect(sheet).not.toContainText(ASK_WORDS);
  await expect(sheet).not.toContainText(KEY_WORDS);
});

test("clearing the cache says what it keeps without naming Ask or a key", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await tab(page, "Settings").click();
  await expect(page.getByText("This does not touch your seats.aero connection.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Clear cached results" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cached results cleared. Your seats.aero connection is untouched." })).toBeVisible();
});

for (const l of [
  {
    lang: "en",
    connect: "Connect your seats.aero account",
    button: "Connect seats.aero",
    how: "Connect seats.aero opens seats.aero's own page, where seats.aero asks you to sign in and approve AwardGrid; AwardGrid never sees your password, and you can disconnect at any time, here or in your seats.aero settings.",
  },
  {
    lang: "zh",
    connect: "连接你的 seats.aero 账户",
    button: "连接 seats.aero",
    how: "“连接 seats.aero”会打开 seats.aero 自己的页面，由 seats.aero 请你登录并批准 AwardGrid；AwardGrid 不会看到你的密码，你也可以随时在这里或 seats.aero 设置中断开连接。",
  },
] as const) {
  test(`${l.lang}: the first run and the connect page offer seats.aero's own sign-in, with no paste field and no paid plan`, async ({ page }) => {
    await openScenario(page, "no-seats-key", "ios", { lang: l.lang });
    const welcome = page.getByTestId("welcome");
    await expect(welcome).not.toContainText(PAID);
    await expect(welcome).not.toContainText(KEY_WORDS);
    await welcome.getByRole("link", { name: l.connect }).click();
    await expect(page.getByRole("heading", { level: 1, name: l.connect })).toBeFocused();
    await expect(page.getByRole("button", { name: l.button, exact: true })).toBeEnabled();
    await expect(page.getByTestId("seats-connect-how")).toHaveText(l.how);
    // No paste field: no text or password input on the page at all, and none of its words.
    await expect(page.locator("main input")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(KEY_WORDS);
    await expect(page.locator("main")).not.toContainText(PAID);
    await expect(page.locator("main")).not.toContainText(ASK_WORDS);
    // Nothing is sent to draw the page.
    expect(await oauthLog(page)).toEqual({ consent: 0, token: 0, refresh: 0 });
    expect((await requestLog(page)).seats).toBe(0);
  });
}

test("Connect seats.aero: seats.aero's sign-in, the token service's exchange, then Search runs on the account", async ({ page }) => {
  await openScenario(page, "no-seats-key", "ios", { lang: "en" });
  await page.getByTestId("welcome").getByRole("link", { name: "Connect your seats.aero account" }).click();
  await page.getByRole("button", { name: "Connect seats.aero", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Connected. You can search now." })).toBeVisible();
  await expect(page.getByText("Your seats.aero account is connected.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect seats.aero", exact: true })).toHaveCount(0);
  expect(await oauthLog(page)).toEqual({ consent: 1, token: 1, refresh: 0 });
  await page.getByRole("link", { name: "Start searching" }).click();
  // The account is the scenario's first-run one, with no availability: seats.aero accepted the token and answered
  // with nothing (a refused token would say so instead).
  await searchByText(page, SEARCH_TEXT);
  await expect(page.getByText("No matches in the checked range.")).toBeVisible();
  await expect(page.getByTestId("results-status")).toContainText("Data: seats.aero");
  await expect(page.getByRole("alert").filter({ hasText: /did not accept|Connect your seats\.aero account again/ })).toHaveCount(0);
  expect((await requestLog(page)).seats).toBeGreaterThan(0);
  await tab(page, "Settings").click();
  await expect(page.locator("#settings-row-seats")).toContainText("Connected");
  await expect(page.locator("#settings-row-seats")).not.toContainText(KEY_WORDS);
});

for (const [mode, said] of [
  ["decline", "AwardGrid was not allowed to connect. Nothing was saved."],
  ["cancel", "Connecting was cancelled. Nothing was saved."],
] as const) {
  test(`a sign-in that ends in "${mode}" saves nothing, says so, and offers Connect again`, async ({ page }) => {
    await openScenario(page, "no-seats-key", "ios", { lang: "en", oauth: mode });
    await page.getByTestId("welcome").getByRole("link", { name: "Connect your seats.aero account" }).click();
    await page.getByRole("button", { name: "Connect seats.aero", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(said);
    await expect(page.getByRole("button", { name: "Connect seats.aero", exact: true })).toBeEnabled();
    expect((await oauthLog(page)).token).toBe(0);
    await tab(page, "Settings").click();
    await expect(page.locator("#settings-row-seats")).toContainText("Not connected");
  });
}

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

test("an account disconnected after a search: its results are removed; the welcome offers sample data or the account again", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  await tab(page, "Settings").click();
  await page.locator("#settings-row-seats").click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Disconnected. Results from seats.aero were removed from this device." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect seats.aero", exact: true })).toBeVisible();
  // Search is where the app starts again: the results went with the connection, so the welcome offers sample data
  // first, or the account.
  await tab(page, "Search").click();
  await expect(page.getByTestId("availability-list")).toHaveCount(0);
  const welcome = page.getByTestId("welcome");
  await expect(welcome.getByRole("link", { name: "Connect your seats.aero account" })).toBeVisible();
  await welcome.getByRole("button", { name: "Try with sample data" }).click();
  await expect(page.getByTestId("sample-banner")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
});

for (const lang of ["en", "zh"] as const) {
  test(`${lang}: no screen of the store build names a paid plan, live data, Ask or Anthropic, or asks for an API key`, async ({ page }) => {
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
      expect(text.match(KEY_WORDS)?.[0] ?? null, `${where}: ${text.slice(0, 200)}`).toBeNull();
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
