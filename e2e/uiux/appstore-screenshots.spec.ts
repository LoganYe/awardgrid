/**
 * App Store screenshots for the public listing (docs/release/IOS_1.0_RELEASE.md, "Public release"). Not a behaviour
 * test: it renders the real app in the fixture host at the 6.9-inch iPhone size the listing requires (440×956 pt at
 * 3×, 1320×2868 px), with that phone's safe areas, and writes one PNG per screen, in English (en-US) and Chinese
 * (zh-Hans). Every result in them is the fixture's synthetic data, and the Ask screen shows the host's scripted
 * answer; nothing is sent anywhere (./test.ts locks the network down as for every spec).
 *
 *   UIUX_STORE_SHOTS=docs/release/appstore/1.0 UIUX_WEB=0 \
 *     pnpm exec playwright test --config=playwright.uiux.config.ts appstore-screenshots
 *
 * Skipped unless UIUX_STORE_SHOTS names the output directory, so the suite never writes these files.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { openScenario, searchByText } from "./helpers";
import { expect, test } from "./test";

const OUT = process.env.UIUX_STORE_SHOTS;
test.skip(!OUT, "App Store screenshots: set UIUX_STORE_SHOTS to the output directory");
test.use({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 });

const LOCALES = [
  {
    lang: "en",
    dir: "en-US",
    search: "HKG to SEA in October, business and first",
    views: { list: "List", calendar: "Calendar", matrix: "Matrix" },
    viewOption: /^View option/,
    back: "Back to results",
    watches: /Watches/,
  },
  {
    lang: "zh",
    dir: "zh-Hans",
    search: "香港到西雅图 十月 商务舱、头等舱",
    views: { list: "列表", calendar: "日历", matrix: "矩阵" },
    viewOption: /^查看选项/,
    back: "返回结果",
    watches: /关注/,
  },
] as const;

/** The 6.9-inch iPhone's safe areas (status bar and Dynamic Island above, home indicator below), as WKWebView sees them. */
async function phoneInsets(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride" as never, { insets: { top: 62, bottom: 34, left: 0, right: 0 } } as never);
}

async function shot(page: Page, dir: string, name: string) {
  const folder = path.join(OUT!, dir);
  fs.mkdirSync(folder, { recursive: true });
  // Let transitions and fonts finish; the listing shows the settled screen.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(folder, `${name}.png`), animations: "disabled", caret: "hide" });
}

for (const l of LOCALES) {
  test(`${l.dir}: list, calendar, matrix, details and compare`, async ({ page }) => {
    await phoneInsets(page);
    await openScenario(page, "multi-program", "ios", { lang: l.lang });
    await searchByText(page, l.search);
    await expect(page.getByTestId("availability-card").first()).toBeVisible();
    await shot(page, l.dir, "01-list");

    const view = (name: string) => page.getByTestId("results-view").getByRole("radio", { name, exact: true });
    await view(l.views.calendar).click();
    await expect(page.getByTestId("calendar-view")).toBeVisible();
    await shot(page, l.dir, "02-calendar");

    await view(l.views.matrix).click();
    await expect(page.getByTestId("matrix-view")).toBeVisible();
    await shot(page, l.dir, "03-matrix");

    await view(l.views.list).click();
    await page.getByTestId("availability-card").first().getByRole("button", { name: l.viewOption }).click();
    await expect(page).toHaveURL(/#\/detail\//);
    await shot(page, l.dir, "04-details");
    await page.goBack();

    const boxes = page.getByTestId("availability-list").getByRole("checkbox");
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await boxes.nth(2).check();
    await page.getByTestId("compare-tray").getByRole("link").click();
    await expect(page).toHaveURL(/#\/compare/);
    await shot(page, l.dir, "05-compare");
  });

  test(`${l.dir}: watches`, async ({ page }) => {
    await phoneInsets(page);
    await openScenario(page, "watch-changes", "ios", { lang: l.lang });
    await page.getByRole("navigation").getByRole("link", { name: l.watches }).click();
    await expect(page.getByTestId("watch-card").first()).toBeVisible();
    await shot(page, l.dir, "06-watches");
  });
}

// The scripted answer is English only, so Ask is shown in the English set alone.
test("en-US: Ask proposes a change to the search", async ({ page }) => {
  await phoneInsets(page);
  await openScenario(page, "ai-pending", "ios", { lang: "en" });
  await searchByText(page, "HKG to SEA in October, business and first");
  await page.getByTestId("results-header").getByRole("link").click();
  await page.getByRole("textbox", { name: "Question for Claude" }).fill("Is there anything later in the autumn?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("query-change-proposal")).toHaveAttribute("data-status", "pending");
  await shot(page, "en-US", "07-ask");
});
