/**
 * Phase 6.6 — the shared page-state helpers behind the capture matrix.
 *
 * `e2e/screenshots.spec.ts` uses these to photograph every state in `e2e/matrix.ts`, and
 * `e2e/visual.spec.ts` uses the same functions to reach the states it holds to a
 * `toHaveScreenshot` baseline, so the two suites can never drift apart: one description of
 * "what the Ask drawer mid-stream looks like", used twice.
 *
 * Everything here runs offline: the DEMO=1 mock seats.aero server, the seeded e2e users and the
 * scripted Ask stream (`?askdemo=1`, see e2e/README.md). Nothing on a capture is real data.
 *
 * These helpers never leave a mutation behind. Where a state needs a write — Run now, minting a
 * Telegram deep link — the request is intercepted and answered here, so `/queries`, `/settings`
 * and the e2e database look the same after a capture run as before it. The one real write is
 * `saveEditQueryDrawer`, which saves the drawer untouched: the PATCH carries the values it just
 * read, so the row is byte-for-byte the seeded one afterwards (see the note there).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import { zh } from "../src/lib/i18n/dictionaries/zh";
import { availableCells, CANONICAL_QUERY_EN, CANONICAL_QUERY_ZH, expect, loginAs, projectSuffix, submitQuery, test, type E2eUsername } from "./fixtures";
import { SHOT_ROOT, shotFile, type MatrixPage } from "./matrix";

const ROOT = path.resolve(import.meta.dirname, "..", ...SHOT_ROOT.split("/"));

export const isMobile = (): boolean => projectSuffix(test.info().project.name).viewport === "mobile";

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/**
 * Write `docs/screenshots/v0.2/<page>/<state>-<viewport>-<theme>[-zh].png`.
 *
 * Viewport-sized by default. `fullPage` is only for states with no overlay: a fixed-position
 * backdrop paints over the first viewport height and nothing below it, so a full-page capture of
 * an open drawer photographs that artefact instead of the drawer. `clip` takes the top N px at
 * full width instead, for the top-bar details whose subject is a strip of chrome.
 */
export async function capture(
  page: Page,
  pageName: MatrixPage,
  state: string,
  opts: { zh?: boolean; fullPage?: boolean; clip?: number } = {},
): Promise<string> {
  const { viewport, theme } = projectSuffix(test.info().project.name);
  const dir = path.join(ROOT, pageName);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, shotFile(state, viewport, theme, opts.zh));
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Bounded: the quota indicator keeps polling, so "networkidle" may never arrive.
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  await settleDrawers(page);
  const clip = opts.clip ? { x: 0, y: 0, width: page.viewportSize()?.width ?? 1440, height: opts.clip } : undefined;
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false, clip, animations: "disabled", caret: "hide" });
  return file;
}

/**
 * Wait for every drawer on the page to reach a resting position before the shutter opens.
 *
 * The panel mounts in its closed transform and slides in over 200 ms (drawer.css). Playwright's
 * `animations: "disabled"` freezes a running CSS transition where it is rather than completing
 * it, so a capture taken inside those 200 ms photographs the panel still off-screen — which is
 * exactly what all four `queries/edit-drawer-*.png` were: a Queries page with no drawer on it.
 *
 * Two shapes of unsettled, and the first version of this only knew the second, so it went on
 * answering "settled" for the whole window the defect actually lives in:
 *
 *  - **Mid-entry.** `DrawerShell` renders the panel `data-state="closed"` for two frames before
 *    it flips to `open`, so there is a moment with no `[data-state="open"]` element at all — and
 *    `every()` over nothing is true. An entering panel is told apart from a leaving one by
 *    `inert`: `inert={!open}`, so the panel on its way in is closed and NOT inert.
 *  - **Mid-slide.** Open, but the 200 ms transform transition has not finished. `transform: none`
 *    is the settled-open state for every side and mode.
 */
