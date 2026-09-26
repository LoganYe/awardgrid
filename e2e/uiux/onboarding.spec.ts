/**
 * T11 — settings, first run, both languages, and the keyboard (plan 02 T11; acceptance A20, A21).
 *
 * seats.aero comes first and the Anthropic key waits for the first AI entry; the clipboard is read only when the user
 * asks; checking a key says it sends a request before it does; a saved key shows its last four characters only. The
 * language can change at any time without losing what is on screen.
 *
 * Adapted from the plan's Step 1: "no-ai-key" starts with no results here (a search comes first), and "AI assistance"
 * in the Search header is a link.
 */
import type { Page } from "@playwright/test";
import { evidenceShot, fakeKeyboard, keyboard, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";

/** Count clipboard reads, so a test can prove the app never reads it on its own. */
async function watchClipboard(page: Page, text: string) {
  await page.addInitScript((value) => {
    const w = window as unknown as { __clipboardReads: number };
    w.__clipboardReads = 0;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => {
          w.__clipboardReads += 1;
          return value;
        },
        writeText: async () => {},
      },
    });
  }, text);
}
/** Whether the control is on top at its own centre and its bottom is above `limit` (the keyboard's top). */
async function reachableAbove(page: Page, name: string, limit: number) {
  const button = page.getByRole("button", { name, exact: true });
  // Brought up a frame after the keyboard opens (app/keyboard.ts): wait for it to settle.
  await expect.poll(async () => {
    const b = (await button.boundingBox())!;
    return b.y + b.height;
  }).toBeLessThanOrEqual(limit + 0.5);
  const box = (await button.boundingBox())!;
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest("button")?.textContent ?? null, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toContain(name);
}

const clipboardReads = (page: Page) => page.evaluate(() => (window as unknown as { __clipboardReads: number }).__clipboardReads);

test("missing AI key does not block existing search results", async ({ page }) => {
  await openScenario(page, "no-ai-key", "ios", { lang: "zh" });
  await searchByText(page, SEARCH_TEXT);
  await expect(page.getByTestId("availability-list")).toBeVisible();
  await page.getByRole("link", { name: "AI辅助", exact: true }).click();
  await expect(page.getByText("连接 Anthropic", { exact: true }).first()).toBeVisible();
  expect((await requestLog(page)).anthropic).toBe(0);
});

test("first run: one screen — what it does, connect seats.aero first, or look at an example that is marked as made up", async ({ page }) => {
  await openScenario(page, "no-seats-key", "ios", { lang: "en" });
  const welcome = page.getByTestId("welcome");
  await expect(welcome.getByRole("link", { name: "Connect seats.aero" })).toBeVisible();
  await expect(welcome.getByRole("link", { name: "View an example" })).toBeVisible();
  // The AI key is not asked for here.
  await expect(welcome).not.toContainText("Anthropic");
  await welcome.getByRole("link", { name: "View an example" }).click();
  await expect(page.getByText("Illustrative data — not live availability").first()).toBeVisible();
  await expect(page.getByTestId("availability-card").first()).toBeVisible();
  // Made up here, so the page does not carry the seats.aero data line, and the program says it is an example.
  await expect(page.locator(".app-attribution")).toHaveCount(0);
  await expect(page.getByTestId("availability-card").first()).toContainText("Example program");
  await expect(page.getByRole("heading", { level: 1, name: "Example results" })).toBeFocused();
  // Back: the welcome again, with focus on what opened the example.
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByTestId("welcome").getByRole("link", { name: "View an example" })).toBeFocused();
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0 });
});

