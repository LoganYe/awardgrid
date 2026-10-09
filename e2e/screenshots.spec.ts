/**
 * Phase 6.6 — the capture matrix (spec §9), in one spec.
 *
 * Every page × state × viewport × theme the spec asks for is produced here and nowhere else, so
 * there is exactly one place to read "what gets photographed": `e2e/matrix.ts` declares the
 * matrix, `e2e/states.ts` knows how to reach each state, and this file walks the two.
 *
 *     docs/screenshots/v0.2/<page>/<state>-<viewport>-<theme>[-zh].png
 *
 * Four Playwright projects (desktop/mobile × light/dark) each write their own quarter of the
 * tree; `pnpm exec tsx scripts/screenshot-index.ts` then builds the contact sheet and fails on any
 * file that does not match the naming rule. The last test in this file checks the same thing per
 * project, so a state that silently stopped being captured fails the suite instead of quietly
 * leaving a stale PNG behind.
 *
 * Assertions here are deliberately thin — enough that a broken state fails loudly rather than
 * being photographed empty. The semantics of each state are asserted by the feature specs
 * (grid, chips, cell-drawer, ask-drawer, queries, settings, shell), which since #34 assert only:
 * they no longer photograph anything, so no two writers race for the same file name and
 * `scripts/screenshot-index.ts --strict --check` can be the CI guard.
 *
 * Everything is offline: the DEMO=1 mock, the seeded users, the scripted Ask stream. Nothing
 * here leaves the e2e database changed (see the interception note in e2e/states.ts).
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { en } from "@awardgrid/core/i18n/dictionaries/en";
import { zh } from "@awardgrid/core/i18n/dictionaries/zh";
import { applyTheme, expect, projectSuffix, submitQuery, test } from "./fixtures";
import { MATRIX, SHOT_ROOT, shotFile, type MatrixPage, type MatrixShot } from "./matrix";
import {
  askAnswered,
  askNoKey,
  askStopped,
  askStreaming,
  capture,
  cells,
  closeCellDrawer,
  closePopover,
  confirmDeleteInline,
  copyDetails,
  delayFind,
  emptyOrigins,
  expandAskTools,
  expandFirstQuery,
  finishAsk,
  focusRing,
  grid,
  hoverTooltip,
  isMobile,
  loginError,
  makeModified,
  openAddKeyForm,
  openAsk,
  openAskFromCell,
  openCellDrawer,
  openChipEditor,
  openEditQueryDrawer,
  openExamples,
  openGrid,
  openGridWithCells,
  openManualMode,
  openMixedCabin,
  openQueries,
  openSettings,
  openSignedInShell,
  openTelegramInvite,
  openTopbarMenu,
  openUserMenu,
  registerError,
  resetChips,
  runNowFailed,
  runNowStubbed,
  saveEditQueryDrawer,
  searching,
  setCabin,
  setCells,
  setRows,
  showFlights,
  showFlightsError,
  showFlightsLoading,
  keepSeatsConnected,
  showSeatsDisconnectConfirm,
  showSettingsSection,
  toggleDynamic,
} from "./states";

const INDEX = new Map<string, MatrixShot>(MATRIX.map((shot) => [`${shot.page}/${shot.state}${shot.zh ? "-zh" : ""}`, shot]));

/**
 * Capture one matrix entry. The entry decides full-page vs viewport, so the spec cannot disagree
 * with the contact sheet; an unknown key is a typo and fails here rather than writing a file the
 * index would then reject.
 */
async function shot(page: Page, pageName: MatrixPage, state: string, opts: { zh?: boolean } = {}): Promise<void> {
  const key = `${pageName}/${state}${opts.zh ? "-zh" : ""}`;
  const entry = INDEX.get(key);
  expect(entry, `${key} is not in e2e/matrix.ts`).toBeTruthy();
  const viewport = projectSuffix(test.info().project.name).viewport;
  if (entry!.viewports && !entry!.viewports.includes(viewport)) return;
  await capture(page, pageName, state, { zh: opts.zh, fullPage: entry!.fullPage, clip: entry!.clip });
}

