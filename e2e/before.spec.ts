/**
 * Phase 6.0 "before" screenshots of the CURRENT UI (spec §0, §9): every page and state, per
 * project (desktop/mobile × light/dark), saved as
 * docs/screenshots/v0.2/before/<page>-<state>-<viewport>-<theme>.png.
 *
 * These are plain page.screenshot() captures, not toHaveScreenshot baselines — the point is to
 * document what the redesign starts from. Everything on screen is synthetic demo data.
 *
 * The PNGs under docs/screenshots/v0.2/before/ are the record of the v0.1 UI and are not
 * regenerated; run this spec with E2E_BEFORE_DIR=<scratch dir> to check it still passes.
 * Copy is read from the en dictionary so the 6.1 i18n audit did not break the assertions.
 */
import { en } from "../src/lib/i18n/dictionaries/en";
import { applyTheme, beforeShot, closeDrawer, expect, openAskDrawer, openCellDrawer, openGridWithResults, queryBox, submitQuery, test } from "./fixtures";

test.describe("before: current UI", () => {
  test.beforeEach(async ({ page }) => {
    await applyTheme(page);
  });

  test("login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await beforeShot(page, "login");
  });

  test("register", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    await beforeShot(page, "register");
  });

  test("grid-empty", async ({ page, asUser }) => {
    await asUser("demo");
    await page.goto("/grid");
    await expect(queryBox(page)).toBeVisible();
    await expect(page.getByText(en["grid.empty.start"])).toBeVisible();
    await beforeShot(page, "grid-empty");
  });

  test("grid-results, cell drawer and ask drawer", async ({ page }) => {
    await openGridWithResults(page);
    await beforeShot(page, "grid-results");

    await openCellDrawer(page);
    await beforeShot(page, "grid-cell-drawer");
    await closeDrawer(page);

    await openAskDrawer(page);
    await beforeShot(page, "grid-ask-drawer");
    await closeDrawer(page);
  });

  test("grid-nokey", async ({ page, asUser }) => {
    await asUser("nokey");
    await page.goto("/grid");
    await expect(page.getByRole("alert").getByText(en["grid.empty.no_key"])).toBeVisible();
    await beforeShot(page, "grid-nokey");
  });

  test("grid-quota", async ({ page, asUser }) => {
    await asUser("quota");
    await page.goto("/grid");
    await submitQuery(page, "HKG, SHA, TYO, SEL to SEA, next 30 days, business and first");
    await expect(page.getByRole("alert").getByText(/daily limit reached|quota/i)).toBeVisible({ timeout: 60_000 });
    await beforeShot(page, "grid-quota");
  });

  test("grid-empty-results", async ({ page, asUser }) => {
    await asUser("empty");
    await page.goto("/grid");
    await submitQuery(page, "HKG, SHA, TYO, SEL to SEA, next 30 days, business and first");
    await expect(page.getByText(en["grid.empty.no_results"])).toBeVisible({ timeout: 60_000 });
    await beforeShot(page, "grid-empty-results");
  });

  test("queries", async ({ page, asUser }) => {
    await asUser("demo");
    await page.goto("/queries");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("link", { name: "Asia to Seattle, business and first" })).toBeVisible();
    await beforeShot(page, "queries");
  });

  test("queries-empty", async ({ page, asUser }) => {
    await asUser("empty");
    await page.goto("/queries");
    await expect(page.getByText(en["saved.empty"])).toBeVisible();
    await beforeShot(page, "queries-empty");
  });

  test("settings", async ({ page, asUser }) => {
    await asUser("demo");
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await beforeShot(page, "settings");
  });

  test("legal", async ({ page, asUser }) => {
    await asUser("demo");
    await page.goto("/legal");
    await expect(page.getByRole("article")).toBeVisible();
    await beforeShot(page, "legal");
  });
});