export async function settleDrawers(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll('[data-slot="drawer"]')).every((el) => {
          const entering = el.getAttribute("data-state") !== "open" && !el.hasAttribute("inert");
          const sliding = el.getAttribute("data-state") === "open" && getComputedStyle(el).transform !== "none";
          return !entering && !sliding;
        }),
      null,
      { timeout: 2_000 },
    )
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Small shared locators
// ---------------------------------------------------------------------------

export const grid = (page: Page): Locator => page.getByRole("grid");
export const cells = (page: Page, state?: string): Locator =>
  page.locator(state ? `td[role="gridcell"][data-state="${state}"]` : 'td[role="gridcell"]');
export const toolbar = (page: Page): Locator => page.getByRole("toolbar");
export const searching = (page: Page): Locator => page.getByTestId("grid-searching");
export const chip = (page: Page, id: string): Locator => page.locator(`[data-chip="${id}"]`);
export const popover = (page: Page): Locator => page.locator('[data-slot="popover-content"]');
export const cellDrawer = (page: Page): Locator => page.getByTestId("cell-drawer");
export const askDrawer = (page: Page): Locator => page.getByTestId("ask-drawer");
export const firstQueryRow = (page: Page): Locator => page.locator('[data-testid^="query-row-"]').first();
export const keyRow = (page: Page, provider: string): Locator => page.locator(`[data-key-row="${provider}"]`);