test.describe("screenshots", () => {
  test.beforeEach(async ({ page }) => {
    await applyTheme(page);
  });

  // ---- shell (spec §2) ---------------------------------------------------

  test("shell: the top bar and the menus it opens", async ({ page }) => {
    await openSignedInShell(page);
    await shot(page, "shell", "topbar");

    // The nav, the toggles and Log out: one panel below 768 px, a popover above it.
    if (isMobile()) {
      await openTopbarMenu(page);
      await shot(page, "shell", "topbar-menu");
    } else {
      await openUserMenu(page);
      await shot(page, "shell", "topbar-user-menu");
    }
    await page.keyboard.press("Escape");
  });

  test("shell: the auth pages, and what each one says when it fails", async ({ page }) => {
    await page.context().clearCookies();

    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: en["auth.login.title"] })).toBeVisible();
    await shot(page, "shell", "login");
    await loginError(page);
    await shot(page, "shell", "login-error");

    await page.goto("/register?code=E2E-CODE");
    await expect(page.getByRole("heading", { level: 1, name: en["auth.register.title"] })).toBeVisible();
    await shot(page, "shell", "register");
    await registerError(page);
    await shot(page, "shell", "register-error");
  });

  test("shell: the legal page", async ({ page, asUser }) => {
    await asUser("demo");
    await page.goto("/legal");
    await expect(page.getByRole("article")).toBeVisible();
    await shot(page, "shell", "legal");
  });

  // ---- grid: the results view and everything reachable from it (spec §3) --

  test("grid: results, the chip editors and the toolbar states", async ({ page }) => {
    await openGridWithCells(page);
    await shot(page, "grid", "results");

    if (!isMobile()) {
      await hoverTooltip(page);
      await shot(page, "grid", "hover-tooltip");
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toBeHidden();
    }

    await focusRing(page);
    await shot(page, "grid", "focus-ring");
    await page.keyboard.press("Escape");

    // The three chip editors the spec calls out by name (§3.2).
    await openChipEditor(page, "origins", "osaka");
    await shot(page, "grid", "origins");
    await closePopover(page);

    await openChipEditor(page, "dates");
    await shot(page, "grid", "dates");
    await closePopover(page);

    await openChipEditor(page, "programs", "alaska");
    await shot(page, "grid", "programs");
    await closePopover(page);

    // The one chip whose value changes what an empty cell MEANS, at a value other than its
    // default (issue #18): the summary reads "75% and up" and the hint names the same figure.
    await openMixedCabin(page, 75);
    await shot(page, "grid", "mixed-cabin");
    await closePopover(page);
    await resetChips(page);

    // Modified but not yet run: outlined chip, Run affordance, dimmed grid (§3.7).
    await makeModified(page);
    await expect(page.locator(".ag-wrap")).toHaveAttribute("data-dimmed", "true");
    await shot(page, "grid", "modified");
    await resetChips(page);

    await setRows(page, "routes");
    await expect(grid(page).locator("tbody th[role='rowheader']").first()).toContainText(/[A-Z]{3} → [A-Z]{3}/);
    await shot(page, "grid", "rows-routes");
    await setRows(page, "dates");

    // Cells: Per cabin — one 16 px line per cabin inside the same cell (§6.2b).
    await setCells(page, "per_cabin");
    await expect(page.locator(".ag-cabin-line").first()).toBeAttached();
    await shot(page, "grid", "cells-per-cabin");
    await setCells(page, "best");
    await expect(page.locator(".ag-cabin-line")).toHaveCount(0);

    for (const cabin of ["J", "F"] as const) {
      await setCabin(page, cabin);
      await expect(page.locator(".ag-cabin")).toHaveCount(0);
      await shot(page, "grid", `cabin-${cabin}`);
    }
    await setCabin(page, "both");

    await toggleDynamic(page);
    await expect(cells(page, "filtered")).toHaveCount(0);
    await shot(page, "grid", "dynamic-on");
  });

  test("grid: the cell drawer, and what Show flights does", async ({ page }) => {
    await openGridWithCells(page, { params: "askdemo=1" });

    const panel = await openCellDrawer(page);
    await shot(page, "grid", "cell-drawer");

    // Get Trips: in flight, failed, then the flight rows. A fresh drawer each time, so no
    // state photographs the leftovers of the one before it (the "Details copied" confirmation
    // does not time out, and rode into the loading capture when copy came first).
    const unrouteSlow = await showFlightsLoading(page, panel);
    await shot(page, "grid", "cell-drawer-loading");
    await unrouteSlow();
    await closeCellDrawer(page, panel);

    const failing = await openCellDrawer(page);
    const unrouteFail = await showFlightsError(page, failing);
    await shot(page, "grid", "cell-drawer-error");
    await unrouteFail();
    await closeCellDrawer(page, failing);

    const loaded = await openCellDrawer(page);
    await showFlights(page, loaded);
    await shot(page, "grid", "cell-drawer-flights");
    await closeCellDrawer(page, loaded);

    const copied = await openCellDrawer(page);
    await copyDetails(page, copied);
    await shot(page, "grid", "cell-drawer-copied");
  });

  test("grid: the Ask drawer, from empty to answered", async ({ page }) => {
    await openGridWithCells(page, { params: "askdemo=1" });

    const ask = await openAsk(page);
    await expect(ask.getByTestId("ask-suggestions").getByRole("button")).toHaveCount(3);
    await shot(page, "grid", "ask-open");

    await askStreaming(page, ask);
    await shot(page, "grid", "ask-streaming");

    await finishAsk(page, ask);
    await shot(page, "grid", "ask-answered");

    await expandAskTools(page, ask);
    await shot(page, "grid", "ask-tools");
  });

  test("grid: an answer stopped mid-sentence", async ({ page }) => {
    await openGridWithCells(page, { params: "askdemo=1" });
    const ask = await openAsk(page);
    await askStopped(page, ask);
    await shot(page, "grid", "ask-stopped");
  });

  test("grid: the Ask drawer carrying a selected cell", async ({ page }) => {
    await openGridWithCells(page, { params: "askdemo=1" });
    const ask = await openAskFromCell(page);
    await expect(ask.getByTestId("ask-pill-grid")).toBeVisible();
    await shot(page, "grid", "ask-with-cell");
  });

  test("grid: the Ask drawer with no key", async ({ page }) => {
    await openGridWithCells(page, { params: "askdemo=1&askerr=no_key" });
    const ask = await openAsk(page);
    await askNoKey(page, ask);
    await shot(page, "grid", "ask-no-key");
  });

  test("grid: the Ask drawer at the daily cap", async ({ page }) => {
    await openGridWithCells(page, { params: "askdemo=1&askcap=1" });
    const ask = await openAsk(page);
    await expect(ask.getByTestId("ask-prompt")).toBeDisabled();
    await shot(page, "grid", "ask-cap");
  });

  test("grid: results and both drawers in Chinese", async ({ page }) => {
    await openGridWithCells(page, { locale: "zh", params: "askdemo=1" });
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await shot(page, "grid", "results", { zh: true });

    const panel = await openCellDrawer(page);
    await expect(panel.getByTestId("drawer-caveat")).toHaveText(zh["grid.deeplink_caveat"]);
    await shot(page, "grid", "cell-drawer", { zh: true });
    await closeCellDrawer(page, panel, "zh");

    const ask = await openAsk(page, "zh");
    await expect(ask.getByTestId("ask-pill-grid")).toContainText(zh["ask.context.query"]);
    await shot(page, "grid", "ask-open", { zh: true });

    await askAnswered(page, ask, "zh");
    await shot(page, "grid", "ask-answered", { zh: true });
  });

  test("grid: no key", async ({ page }) => {
    await openGrid(page, { user: "nokey" });
    await expect(page.getByText(en["grid.empty.no_key"])).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: en["grid.empty.no_key_cta"] })).toBeVisible();
    await shot(page, "grid", "no-key");
  });

  test("grid: the start state and its Examples popover", async ({ page }) => {
    await openGrid(page, { run: false });
    await openExamples(page);
    await shot(page, "grid", "examples");
  });

  test("grid: a chip that blocks the run", async ({ page }) => {
    await openGridWithCells(page);
    await emptyOrigins(page);
    await shot(page, "grid", "chips-error");
  });

  test("grid: parse failure, and the chips escape hatch", async ({ page }) => {
    await openGrid(page, { run: false });
    await submitQuery(page, "国庆去东京");
    await expect(page.getByTestId("parse-failure")).toBeVisible({ timeout: 60_000 });
    await shot(page, "grid", "parse-failure");

    await openManualMode(page);
    await shot(page, "grid", "chips-manual");
  });

  test("grid: the loading skeleton", async ({ page }) => {
    const unroute = await delayFind(page);
    await openGrid(page);
    await expect(grid(page)).toHaveAttribute("aria-busy", "true", { timeout: 20_000 });
    await expect(page.getByTestId("cell-skeleton").first()).toBeVisible();
    await shot(page, "grid", "loading");
    await unroute();
    await expect(searching(page)).toBeHidden({ timeout: 60_000 });
  });

  test("grid: empty results", async ({ page }) => {
    await openGrid(page, { user: "empty" });
    await expect(page.getByTestId("grid-empty-results")).toBeVisible({ timeout: 60_000 });
    await shot(page, "grid", "empty-results");
  });

  test("grid: the quota banner", async ({ page }) => {
    await openGrid(page, { user: "quota" });
    await expect(page.getByTestId("quota-banner")).toBeVisible({ timeout: 60_000 });
    await shot(page, "grid", "quota");
  });

  test("grid: a program that was not fetched", async ({ page }) => {
    await openGridWithCells(page, { user: "partial" });
    const notFetched = cells(page, "not_fetched");
    expect(await notFetched.count()).toBeGreaterThan(0);
    await notFetched.first().scrollIntoViewIfNeeded();
    await shot(page, "grid", "not-fetched");
  });

  // ---- queries (spec §4) -------------------------------------------------

  test("queries: the list and everything a row opens", async ({ page }) => {
    await openQueries(page);
    await shot(page, "queries", "list");

    await expandFirstQuery(page);
    await shot(page, "queries", "expanded");
    await page.locator('[data-testid^="query-row-"]').first().getByRole("button", { name: en["saved.details"], exact: true }).click();

    const confirm = await confirmDeleteInline(page);
    await shot(page, "queries", "delete-confirm");
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);

    const drawer = await openEditQueryDrawer(page);
    await shot(page, "queries", "edit-drawer");
    await saveEditQueryDrawer(page, drawer);
    await shot(page, "queries", "edit-saved");

    // The "Standing query saved" toast lives 4 s (TOAST_MS in queries-table.tsx) and would ride
    // into the next two captures, putting a confirmation on a state that does not produce one —
    // the same leak already fixed for the cell drawer's "Details copied" below.
    await expect(page.getByTestId("queries-toast")).toHaveCount(0, { timeout: 10_000 });

    await runNowStubbed(page);
    await shot(page, "queries", "run-now");

    await runNowFailed(page);
    await shot(page, "queries", "run-now-error");
  });

  test("queries: the empty state", async ({ page }) => {
    await openQueries(page, "empty");
    await expect(page.getByTestId("queries-empty")).toBeVisible();
    await shot(page, "queries", "empty");
  });

  // ---- settings (spec §5) ------------------------------------------------

  test("settings: the page, seats.aero, the key form, the account and the toggles", async ({ page }) => {
    await openSettings(page);
    await shot(page, "settings", "default");

    await openAddKeyForm(page);
    await shot(page, "settings", "keys-add");
    await page.locator('[data-key-row="duffel"]').getByRole("button", { name: en["common.cancel"] }).click();

    await showSeatsDisconnectConfirm(page);
    await shot(page, "settings", "seats-disconnect");
    await keepSeatsConnected(page);

    await showSettingsSection(page, "account");
    await shot(page, "settings", "change-password");

    await showSettingsSection(page, "language");
    await shot(page, "settings", "language-theme");
  });

  test("settings: the page in Chinese", async ({ page }) => {
    // Through the locale cookie, not the radio: setting the radio writes the account's language.
    await openSettings(page, "demo", "zh");
    await expect(page.getByRole("heading", { level: 2, name: zh["settings.keys.title"] })).toBeVisible();
    await shot(page, "settings", "language-theme", { zh: true });
  });

  test("settings: linking Telegram", async ({ page }) => {
    await openSettings(page);
    await openTelegramInvite(page);
    await shot(page, "settings", "telegram-unlinked");
  });

  test("settings: a linked account", async ({ page }) => {
    await openSettings(page, "linked");
    await expect(page.locator("[data-telegram-status]")).toHaveText(en["settings.telegram.status.linked"]);
    await shot(page, "settings", "telegram-linked");
  });

  // ---- the matrix itself -------------------------------------------------

  test("the matrix is complete for this project", async () => {
    const { viewport, theme } = projectSuffix(test.info().project.name);
    const root = path.resolve(import.meta.dirname, "..", ...SHOT_ROOT.split("/"));
    const missing: string[] = [];
    for (const entry of MATRIX) {
      if (entry.viewports && !entry.viewports.includes(viewport)) continue;
      const file = shotFile(entry.state, viewport, theme, entry.zh);
      const dir = path.join(root, entry.page);
      const present = readdirSync(dir, { withFileTypes: true }).some((d) => d.isFile() && d.name === file);
      if (!present) missing.push(`${entry.page}/${file}`);
    }
    expect(missing, "matrix entries with no PNG on disk").toEqual([]);
  });
});
