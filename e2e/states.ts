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
 * and the e2e database look the same after a capture run as before it.
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
 * an open drawer photographs that artefact instead of the drawer.
 */
export async function capture(page: Page, pageName: MatrixPage, state: string, opts: { zh?: boolean; fullPage?: boolean } = {}): Promise<string> {
  const { viewport, theme } = projectSuffix(test.info().project.name);
  const dir = path.join(ROOT, pageName);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, shotFile(state, viewport, theme, opts.zh));
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Bounded: the quota indicator keeps polling, so "networkidle" may never arrive.
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  await settleDrawers(page);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false, animations: "disabled", caret: "hide" });
  return file;
}

/**
 * Wait for any open drawer to reach its resting position before the shutter opens.
 *
 * The panel mounts in its closed transform and slides in over 200 ms (drawer.css). Playwright's
 * `animations: "disabled"` freezes a running CSS transition where it is rather than completing
 * it, so a capture taken inside those 200 ms photographs the panel still off-screen — which is
 * exactly what all four `queries/edit-drawer-*.png` were: a Queries page with no drawer on it.
 * The cell and Ask drawers only escaped it because their helpers wait for streamed content
 * first. `transform: none` is the settled-open state for every side and mode.
 */
export async function settleDrawers(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll('[data-slot="drawer"][data-state="open"]')).every(
          (el) => getComputedStyle(el).transform === "none",
        ),
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
  if (locale === "zh") {
    const baseURL = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3400");
    await page.context().addCookies([{ name: "ag_locale", value: "zh", domain: baseURL.hostname, path: "/" }]);
  }
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

/** Log in and open /settings. */
export async function openSettings(page: Page, user: E2eUsername = "demo"): Promise<void> {
  await loginAs(page, user);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: en["settings.title"] })).toBeVisible();
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
export async function openChipEditor(page: Page, id: "origins" | "dates" | "programs", search?: string): Promise<Locator> {
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
 *  have taken focus out of the panel, and the Esc handler lives on the panel. */
export async function closeCellDrawer(page: Page, panel: Locator): Promise<void> {
  await panel.getByRole("button", { name: en["common.close"], exact: true }).click();
  await expect(panel).toBeHidden();
}

/** "Show flights" on the drawer's first program, waited out (the mock answers from trips.json). */
export async function showFlights(page: Page, panel: Locator): Promise<void> {
  const program = panel.getByTestId("program-row").first();
  await program.getByTestId("show-flights").click();
  await expect(program.getByTestId("flights-list")).toBeVisible({ timeout: 30_000 });
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
export async function askStreaming(page: Page, panel: Locator): Promise<void> {
  await panel.getByTestId("ask-prompt").fill(en["ask.suggestion.cheapest_program"]);
  await panel.getByTestId("ask-send").click();
  await expect(panel.getByTestId("ask-stop")).toBeVisible();
  await expect(panel.getByTestId("ask-answer")).toContainText("cheapest", { timeout: 20_000 });
}

/** Stop a running answer, so no stream outlives the test that started it. */
export async function stopAsk(page: Page, panel: Locator): Promise<void> {
  const stop = panel.getByTestId("ask-stop");
  if (await stop.isVisible().catch(() => false)) await stop.click();
  await expect(panel.getByTestId("ask-stop")).toHaveCount(0, { timeout: 30_000 });
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
          calls_used: null,
        },
      }),
    }),
  );
  await firstQueryRow(page).getByRole("button", { name: en["saved.run_now"], exact: true }).click();
  await expect(page.getByTestId("row-notice")).toContainText("+2 new");
  await page.unroute("**/api/queries/*/run");
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