/** The toolbar controls: inline on desktop, inside the "Filters" sheet below 768 px (spec §6). */
export async function openControls(page: Page): Promise<Locator> {
  if (!isMobile()) return toolbar(page);
  await toolbar(page).getByRole("button", { name: en["grid.toolbar.filters"] }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  return sheet;
}

export async function closeControls(page: Page): Promise<void> {
  if (!isMobile()) return;
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
}

/** Wait for a search to finish: the status line is gone and the table is no longer busy. */
export async function settled(page: Page): Promise<void> {
  await expect(searching(page)).toBeHidden({ timeout: 60_000 });
  await expect(grid(page)).toBeVisible({ timeout: 60_000 });
  await expect(grid(page)).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export interface GridOptions {
  user?: E2eUsername;
  /** UI language; `zh` also switches the query to CANONICAL_QUERY_ZH. */
  locale?: "en" | "zh";
  /** Query string for /grid, e.g. "askdemo=1&askcap=1". */
  params?: string;
  /** Skip the search (parse-failure and Examples start from an empty bar). */
  run?: boolean;
}

/** Log in, put the UI in `locale`, open /grid and run the canonical query. Does not wait. */
export async function openGrid(page: Page, opts: GridOptions = {}): Promise<void> {
  const { user = "demo", locale = "en", params = "", run = true } = opts;
  await loginAs(page, user);
  if (locale === "zh") await setLocaleCookie(page);
  await page.goto(params ? `/grid?${params}` : "/grid");
  if (!run) return;
  if (locale === "zh") {
    const box = page.getByRole("textbox", { name: zh["grid.search"] });
    await box.fill(CANONICAL_QUERY_ZH);
    await box.press("Enter");
  } else {
    await submitQuery(page, CANONICAL_QUERY_EN);
  }
}

/** `openGrid` plus the wait for a grid with at least one available cell. */
export async function openGridWithCells(page: Page, opts: GridOptions = {}): Promise<void> {
  await openGrid(page, opts);
  await settled(page);
  await expect(availableCells(page).first()).toBeVisible({ timeout: 60_000 });
}

/** Log in as the demo (or `empty`) user and open /queries. */
export async function openQueries(page: Page, user: E2eUsername = "demo"): Promise<void> {
  await loginAs(page, user);
  await page.goto("/queries");
  await expect(page.getByRole("heading", { name: en["saved.title"] })).toBeVisible();
  if (user !== "empty") await expect(firstQueryRow(page)).toBeVisible();
}

/** Log in and open /settings, optionally with the UI in Chinese. */
export async function openSettings(page: Page, user: E2eUsername = "demo", locale: "en" | "zh" = "en"): Promise<void> {
  await loginAs(page, user);
  if (locale === "zh") await setLocaleCookie(page);
  await page.goto("/settings");
  const dict = locale === "zh" ? zh : en;
  await expect(page.getByRole("heading", { level: 1, name: dict["settings.title"] })).toBeVisible();
}

/**
 * Put the UI in Chinese for this browser context. The cookie is how the app is asked for a
 * language without touching the account (`PUT /api/settings` would outlive the capture run).
 */
async function setLocaleCookie(page: Page): Promise<void> {
  const baseURL = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3400");
  await page.context().addCookies([{ name: "ag_locale", value: "zh", domain: baseURL.hostname, path: "/" }]);
}

// ---------------------------------------------------------------------------
// Shell states (spec §2)
// ---------------------------------------------------------------------------

export const banner = (page: Page): Locator => page.getByRole("banner");
const menuButton = (page: Page): Locator =>
  banner(page).getByRole("button", { name: new RegExp(`^(${en["nav.menu"]}|${en["nav.menu_close"]})$`) });

/**
 * Log in and open /grid: the signed-in top bar, with one nav item current.
 *
 * /grid rather than /queries because the deleted `shell/topbar-grid` stem was the one that showed
 * Grid underlined, and `shell/topbar` is now the only record of the current-item treatment (#34).
 */
export async function openSignedInShell(page: Page): Promise<Locator> {
  await loginAs(page, "demo");
  await page.goto("/grid");
  const header = banner(page);
  await expect(header).toHaveCSS("height", "48px");
  await expect(header.getByRole("link", { name: "awardgrid" })).toBeVisible();
  return header;
}

/** Below 768 px: the panel the menu button drops out, holding nav, toggles and Log out. */
export async function openTopbarMenu(page: Page): Promise<void> {
  await menuButton(page).click();
  await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(banner(page).getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("button", { name: en["nav.logout"] })).toBeVisible();
}

/** Desktop: the account menu under the username button. */
export async function openUserMenu(page: Page): Promise<void> {
  await banner(page).getByRole("button", { name: /demo/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: en["nav.logout"] })).toBeVisible();
}

/**
 * Fail a log in: the inline error under the password field. The username is one nobody owns, so
 * the per-username login throttle for the seeded users is never touched.
 */
export async function loginError(page: Page): Promise<void> {
  await page.getByLabel(en["auth.username"]).fill("nobody-e2e");
  await page.getByLabel(en["auth.password"]).fill("not-the-password");
  await page.getByRole("button", { name: en["auth.login.submit"] }).click();
  await expect(page.getByRole("alert").filter({ hasText: en["error.invalid_credentials"] })).toBeVisible();
  await expect(page.getByLabel(en["auth.password"])).toHaveAttribute("aria-invalid", "true");
}

/** Fail a registration on the invite code, with the password rule in its satisfied state. */
export async function registerError(page: Page): Promise<void> {
  await page.getByLabel(en["auth.username"]).fill("nobody-e2e");
  await page.getByLabel(en["auth.password"]).fill("eight-chars-long");
  await expect(page.getByText(en["auth.password_hint"])).toHaveAttribute("data-satisfied", "true");
  await page.getByRole("button", { name: en["auth.register.submit"] }).click();
  await expect(page.getByRole("alert").filter({ hasText: en["error.invalid_invite"] })).toBeVisible();
  await expect(page.getByLabel(en["auth.invite_code"])).toHaveAttribute("aria-invalid", "true");
}

// ---------------------------------------------------------------------------
// Grid states (spec §3)
// ---------------------------------------------------------------------------

/** Hover a cell with more than one program so the tooltip lists a sorted set. Desktop only. */
export async function hoverTooltip(page: Page): Promise<void> {
  const multi = cells(page, "ok").filter({ has: page.locator(".ag-l3") }).first();
  await multi.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
}

/** Move keyboard focus into the grid and one cell to the right, so the accent ring is on screen. */
export async function focusRing(page: Page): Promise<void> {
  const first = cells(page, "ok").first();
  await first.scrollIntoViewIfNeeded();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('td[role="gridcell"]:focus')).toHaveAttribute("tabindex", "0");
}