test("connecting seats.aero: a password field, paste only on request, the cost said before the check, last four only after", async ({ page }) => {
  await watchClipboard(page, "fixture-pasted-key-ABCD");
  await openScenario(page, "no-seats-key", "ios", { lang: "en" });
  await page.getByTestId("welcome").getByRole("link", { name: "Connect seats.aero" }).click();
  // The page's title takes focus on arrival: the link that opened it is gone.
  await expect(page.getByRole("heading", { level: 1, name: "Connect seats.aero" })).toBeFocused();
  const field = page.getByLabel("seats.aero Pro key");
  await expect(field).toHaveAttribute("type", "password");
  expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await expect(page.getByText("Checking this key sends a request to the data source.")).toBeVisible();
  expect(await clipboardReads(page)).toBe(0);
  const paste = page.getByRole("button", { name: "Paste", exact: true });
  expect((await paste.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await paste.click();
  expect(await clipboardReads(page)).toBe(1);
  await expect(field).toHaveValue("fixture-pasted-key-ABCD");
  const before = (await requestLog(page)).seats;
  await page.getByRole("button", { name: "Check and save", exact: true }).click();
  await expect(page.getByText(/Key on file ending in ABCD/)).toBeVisible();
  expect((await requestLog(page)).seats).toBe(before + 1);
  // What comes next has focus, and it is the page's one filled button until another key is typed.
  const start = page.getByRole("link", { name: "Start searching" });
  await expect(start).toBeFocused();
  await field.fill("another-key");
  await expect(start).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("fixture-pasted-key-ABCD");
});

test("a key the data source refuses is not saved, and says why", async ({ page }) => {
  await openScenario(page, "no-seats-key", "ios", { lang: "en" });
  await page.getByTestId("welcome").getByRole("link", { name: "Connect seats.aero" }).click();
  await page.getByLabel("seats.aero Pro key").fill("fixture-invalid-key");
  await page.getByRole("button", { name: "Check and save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("seats.aero did not accept this key");
  await expect(page.getByText(/Key on file/)).toHaveCount(0);
});

test("settings: data connection, then AI (optional), appearance and language, local data, about", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Data connection", "AI (optional)", "Appearance and language", "Local data", "About"]);
  // About says where the data comes from; the page does not say it twice.
  await expect(page.getByText("Data: seats.aero · your own keys, on this device")).toHaveCount(1);
  // Release D7: the non-affiliation sentence, the site's two pages (opened in Safari) and the licenses, in the app.
  await expect(page.getByText("AwardGrid is not affiliated with, endorsed by, or sponsored by seats.aero, Anthropic, any airline, or any loyalty program.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy policy Opens in Safari" })).toHaveAttribute("href", "https://awardgrid.dowhiz.com/privacy/");
  await expect(page.getByRole("link", { name: "Support Opens in Safari" })).toHaveAttribute("href", "https://awardgrid.dowhiz.com/support/");
  await page.getByRole("link", { name: "Licenses" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Licenses" })).toBeFocused();
  await expect(page.locator(".ag-ack-name")).toContainText(["@anthropic-ai/sdk", "@aparajita/capacitor-secure-storage"]);
  await page.locator("summary").filter({ hasText: "react-router" }).click();
  await expect(page.locator("pre.ag-ack-text").filter({ hasText: "Remix Software" })).toBeVisible();
  await page.getByRole("link", { name: "Back to settings" }).click();
  await expect(page.locator("#settings-row-acknowledgements")).toBeFocused();
  const theme = page.getByRole("radiogroup", { name: "Theme" });
  const radios = theme.getByRole("radio");
  await expect(radios).toHaveCount(3);
  for (const [i, name] of ["System", "Light", "Dark"].entries()) await expect(radios.nth(i)).toHaveAccessibleName(name);
  // Each is a 44 pt row: the label around the native radio is the target.
  for (const radio of await radios.all()) expect((await radio.locator("xpath=..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await theme.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0 });
});

test("switching the language keeps what is on screen and sends nothing", async ({ page }) => {
  await openScenario(page, "missing-values", "ios", { lang: "en" });
  const list = page.getByTestId("availability-list");
  await list.getByRole("checkbox").first().check();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("radiogroup", { name: "Language" }).getByRole("radio", { name: "中文" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("设置");
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "查票" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("查票");
  await expect(list.getByRole("checkbox").first()).toBeChecked();
  await expect(list).toContainText("税费待确认");
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0 });
});

test("removing a key asks first, says what it affects, and leaves today's call count alone", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await searchByText(page, SEARCH_TEXT);
  const quota = await page.locator(".ag-results-meta.tabular").textContent();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /seats\.aero/ }).first().click();
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText("Search stops until you add a key again.");
  await expect(confirm).toContainText("Today's call count is kept.");
  await confirm.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText(/Key on file/)).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "seats.aero key removed from this device." })).toBeVisible();
  await expect(page.getByLabel("seats.aero Pro key")).toBeFocused();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Search" }).click();
  await expect(page.locator(".ag-results-meta.tabular")).toHaveText(quota!);
});

