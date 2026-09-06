/**
 * Phase 6.4 — the Ask drawer (spec §3.6, docs/UI_PLAN.md §6.6): context pills, suggested
 * questions, the streamed markdown answer, tool activity, Stop, the cost meter and the cap.
 *
 * The app runs with no ANTHROPIC_API_KEY, so the real ask lane can never stream here. Every
 * streaming state below comes from `/api/ask/demo` — a scripted SSE stream framed exactly like
 * POST /api/ask, served only because e2e/start-app.sh exports ASK_DEMO_STREAM=1, and used only
 * by a page opened with `?askdemo=1`. Nothing here was fetched from anywhere.
 *
 * This spec asserts; it does not photograph. Every capture of these states is declared in
 * `e2e/matrix.ts` and written by `e2e/screenshots.spec.ts` (#34) — one owner per file.
 */
import type { Locator, Page } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import { zh } from "../src/lib/i18n/dictionaries/zh";
import { applyTheme, availableCells, CANONICAL_QUERY_EN, CANONICAL_QUERY_ZH, expect, forgetLoginCookies, openAskDrawer, projectSuffix, submitQuery, test } from "./fixtures";

const isMobile = () => projectSuffix(test.info().project.name).viewport === "mobile";

/** Open /grid with the demo switch on, run the canonical query, and wait for cells. */
async function openDemoGrid(page: Page, params = "askdemo=1", opts: { zh?: boolean } = {}): Promise<void> {
  await applyTheme(page);
  const probe = await page.request.get("/api/ask/demo?probe=1");
  expect(probe.ok(), "the scripted Ask stream needs ASK_DEMO_STREAM=1 (e2e/start-app.sh)").toBeTruthy();
  if (opts.zh) {
    const baseURL = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3400");
    await page.context().addCookies([{ name: "ag_locale", value: "zh", domain: baseURL.hostname, path: "/" }]);
  }
  await page.goto(`/grid?${params}`);
  if (opts.zh) {
    const box = page.getByRole("textbox", { name: zh["grid.search"] });
    await box.fill(CANONICAL_QUERY_ZH);
    await box.press("Enter");
  } else {
    await submitQuery(page, CANONICAL_QUERY_EN);
  }
  await expect(page.getByRole("grid")).toBeVisible({ timeout: 60_000 });
  await expect(availableCells(page).first()).toBeVisible({ timeout: 60_000 });
}

/** The Ask drawer, opened from the cell drawer so the selected cell travels with it. */
async function openAskFromCell(page: Page): Promise<Locator> {
  const cell = availableCells(page).first();
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const cellDrawer = page.getByTestId("cell-drawer");
  await expect(cellDrawer).toBeVisible();
  await cellDrawer.getByTestId("drawer-ask").click();
  const ask = page.getByTestId("ask-drawer");
  await expect(ask).toBeVisible();
  return ask;
}

/** Type a question and send it. */
async function ask(drawer: Locator, question: string): Promise<void> {
  await drawer.getByTestId("ask-prompt").fill(question);
  await drawer.getByTestId("ask-send").click();
}

/** Send a question and wait until the stream is open (Stop has replaced Send). */
async function askAndStream(drawer: Locator, question: string): Promise<void> {
  await ask(drawer, question);
  await expect(drawer.getByTestId("ask-stop")).toBeVisible();
}

const QUESTION = en["ask.suggestion.cheapest_program"];