/** Open a chip's popover editor, optionally with a search term typed into it. */
export async function openChipEditor(page: Page, id: "origins" | "dates" | "programs" | "min_cabin_pct", search?: string): Promise<Locator> {
  const trigger = chip(page, id);
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const editor = popover(page);
  await expect(editor).toBeVisible();
  if (search) {
    const field =
      id === "programs"
        ? editor.getByRole("textbox", { name: en["grid.chips.search_programs"] })
        : editor.getByRole("combobox", { name: en["grid.chips.search_places"] });
    await field.fill(search);
    await expect(editor.getByRole("option").or(editor.getByRole("button", { name: new RegExp(search, "i") })).first()).toBeVisible();
  }
  return editor;
}

export async function closePopover(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  if (await popover(page).isVisible()) await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden();
}

/** Drop HND from the Tokyo group: the query is modified but not yet run (spec §3.7). */
export async function makeModified(page: Page): Promise<void> {
  const editor = await openChipEditor(page, "origins");
  await editor.getByRole("button", { name: `HND ${en["grid.chips.selected"]}` }).click();
  await closePopover(page);
  await expect(chip(page, "origins")).toHaveAttribute("data-chip-state", "modified");
  await expect(page.getByTestId("chips-run")).toBeVisible();
}

/** Put the chips back on the parsed query. */
export async function resetChips(page: Page): Promise<void> {
  await page.getByTestId("chips-reset").click();
  await expect(page.getByTestId("chips-run")).toBeHidden();
}

/**
 * Empty the Origins chip: it turns error-coloured, the reason moves under the chip row and Run
 * is disabled. The blocking-error state of a chip, which `modified` (editable, runnable) is not.
 */
export async function emptyOrigins(page: Page): Promise<void> {
  const editor = await openChipEditor(page, "origins");
  const remove = editor.getByRole("button", { name: new RegExp(`^${en["grid.chips.remove"]}`) });
  for (let i = await remove.count(); i > 0; i -= 1) await remove.first().click();
  await closePopover(page);
  await expect(chip(page, "origins")).toHaveAttribute("data-chip-state", "error");
  await expect(page.getByTestId("chips-error")).toHaveText(en["grid.chips.at_least_one_airport"]);
  await expect(page.getByTestId("chips-run")).toBeDisabled();
}

/** The Examples popover on an empty query bar (it fills the bar; it must not cover it). */
export async function openExamples(page: Page): Promise<void> {
  await page.getByTestId("examples-trigger").click();
  await expect(popover(page)).toBeVisible();
  await expect(popover(page).getByRole("button")).toHaveCount(3);
}

/** From a parse failure, take the escape hatch: eight chips, three of them blocking. */
export async function openManualMode(page: Page): Promise<void> {
  await page.getByTestId("build-with-chips").click();
  await expect(popover(page)).toBeVisible();
  await expect(page.getByTestId("parse-failure")).toBeHidden();
  await expect(page.getByTestId("chips-error")).toHaveCount(3);
}

/**
 * The Mixed cabin editor at a NON-default value (issue #18). Every other published capture shows
 * the chip at 100, which is the one value that changes nothing: this is the state that changes
 * what an empty cell means, so it is the state worth photographing. The popover is left open —
 * the chip summary, the select and the value-specific hint are all in frame at once.
 */
export async function openMixedCabin(page: Page, pct = 75): Promise<Locator> {
  const editor = await openChipEditor(page, "min_cabin_pct");
  await editor.getByRole("combobox", { name: en["grid.chips.min_cabin_pct"] }).selectOption(String(pct));
  await expect(chip(page, "min_cabin_pct")).toHaveAttribute("data-chip-state", "modified");
  await expect(editor).toContainText(en["grid.chips.mixed_cabin_hint_min"].replace("{pct}", String(pct)));
  return editor;
}