test("the query editor in Chinese: its labels, its errors and the approved submit; nothing sent", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "zh" });
  await page.locator("#edit-search").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("编辑查询");
  await expect(page.locator(".query-editor")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("group", { name: "舱位" }).getByRole("button", { name: "商务舱" })).toBeVisible();
  await expect(page.getByLabel("输入文字查询")).toHaveValue("");
  await page.getByRole("button", { name: "查找兑换选项", exact: true }).click();
  await expect(page.getByText("请至少添加一个出发机场。")).toBeVisible();
  await expect(page.getByText("请至少添加一个到达机场。")).toBeVisible();
  await expect(page.locator("#query-origins")).toBeFocused();
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0 });
});

test("the keyboard: the editor's submit rises above it and comes back down after", async ({ page }) => {
  await fakeKeyboard(page);
  await openScenario(page, "complete", "ios", { lang: "en" });
  await page.locator("#edit-search").click();
  await page.locator("#query-origins").focus();
  const inner = await page.evaluate(() => window.innerHeight);
  const submit = page.getByRole("button", { name: "Find award options", exact: true });
  // Without the keyboard, the submit is at the bottom, where the keyboard would cover it.
  const before = (await submit.boundingBox())!;
  expect(before.y + before.height).toBeGreaterThan(inner - 336);
  await keyboard(page, 336);
  await expect(page.locator("html")).toHaveAttribute("data-keyboard", "open");
  await reachableAbove(page, "Find award options", inner - 336);
  await expect(page.locator("#query-origins")).toBeFocused();
  // The field being typed in is not left under the footer that moved up.
  const footerTop = (await page.locator(".query-editor-footer").boundingBox())!.y;
  await expect.poll(async () => {
    const box = (await page.locator("#query-origins").boundingBox())!;
    return box.y + box.height;
  }).toBeLessThanOrEqual(footerTop + 0.5);
  await keyboard(page, 0);
  await expect(page.locator("html")).not.toHaveAttribute("data-keyboard", "open");
  expect((await submit.boundingBox())!.y).toBeCloseTo(before.y, 0);
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0 });
});

test("the keyboard at 320 × 568, panned up to a lower field: open all the same, the submit and the field above it", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await fakeKeyboard(page);
  await openScenario(page, "complete", "ios", { lang: "en" });
  await page.locator("#edit-search").click();
  await page.locator("#query-miles").scrollIntoViewIfNeeded();
  await page.locator("#query-miles").focus();
  // A 260 pt keyboard with WebKit panned 180 up: it covers only the bottom 80 of the layout.
  await keyboard(page, 260, 180);
  await expect(page.locator("html")).toHaveAttribute("data-keyboard", "open");
  await reachableAbove(page, "Find award options", 568 - 80);
  const footerTop = (await page.locator(".query-editor-footer").boundingBox())!.y;
  await expect.poll(async () => {
    const box = (await page.locator("#query-miles").boundingBox())!;
    return box.y + box.height;
  }).toBeLessThanOrEqual(footerTop + 0.5);
  expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0 });
});

test("the keyboard: on a tab screen with a field, the tab bar gives way while it is up (moved from the Ask test, T15)", async ({ page }) => {
  await fakeKeyboard(page);
  await openScenario(page, "complete", "ios", { lang: "en" });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /Anthropic API key/ }).click();
  await page.getByRole("textbox", { name: "Anthropic API key" }).focus();
  await keyboard(page, 300);
  await expect(page.locator("html")).toHaveAttribute("data-keyboard", "open");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeHidden();
  await keyboard(page, 0);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  expect((await requestLog(page)).anthropic).toBe(0);
});

