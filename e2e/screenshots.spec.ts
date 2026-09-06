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
 * (grid, chips, cell-drawer, ask-drawer, queries, settings, shell).
 *
 * Everything is offline: the DEMO=1 mock, the seeded users, the scripted Ask stream. Nothing
 * here writes to the e2e database (see the interception note in e2e/states.ts).
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import { applyTheme, expect, projectSuffix, submitQuery, test } from "./fixtures";
import { MATRIX, SHOT_ROOT, shotFile, type MatrixPage, type MatrixShot } from "./matrix";
import {
  askStreaming,
  capture,
  cells,
  closeCellDrawer,
  closePopover,
  confirmDeleteInline,
  delayFind,
  expandFirstQuery,
  focusRing,
  grid,
  hoverTooltip,
  isMobile,
  makeModified,
  openAddKeyForm,
  openAsk,
  openCellDrawer,
  openChipEditor,
  openEditQueryDrawer,
  openGrid,
  openGridWithCells,
  openQueries,
  openSettings,
  openTelegramInvite,
  resetChips,
  runNowStubbed,
  searching,
  setCabin,
  setRows,
  showFlights,
  showKeyError,
  showSettingsSection,
  stopAsk,
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
  await capture(page, pageName, state, { zh: opts.zh, fullPage: entry!.fullPage });
}

test.describe("screenshots", () => {
  test.beforeEach(async ({ page }) => {
    await applyTheme(page);
  });

  // ---- shell (spec §2) ---------------------------------------------------

  test("shell: the auth pages", async ({ page }) => {
    await page.context().clearCookies();

    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: en["auth.login.title"] })).toBeVisible();
    await shot(page, "shell", "login");

    await page.goto("/register?code=E2E-CODE");
    await expect(page.getByRole("heading", { level: 1, name: en["auth.register.title"] })).toBeVisible();
    await shot(page, "shell", "register");
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

    // Modified but not yet run: outlined chip, Run affordance, dimmed grid (§3.7).
    await makeModified(page);
    await expect(page.locator(".ag-wrap")).toHaveAttribute("data-dimmed", "true");
    await shot(page, "grid", "modified");
    await resetChips(page);

    await setRows(page, "routes");
    await expect(grid(page).locator("tbody th[role='rowheader']").first()).toContainText(/[A-Z]{3} → [A-Z]{3}/);
    await shot(page, "grid", "rows-routes");
    await setRows(page, "dates");

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

  test("grid: the two drawers", async ({ page }) => {
    await openGridWithCells(page, { params: "askdemo=1" });

    const panel = await openCellDrawer(page);
    await shot(page, "grid", "cell-drawer");
    await showFlights(page, panel);
    await shot(page, "grid", "cell-drawer-flights");
    await closeCellDrawer(page, panel);

    const ask = await openAsk(page);
    await expect(ask.getByTestId("ask-suggestions").getByRole("button")).toHaveCount(3);
    await shot(page, "grid", "ask-open");

    await askStreaming(page, ask);
    await shot(page, "grid", "ask-streaming");
    await stopAsk(page, ask);
  });

  test("grid: the Ask drawer at the daily cap", async ({ page }) => {
    await openGridWithCells(page, { params: "askdemo=1&askcap=1" });
    const ask = await openAsk(page);
    await expect(ask.getByTestId("ask-prompt")).toBeDisabled();
    await shot(page, "grid", "ask-cap");
  });

  test("grid: results in Chinese", async ({ page }) => {
    test.skip(isMobile(), "spec §9 asks for the grid page in zh-CN; the desktop pair is the record");
    await openGridWithCells(page, { locale: "zh" });
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await shot(page, "grid", "results", { zh: true });
  });

  test("grid: no key", async ({ page }) => {
    await openGrid(page, { user: "nokey" });
    await expect(page.getByText(en["grid.empty.no_key"])).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: en["grid.empty.no_key_cta"] })).toBeVisible();
    await shot(page, "grid", "no-key");
  });

  test("grid: parse failure", async ({ page }) => {
    await openGrid(page, { run: false });
    await submitQuery(page, "国庆去东京");
    await expect(page.getByTestId("parse-failure")).toBeVisible({ timeout: 60_000 });
    await shot(page, "grid", "parse-failure");
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
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);

    await runNowStubbed(page);
    await shot(page, "queries", "run-now");
  });

  test("queries: the empty state", async ({ page }) => {
    await openQueries(page, "empty");
    await expect(page.getByTestId("queries-empty")).toBeVisible();
    await shot(page, "queries", "empty");
  });

  // ---- settings (spec §5) ------------------------------------------------

  test("settings: the page, the key states, the account and the toggles", async ({ page }) => {
    await openSettings(page);
    await shot(page, "settings", "default");

    await openAddKeyForm(page);
    await shot(page, "settings", "keys-add");
    await page.locator('[data-key-row="duffel"]').getByRole("button", { name: en["common.cancel"] }).click();

    await showKeyError(page);
    await shot(page, "settings", "keys-error");

    await showSettingsSection(page, "account");
    await shot(page, "settings", "change-password");

    await showSettingsSection(page, "language");
    await shot(page, "settings", "language-theme");
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