/** Flip the rows toggle to Routes (or back to Dates). */
export async function setRows(page: Page, rows: "dates" | "routes"): Promise<void> {
  const controls = await openControls(page);
  const name = rows === "routes" ? en["grid.toolbar.rows_routes"] : en["grid.toolbar.rows_dates"];
  await controls.getByRole("group", { name: en["grid.toolbar.rows"] }).getByRole("button", { name }).click();
  await closeControls(page);
  await settled(page);
}

/** Pick one cabin chip: "J", "F" or Both. */
export async function setCabin(page: Page, cabin: "J" | "F" | "both"): Promise<void> {
  const controls = await openControls(page);
  const name = cabin === "both" ? en["grid.toolbar.cabin_both"] : cabin;
  await controls.getByRole("group", { name: en["grid.toolbar.cabins"] }).getByRole("button", { name, exact: true }).click();
  await closeControls(page);
  await settled(page);
}

/**
 * Pick the cell layout: Best (one line for the best row across cabins) or Per cabin (one line
 * each). The control only exists with more than one cabin selected, and below 768 px it lives in
 * the Filters sheet like every other toolbar control — hence openControls/closeControls.
 */
export async function setCells(page: Page, cells: "best" | "per_cabin"): Promise<void> {
  const controls = await openControls(page);
  const name = cells === "per_cabin" ? en["grid.toolbar.cells_per_cabin"] : en["grid.toolbar.cells_best"];
  await controls.getByRole("group", { name: en["grid.toolbar.cells"] }).getByRole("button", { name, exact: true }).click();
  await closeControls(page);
  await settled(page);
}

/** Toggle "Show dynamic pricing" and wait for the grid it produces. */
export async function toggleDynamic(page: Page): Promise<void> {
  const controls = await openControls(page);
  await controls.getByRole("switch", { name: en["grid.include_filtered"] }).click();
  await closeControls(page);
  await settled(page);
}

/** Open the cell drawer from the first available cell (Enter, so it is the real keyboard walk). */
export async function openCellDrawer(page: Page): Promise<Locator> {
  const cell = availableCells(page).first();
  await cell.scrollIntoViewIfNeeded();
  await cell.focus();
  await page.keyboard.press("Enter");
  const panel = cellDrawer(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("program-row").first()).toBeVisible();
  return panel;
}

/** Close the cell drawer through its header button: after Show flights the re-rendered row may
 *  have taken focus out of the panel, and the Esc handler lives on the panel. The button is
 *  named in the UI language, so the locale has to be told. */
export async function closeCellDrawer(page: Page, panel: Locator, locale: "en" | "zh" = "en"): Promise<void> {
  const dict = locale === "zh" ? zh : en;
  await panel.getByRole("button", { name: dict["common.close"], exact: true }).click();
  await expect(panel).toBeHidden();
}

/** "Show flights" on the drawer's first program, waited out (the mock answers from trips.json). */
export async function showFlights(page: Page, panel: Locator): Promise<void> {
  const program = panel.getByTestId("program-row").first();
  await program.getByTestId("show-flights").click();
  await expect(program.getByTestId("flights-list")).toBeVisible({ timeout: 30_000 });
}

/**
 * Hold the Get Trips answer open so the in-flight state can be photographed. Intercepting the
 * browser's own request needs no seed user: every "slow" user is claimed by another spec, and a
 * shared one would be warm by the time this suite ran.
 */