test("the keyboard: the Ask box and its button come up together above it", async ({ page }) => {
  await fakeKeyboard(page);
  await openScenario(page, "complete", "ios", { lang: "en" });
  // A key typed in Settings: saving it checks it once, against the fixture's Anthropic stand-in, never the real one.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /Anthropic API key/ }).click();
  await page.getByRole("textbox", { name: "Anthropic API key" }).fill("fixture-typed-anthropic-key");
  await page.getByRole("button", { name: "Save Anthropic key" }).click();
  await expect(page.getByText("Anthropic key saved to the device Keychain.")).toBeVisible();
  const checks = (await requestLog(page)).anthropic;
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Search" }).click();
  await page.getByRole("link", { name: "AI assistance" }).first().click();
  const box = page.getByRole("textbox", { name: "Question for Claude" });
  await expect(box).toBeEnabled();
  await box.fill("Which dates have two seats?");
  const inner = await page.evaluate(() => window.innerHeight);
  const ask = (await page.getByRole("button", { name: "Ask", exact: true }).boundingBox())!;
  const height = Math.min(inner - 200, Math.max(300, Math.ceil(inner - ask.y) + 24));
  // The button would be under a keyboard of this height where it stands.
  expect(ask.y + ask.height).toBeGreaterThan(inner - height);
  // AI assistance is a full-height page since T15 (S09): no tab bar to give way; its composer is its bottom bar.
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await box.focus();
  await keyboard(page, height);
  await reachableAbove(page, "Ask", inner - height);
  await expect(box).toBeFocused();
  await keyboard(page, 0);
  // Typing and the keyboard sent nothing: the only Anthropic request was the key check.
  expect((await requestLog(page)).anthropic).toBe(checks);
});

/**
 * What runs off the side at this width: an element past the viewport's edge, or text cut by its own box. Elements
 * inside a container that scrolls sideways on purpose are that container's business.
 */
async function sidewaysProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const found: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (el.closest(".sr-only, [hidden], [inert]")) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      let scroller = el.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
      if (scroller && scroller !== document.body && scroller.scrollWidth > scroller.clientWidth + 1) {
        found.push(`scrolls sideways: ${scroller.tagName}.${scroller.className}`);
        continue;
      }
      const name = `${el.tagName}.${typeof el.className === "string" ? el.className : ""} "${(el.textContent ?? "").trim().slice(0, 24)}"`;
      if (box.right > width + 1 || box.left < -1) found.push(`past the edge: ${name} ${Math.round(box.left)}..${Math.round(box.right)}`);
      if (/(hidden|clip)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1 && (el.textContent ?? "").trim() !== "") found.push(`cut: ${name}`);
    }
    return [...new Set(found)].slice(0, 12);
  });
}

for (const lang of ["en", "zh"] as const) {
  test(`${lang}, 320 wide at 130, 160 and 200% text: the first run, the example, settings, the key page, the editor and watches stay inside the screen`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 320, height: 568 });
    await openScenario(page, "no-seats-key", "ios", { lang });
    for (const scale of [1.3, 1.6, 2]) {
      await page.addStyleTag({ content: `:root { --ag-text-scale: ${scale}; }` });
      for (const [route, ready] of [
        ["#/", "[data-testid=welcome]"],
        ["#/example", "[data-testid=availability-card]"],
        ["#/settings", ".ag-settings-label"],
        ["#/settings/seats", "input[type=password]"],
        ["#/settings/anthropic", "input[type=password]"],
        ["#/settings/acknowledgements", ".ag-ack-list"],
        ["#/edit", ".query-editor-footer"],
        ["#/watches", "h1"],
      ] as const) {
        await page.evaluate((hash) => (location.hash = hash), route);
        await page.locator(ready).first().waitFor();
        expect(await sidewaysProblems(page), `${lang} ${scale} ${route}`).toEqual([]);
      }
    }
    expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0 });
  });
}

test("Watches in Chinese: stopping a watch asks in the app, in Chinese, and focus lands on the page title", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "zh" });
  await searchByText(page, SEARCH_TEXT);
  await page.getByRole("button", { name: "关注此查询" }).click();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "关注" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("你关注的查询");
  let native = 0;
  page.on("dialog", (d) => {
    native += 1;
    void d.dismiss();
  });
  await page.getByRole("button", { name: "停止关注" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("此关注及其上一次找到的内容会从本机移除。");
  await expect(sheet.getByRole("button", { name: "保留此关注" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "关闭" })).toBeVisible();
  await sheet.getByRole("button", { name: "停止关注" }).click();
  await expect(page.getByText("你还没有关注任何查询。", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  expect(native).toBe(0);
});

/** Add an Anthropic key through its page (its check goes to the fixture's stand-in only), then return to Settings. */
async function addAnthropicKey(page: Page, key: string) {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /Anthropic API key/ }).click();
  await page.getByRole("textbox", { name: "Anthropic API key" }).fill(key);
  await page.getByRole("button", { name: "Save Anthropic key" }).click();
  await expect(page.getByText("Anthropic key saved to the device Keychain.")).toBeVisible();
  await page.getByRole("link", { name: "Back to settings" }).click();
  // Back on Settings, focus is on the row the page was opened from.
  await expect(page.locator("#settings-row-anthropic")).toBeFocused();
}