test.describe("ask drawer", () => {
  test("opens with context pills and three suggestions, and the pills toggle", async ({ page, asUser }) => {
    await asUser("demo");
    await openDemoGrid(page);
    const drawer = await openAskDrawer(page);

    // docs/UI_PLAN.md §6.6: "Current grid: 4 routes, Oct 1–30, J and F" — commas, no separator glyph.
    const gridPill = drawer.getByTestId("ask-pill-grid");
    await expect(gridPill).toBeVisible();
    await expect(gridPill).toHaveText(/^Current grid: \d+ routes, .+, [JFWY](?: and [JFWY])*$/);
    await expect(gridPill).toHaveAttribute("aria-pressed", "true");

    const suggestions = drawer.getByTestId("ask-suggestions").getByRole("button");
    await expect(suggestions).toHaveCount(3);
    await expect(suggestions.first()).toHaveText(QUESTION);

    // Switching a pill off is what stops it being sent as context.
    await gridPill.click();
    await expect(gridPill).toHaveAttribute("aria-pressed", "false");
    await gridPill.click();
    await expect(gridPill).toHaveAttribute("aria-pressed", "true");

    // A suggestion fills the input rather than sending it.
    await suggestions.nth(2).click();
    await expect(drawer.getByTestId("ask-prompt")).toHaveValue(en["ask.suggestion.combine_trip"]);
  });

  test("streams markdown, lists the tools it used and moves the cost meter", async ({ page, asUser }) => {
    await asUser("demo");
    await openDemoGrid(page);
    const drawer = await openAskDrawer(page);

    const meter = drawer.getByTestId("ask-cost-meter");
    await expect(meter).toBeVisible();
    const before = (await meter.textContent())?.trim() ?? "";
    expect(before).toMatch(/^Today \$\d+\.\d{2} of \$2\.00$/);

    await askAndStream(drawer, QUESTION);
    // Mid-stream: some answer text, the caret, and Stop instead of Send.
    await expect(drawer.getByTestId("ask-answer")).toContainText("cheapest", { timeout: 20_000 });
    await expect(drawer.getByTestId("ask-send")).toHaveCount(0);

    // Finished: Stop is gone, the tool list is collapsed, the meter has moved.
    await expect(drawer.getByTestId("ask-stop")).toHaveCount(0, { timeout: 30_000 });
    const answer = drawer.getByTestId("ask-answer");
    await expect(answer.locator("strong").first()).toBeVisible();
    await expect(answer.locator("ul > li")).toHaveCount(3);
    await expect(answer.locator("code").first()).toBeVisible();

    const tools = drawer.getByTestId("ask-tools-toggle");
    await expect(tools).toHaveAttribute("aria-expanded", "false");
    await expect(drawer.getByTestId("ask-tool-activity").locator("ul")).toBeHidden();
    await expect(meter).not.toHaveText(before, { timeout: 20_000 });
    await expect(meter).toHaveText("Today $0.42 of $2.00");

    // Expanding shows the human labels, never a tool input.
    await tools.click();
    await expect(tools).toHaveAttribute("aria-expanded", "true");
    const steps = drawer.getByTestId("ask-tool-activity").locator("li");
    await expect(steps).toHaveCount(2);
    await expect(steps.nth(0)).toHaveText(en["ask.tool.cached_search"]);
    await expect(steps.nth(1)).toHaveText("Read transfer-partners");

    // One muted line promises the history is per session, and it really is.
    await expect(drawer.getByText(en["ask.history_note"])).toBeVisible();
    const stored = await page.evaluate(() => ({
      session: window.sessionStorage.getItem("awardgrid.ask.history") !== null,
      local: window.localStorage.getItem("awardgrid.ask.history") !== null,
    }));
    expect(stored).toEqual({ session: true, local: false });
  });

  test("Stop aborts the stream and says so", async ({ page, asUser }) => {
    await asUser("demo");
    await openDemoGrid(page);
    const drawer = await openAskDrawer(page);

    await askAndStream(drawer, QUESTION);
    const answer = drawer.getByTestId("ask-answer");
    await expect(answer).toContainText("cheapest", { timeout: 20_000 });
    await drawer.getByTestId("ask-stop").click();

    await expect(drawer.getByTestId("ask-problem")).toHaveText(en["ask.aborted"]);
    await expect(drawer.getByTestId("ask-send")).toBeVisible();
    // The answer is sampled once the abort has LANDED, not before the click: the stream can
    // still deliver a delta between reading the text and the click taking effect, which made
    // this a race that only lost on a slow runner.
    const atAbort = (await answer.textContent()) ?? "";
    // It really was cut short — the script's last delta never arrived.
    expect(atAbort).not.toContain("Nothing here was fetched");
    // And nothing arrives after the abort.
    await page.waitForTimeout(1_000);
    expect((await answer.textContent()) ?? "").toBe(atAbort);
  });

  /**
   * The keyless user cannot reach this drawer at all: the toolbar (and with it the "Ask" button)
   * renders only once a query has run on a key, so `nokey` sees the grid's own empty state
   * instead. The lane's no-key answer is captured through the scripted failure, which produces
   * exactly the drawer copy and the Settings link a keyless answer would.
   */
  test("no key: the answer says what to add and links to settings", async ({ page, asUser }) => {
    await asUser("demo");
    await openDemoGrid(page, "askdemo=1&askerr=no_key");
    const drawer = await openAskDrawer(page);
    await ask(drawer, QUESTION); // the scripted failure arrives before Stop is worth waiting for
    await expect(drawer.getByTestId("ask-problem")).toContainText(en["ask.no_key"]);
    await expect(drawer.getByTestId("ask-problem").getByRole("link", { name: en["ask.no_key_link"] })).toHaveAttribute("href", "/settings");
  });

  test("at the cap: the input is disabled with the reason and the reset time", async ({ page, asUser }) => {
    await asUser("demo");
    await openDemoGrid(page, "askdemo=1&askcap=1");
    const drawer = await openAskDrawer(page);

    // At the cap the budget line REPLACES the meter (one line, docs/UI_PLAN.md §6.6): the
    // "Today $X of $Y" figure is already inside it, so it is not also stacked above.
    const meter = drawer.getByTestId("ask-cost-meter");
    await expect(meter).toContainText("Today's Ask budget");
    await expect(meter).toContainText("$2.00");
    await expect(meter).toContainText("UTC");
    await expect(meter).not.toContainText("Today $2.00 of $2.00");
    await expect(drawer.getByTestId("ask-prompt")).toBeDisabled();
  });

  /**
   * Spec §3.6's second context pill. It can only exist because the SELECTION outlives the cell
   * drawer: both drawers share one slot, so opening Ask closes the cell drawer, and a selection
   * stored in that slot would go with it (use-drawer-state.ts keeps `lastCell` instead).
   */
  test("the selected cell arrives as its own context pill", async ({ page, asUser }) => {
    await asUser("demo");
    await openDemoGrid(page);
    const drawer = await openAskFromCell(page);

    const cellPill = drawer.getByTestId("ask-pill-cell");
    await expect(cellPill).toBeVisible();
    // "Selected: NRT→SEA Sep 6 J 70,000 Aeroplan" (spec §3.6, verbatim format).
    await expect(cellPill).toHaveText(/^Selected: [A-Z]{3}→[A-Z]{3} .+ [FJWY] [\d,]+ .+$/);
    await expect(cellPill).toHaveAttribute("aria-pressed", "true");
    // Both pills at once: the grid the question is about, and the cell inside it.
    await expect(drawer.getByTestId("ask-pill-grid")).toBeVisible();

    await cellPill.click();
    await expect(cellPill).toHaveAttribute("aria-pressed", "false");
  });

  /**
   * Closing the drawer mid-stream must abort, exactly as Stop does: otherwise an abandoned tab
   * keeps the SSE connection and the agent session running and keeps spending the daily budget
   * (src/app/api/ask/route.ts says the design prevents that).
   */
  test("closing mid-stream aborts the answer, like Stop", async ({ page, asUser }) => {
    await asUser("demo");
    await openDemoGrid(page);
    let drawer = await openAskDrawer(page);

    await askAndStream(drawer, QUESTION);
    await expect(drawer.getByTestId("ask-answer")).toContainText("cheapest", { timeout: 20_000 });
    const partial = (await drawer.getByTestId("ask-answer").textContent()) ?? "";

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ask-drawer")).toBeHidden();
    // Long enough for the rest of the scripted stream to have arrived, had it kept running.
    await page.waitForTimeout(3_000);

    drawer = await openAskDrawer(page);
    // The partial answer is in this session's history, and it stopped growing when the drawer went.
    await expect(drawer.getByTestId("ask-answer").last()).toHaveText(partial);
    await expect(drawer.getByTestId("ask-send")).toBeVisible();
  });

  /**
   * §3.6 tolerates a per-session history because it ends with the session. sessionStorage
   * survives a same-tab navigation, so logging out has to clear it explicitly or the next user
   * on a shared machine opens Ask and reads the previous one's questions and answers.
   */
  test("logging out clears this session's history", async ({ page, asUser }) => {
    await asUser("demo");
    await openDemoGrid(page);
    const drawer = await openAskDrawer(page);
    await askAndStream(drawer, QUESTION);
    await expect(drawer.getByTestId("ask-stop")).toHaveCount(0, { timeout: 30_000 });
    expect(await page.evaluate(() => window.sessionStorage.getItem("awardgrid.ask.history"))).not.toBeNull();

    // The header's Close button, not Escape: the finished answer leaves focus outside the panel.
    // `exact` because the bottom sheet's drag handle is also named "…to close".
    await drawer.getByRole("button", { name: en["common.close"], exact: true }).click();
    await expect(page.getByTestId("ask-drawer")).toBeHidden();
    if (isMobile()) {
      await page.getByRole("banner").getByRole("button", { name: new RegExp(`^(${en["nav.menu"]}|${en["nav.menu_close"]})$`) }).click();
      await page.getByRole("button", { name: en["nav.logout"] }).click();
    } else {
      await page.getByRole("banner").getByRole("button", { name: /demo/ }).click();
      await page.getByRole("menuitem", { name: en["nav.logout"] }).click();
    }
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => window.sessionStorage.getItem("awardgrid.ask.history"))).toBeNull();
    // The session this test just destroyed must not be handed to the tests that follow.
    forgetLoginCookies("demo");
  });

  test("Chinese: the pills, the suggestions and the answer read in the UI language", async ({ page, asUser }) => {
    await asUser("demo");
    await openDemoGrid(page, "askdemo=1", { zh: true });
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    const drawer = await openAskDrawer(page, "zh");

    const gridPill = drawer.getByTestId("ask-pill-grid");
    // "当前表格：7 条航线，9月6日–10月5日，F" — the locale's own comma, no separator glyph.
    await expect(gridPill).toContainText(zh["ask.context.query"]);
    await expect(gridPill).not.toContainText(" · ");
    await expect(drawer.getByTestId("ask-suggestions").getByRole("button").first()).toHaveText(zh["ask.suggestion.cheapest_program"]);
    // The 420 px panel (or the bottom sheet) holds the Chinese copy without scrolling sideways.
    const overflow = await drawer.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await askAndStream(drawer, zh["ask.suggestion.cheapest_program"]);
    await expect(drawer.getByTestId("ask-stop")).toHaveCount(0, { timeout: 30_000 });
  });

  test("mobile: the drawer is a bottom sheet with a drag handle", async ({ page, asUser }) => {
    test.skip(!isMobile(), "bottom sheet is the < 768 px presentation");
    await asUser("demo");
    await openDemoGrid(page);
    const drawer = await openAskDrawer(page);
    await expect(drawer).toHaveAttribute("data-mode", "bottom-sheet");
    await expect(drawer.getByRole("button", { name: en["drawer.handle"] })).toBeVisible();

    // Esc closes, as everywhere else (spec §3.4).
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });
});