export async function showFlightsLoading(page: Page, panel: Locator, ms = 5_000): Promise<() => Promise<void>> {
  await page.route("**/api/trips/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
  const program = panel.getByTestId("program-row").first();
  await program.getByTestId("show-flights").click();
  await expect(program.getByTestId("flights-skeleton")).toBeVisible();
  return () => page.unroute("**/api/trips/**");
}

/** Fail Get Trips: the reason on the program row, with Retry. Returns the un-route function. */
export async function showFlightsError(page: Page, panel: Locator): Promise<() => Promise<void>> {
  await page.route("**/api/trips/**", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "seatsaero", kind: "upstream" }) }),
  );
  const program = panel.getByTestId("program-row").first();
  await program.getByTestId("show-flights").click();
  await expect(program.getByTestId("flights-error")).toContainText(en["grid.drawer.flights_error"]);
  return () => page.unroute("**/api/trips/**");
}

/** Copy the drawer's details: the confirmation under the action block. */
export async function copyDetails(page: Page, panel: Locator): Promise<void> {
  await panel.getByTestId("drawer-copy").click();
  await expect(panel.getByTestId("drawer-toast")).toHaveText(en["grid.sheet.copied"]);
}

/** Open the Ask drawer from a cell, so the selected cell travels with it as a second pill. */
export async function openAskFromCell(page: Page): Promise<Locator> {
  const panel = await openCellDrawer(page);
  await panel.getByTestId("drawer-ask").click();
  const ask = askDrawer(page);
  await expect(ask).toBeVisible();
  await expect(ask.getByTestId("ask-pill-cell")).toBeVisible();
  return ask;
}

/** Open the Ask drawer from the toolbar (inside the Filters sheet below 768 px). */
export async function openAsk(page: Page, locale: "en" | "zh" = "en"): Promise<Locator> {
  const dict = locale === "zh" ? zh : en;
  const button = page.getByRole("button", { name: dict["ask.open"], exact: true });
  if (!(await button.isVisible())) await toolbar(page).getByRole("button", { name: dict["grid.toolbar.filters"] }).click();
  await button.click();
  const panel = askDrawer(page);
  await expect(panel).toBeVisible();
  return panel;
}

/** Send the first suggested question on the scripted stream and stop at "mid-answer". */
export async function askStreaming(page: Page, panel: Locator, locale: "en" | "zh" = "en"): Promise<void> {
  const dict = locale === "zh" ? zh : en;
  await panel.getByTestId("ask-prompt").fill(dict["ask.suggestion.cheapest_program"]);
  await panel.getByTestId("ask-send").click();
  await expect(panel.getByTestId("ask-stop")).toBeVisible();
  // The zh script has its own body, so wait on the answer having text rather than on a word.
  if (locale === "zh") await expect(panel.getByTestId("ask-answer")).not.toBeEmpty({ timeout: 20_000 });
  else await expect(panel.getByTestId("ask-answer")).toContainText("cheapest", { timeout: 20_000 });
}

/** Wait out the running stream: Stop is gone and the tool list is collapsed under the answer. */
export async function finishAsk(page: Page, panel: Locator): Promise<void> {
  await expect(panel.getByTestId("ask-stop")).toHaveCount(0, { timeout: 30_000 });
  await expect(panel.getByTestId("ask-tools-toggle")).toHaveAttribute("aria-expanded", "false");
}

/** One complete question and answer, for callers that do not need the mid-stream frame. */
export async function askAnswered(page: Page, panel: Locator, locale: "en" | "zh" = "en"): Promise<void> {
  await askStreaming(page, panel, locale);
  await finishAsk(page, panel);
}