test("removing one key leaves the other: seats.aero's removal keeps the Anthropic key, and the other way round", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en" });
  await addAnthropicKey(page, "fixture-typed-anthropic-WXYZ");
  const seatsRow = page.locator("#settings-row-seats");
  const aiRow = page.locator("#settings-row-anthropic");
  await expect(seatsRow).toContainText("Key on file ending in -key");
  await expect(aiRow).toContainText("Key on file ending in WXYZ");

  await seatsRow.click();
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "seats.aero key removed from this device." })).toBeVisible();
  await page.getByRole("link", { name: "Back to settings" }).click();
  await expect(seatsRow).toBeFocused();
  await expect(seatsRow).toContainText("Not connected");
  await expect(aiRow).toContainText("Key on file ending in WXYZ");
  const anthropicAfterSeats = (await requestLog(page)).anthropic;

  // The other way: a fresh launch with its seats.aero key, an Anthropic key added, then removed.
  await openScenario(page, "complete", "ios", { lang: "en" });
  await addAnthropicKey(page, "fixture-typed-anthropic-QRST");
  await aiRow.click();
  await page.getByRole("button", { name: "Remove key for Anthropic" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Anthropic key removed from the Keychain.")).toBeVisible();
  await page.getByRole("link", { name: "Back to settings" }).click();
  await expect(aiRow).toContainText("Not connected");
  await expect(seatsRow).toContainText("Key on file ending in -key");
  // Removing sends nothing to either service.
  expect((await requestLog(page)).seats).toBe(0);
  expect(anthropicAfterSeats).toBeGreaterThanOrEqual(1);
});

test("320 wide at 200% text with keys on file: each settings row's label and value never overlap", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openScenario(page, "complete", "ios", { lang: "en" });
  await addAnthropicKey(page, "fixture-typed-anthropic-WXYZ");
  for (const lang of ["English", "中文"] as const) {
    for (const scale of [1, 1.3, 1.6, 2]) {
      await page.addStyleTag({ content: `:root { --ag-text-scale: ${scale}; }` });
      for (const row of await page.locator(".ag-settings-row").all()) {
        // No text runs past its own box, in any row.
        expect(await row.locator(".ag-settings-row-label").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${lang} ${scale}`).toBe(true);
        // A row with a value (the two keys) keeps it clear of the label. About's links have none (release D7).
        if ((await row.locator(".ag-settings-value").count()) === 0) continue;
        const [label, value] = await Promise.all([row.locator(".ag-settings-row-label").boundingBox(), row.locator(".ag-settings-value").boundingBox()]);
        const apart = label!.x + label!.width <= value!.x + 0.5 || value!.y >= label!.y + label!.height - 0.5;
        expect(apart, `${lang} ${scale}: ${await row.textContent()}`).toBe(true);
        expect(await row.locator(".ag-settings-value").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${lang} ${scale}`).toBe(true);
      }
      expect(await sidewaysProblems(page), `${lang} ${scale}`).toEqual([]);
    }
    if (lang === "English") await page.getByRole("radiogroup", { name: "Language" }).getByRole("radio", { name: "中文" }).check();
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: first run and settings at 390`, async ({ page }) => {
    await openScenario(page, "no-seats-key", "ios", { theme, lang: "zh" });
    await expect(page.getByTestId("welcome")).toBeVisible();
    await evidenceShot(page, `t11-welcome-${theme}`);
    await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "设置" }).click();
    await evidenceShot(page, `t11-settings-${theme}`, { fullPage: true });
    await page.getByRole("link", { name: /seats\.aero Pro 密钥/ }).click();
    await expect(page.getByLabel("seats.aero Pro 密钥")).toBeVisible();
    await evidenceShot(page, `t11-seats-key-${theme}`);
    await page.evaluate(() => (location.hash = "#/settings/anthropic"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await evidenceShot(page, `t11-anthropic-key-${theme}`);
    await page.evaluate(() => (location.hash = "#/example"));
    await expect(page.getByTestId("availability-card").first()).toBeVisible();
    await evidenceShot(page, `t11-example-${theme}`, { fullPage: true });
    await page.evaluate(() => (location.hash = "#/edit"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("编辑查询");
    await evidenceShot(page, `t11-editor-${theme}`);
  });
}