/** Open the tool-activity disclosure on a finished answer. */
export async function expandAskTools(page: Page, panel: Locator): Promise<void> {
  const toggle = panel.getByTestId("ask-tools-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByTestId("ask-tool-activity").locator("li")).toHaveCount(2);
}

/** Abort mid-answer through Stop: the answer stops where it is and the reason is above the prompt. */
export async function askStopped(page: Page, panel: Locator): Promise<void> {
  await askStreaming(page, panel);
  await panel.getByTestId("ask-stop").click();
  await expect(panel.getByTestId("ask-problem")).toHaveText(en["ask.aborted"]);
  await expect(panel.getByTestId("ask-send")).toBeVisible();
}

/**
 * The keyless answer. `nokey` cannot reach this drawer at all — the toolbar only renders once a
 * query has run on a key — so the state is reached through the scripted failure, which produces
 * exactly the drawer copy and the Settings link a keyless answer would (`?askerr=no_key`).
 */
export async function askNoKey(page: Page, panel: Locator): Promise<void> {
  await panel.getByTestId("ask-prompt").fill(en["ask.suggestion.cheapest_program"]);
  await panel.getByTestId("ask-send").click();
  const problem = panel.getByTestId("ask-problem");
  await expect(problem).toContainText(en["ask.no_key"]);
  await expect(problem.getByRole("link", { name: en["ask.no_key_link"] })).toHaveAttribute("href", "/settings");
}

/**
 * Hold `/api/find` open long enough to photograph the skeleton. Returns the un-route function.
 *
 * The four "slow" seed users are claimed by grid.spec.ts and chips.spec.ts (the availability
 * cache is per user, so a shared slow user would be warm by the time this suite ran and the
 * skeleton would never appear); delaying the browser's own request needs no seed user at all.
 */
export async function delayFind(page: Page, ms = 5_000): Promise<() => Promise<void>> {
  await page.route("**/api/find", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
  return () => page.unroute("**/api/find");
}

// ---------------------------------------------------------------------------
// Queries states (spec §4)
// ---------------------------------------------------------------------------

export async function expandFirstQuery(page: Page): Promise<void> {
  const toggle = firstQueryRow(page).getByRole("button", { name: en["saved.details"], exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("diff-new")).toBeVisible();
}

export async function confirmDeleteInline(page: Page): Promise<Locator> {
  await firstQueryRow(page).getByRole("button", { name: en["saved.delete"], exact: true }).first().click();
  const confirm = page.getByTestId(/^delete-confirm-/);
  await expect(confirm).toBeVisible();
  return confirm;
}

export async function openEditQueryDrawer(page: Page): Promise<Locator> {
  await firstQueryRow(page).getByRole("button", { name: en["saved.edit"], exact: true }).click();
  const panel = page.getByTestId("edit-query-drawer");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("region", { name: en["grid.chips.title"] })).toBeVisible();
  await settleDrawers(page);
  return panel;
}

/**
 * "Run now" with the run intercepted: the row shows a finished run without the worker ever
 * touching the mock, and nothing is written to the e2e database.
 */
export async function runNowStubbed(page: Page): Promise<void> {
  await page.route("**/api/queries/*/run", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        // A minute ago, not "now": the row prints a relative time, and a `ran_at` a few
        // milliseconds ahead of the browser's clock renders as "in 1 second".
        run: {
          id: "run-shot",
          ran_at: new Date(Date.now() - 60_000).toISOString(),
          new_cells: 2,
          dropped_cells: 1,
          notified: false,
          skipped_reason: null,
          calls_used: 9,
        },
      }),
    }),
  );
  await firstQueryRow(page).getByRole("button", { name: en["saved.run_now"], exact: true }).click();
  await expect(page.getByTestId("row-notice")).toContainText("+2 new");
  await page.unroute("**/api/queries/*/run");
}

/** "Run now" answered 409: the failure lands in the same row the result would have. */
export async function runNowFailed(page: Page): Promise<void> {
  await page.route("**/api/queries/*/run", (route) =>
    route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "run_in_progress" }) }),
  );
  await firstQueryRow(page).getByRole("button", { name: en["saved.run_now"], exact: true }).click();
  await expect(page.getByTestId("row-notice")).toContainText(en["error.run_in_progress"]);
  await page.unroute("**/api/queries/*/run");
}

/**
 * Save the edit drawer untouched, for the confirmation toast. This one write is real rather than
 * intercepted, and it is still a no-op: `EditQueryDrawer.onSave` sends the chips only when they
 * actually moved, so an untouched save PATCHes the form's own values back and the stored
 * `QueryObject` keeps its JSON byte for byte — the row the next spec reads is the seeded one.
 */
export async function saveEditQueryDrawer(page: Page, panel: Locator): Promise<void> {
  await panel.getByTestId("edit-query-save").click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("queries-toast")).toHaveText(en["saved.updated"]);
}

// ---------------------------------------------------------------------------
// Settings states (spec §5)
// ---------------------------------------------------------------------------

/** A fake deep link of the shape the bot hands out (43-character one-time token). */
export const FAKE_DEEP_LINK = `https://t.me/awardgrid_demo_bot?start=${"Ab3xY".repeat(8)}zqk`;

/** Open an optional provider's "Add key" form (the shape a provider with no key on file has). */
export async function openAddKeyForm(page: Page): Promise<void> {
  await keyRow(page, "duffel").getByRole("button", { name: en["settings.keys.add_action"] }).click();
  await expect(keyRow(page, "duffel").getByLabel(en["settings.keys.input_label"])).toBeVisible();
  await keyRow(page, "duffel").scrollIntoViewIfNeeded();
}

/**
 * Paste a key seats.aero rejects. The probe really goes to the DEMO mock, which answers 401, so
 * the row shows the true failure — and the stored key is untouched, because the write never ran.
 */
export async function showKeyError(page: Page): Promise<void> {
  const seats = keyRow(page, "seats_aero");
  const replace = seats.getByRole("button", { name: en["settings.keys.replace"] });
  if ((await replace.getAttribute("aria-expanded")) !== "true") await replace.click();
  const input = seats.getByLabel(en["settings.keys.input_label"]);
  await expect(input).toBeVisible();
  await input.fill("demo-key-invalid");
  await seats.getByRole("button", { name: en["settings.keys.add"] }).click();
  await expect(seats.getByRole("alert")).toHaveText(en["error.invalid_key"]);
  await seats.scrollIntoViewIfNeeded();
}

/** Mint a Telegram deep link (stubbed: the app process has no bot token) and show the QR. */
export async function openTelegramInvite(page: Page): Promise<void> {
  await page.route("**/api/telegram/link", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ json: { deepLink: FAKE_DEEP_LINK, mock: true } });
  });
  await page.getByRole("button", { name: en["settings.telegram.link"] }).click();
  const invite = page.locator("[data-telegram-invite]");
  await expect(invite).toBeVisible();
  await expect(invite.getByRole("img", { name: en["settings.telegram.qr_alt"] })).toBeVisible();
  await invite.scrollIntoViewIfNeeded();
}

/** Scroll a settings section into view and name it, without changing anything on the account. */
export async function showSettingsSection(page: Page, section: "account" | "language"): Promise<Locator> {
  const target = page.locator(`[data-settings-section="${section}"]`);
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  return target;
}

// ---------------------------------------------------------------------------
// Visual regression: what must not be compared
// ---------------------------------------------------------------------------

/**
 * Elements whose text is a clock reading and would fail every baseline the next day: freshness
 * ages, the quota counters and "resets in", the grid's date row headers and Dates chip (the demo
 * dataset is shifted so day one is today), relative run times, and the "added <date>" key line.
 *
 * `mask` paints them over in both the baseline and the comparison, so the layout is still
 * asserted — only the reading inside the box is exempt.
 */
export function timeMasks(page: Page): Locator[] {
  return [
    page.locator(".ag-age"),
    page.locator("th[role='rowheader']"),
    page.locator('[data-chip="dates"]'),
    page.getByTestId("quota-indicator"),
    page.getByTestId("quota-banner"),
    page.getByTestId("drawer-when"),
    page.locator("[data-quota-state]"),
    page.locator('[data-key-row="seats_aero"]'),
    page.locator(".aq-row td:nth-child(4), .aq-row td:nth-child(5)"),
    page.locator(".aq-card .aq-meta"),
    page.locator("table.aq-runs tbody td:first-child"),
  ];
}
