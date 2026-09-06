/**
 * Phase 6.5 — the Queries page (spec §4, §6, §8; docs/UI_PLAN.md §6.7). One test per state,
 * asserting the semantics the spec pins: the delete confirmation is inline in the row and NOT
 * a dialog, the row expand is a real aria-expanded/aria-controls disclosure, the switch actually
 * PATCHes, the edit drawer carries the grid's own chips, and "Run now" leaves its result — or
 * its error — in the row rather than in a modal.
 *
 * The demo user is seeded (scripts/seed-e2e.ts) with one standing query and three recorded runs:
 * a skipped one six hours ago, a baseline four hours ago, and the last run whose diff against
 * that baseline is "+3 new, −1 dropped". The two "Run now" outcomes are driven by intercepting
 * POST /api/queries/*&#47;run so the states are deterministic and cost the mock nothing; every
 * other interaction hits the real routes.
 *
 * This spec asserts; it does not photograph. Every capture of these states is declared in
 * `e2e/matrix.ts` and written by `e2e/screenshots.spec.ts` (#34) — one owner per file.
 */
import type { Locator, Page } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import { applyTheme, expect, projectSuffix, test } from "./fixtures";
import { E2E_SAVED_QUERY_NAME } from "./users";

const isMobile = () => projectSuffix(test.info().project.name).viewport === "mobile";

const firstRow = (page: Page): Locator => page.locator('[data-testid^="query-row-"]').first();
const detailsButton = (page: Page) => firstRow(page).getByRole("button", { name: en["saved.details"], exact: true });
const runButton = (page: Page) => firstRow(page).getByRole("button", { name: en["saved.run_now"], exact: true });
const editButton = (page: Page) => firstRow(page).getByRole("button", { name: en["saved.edit"], exact: true });
const deleteButton = (page: Page) => firstRow(page).getByRole("button", { name: en["saved.delete"], exact: true }).first();
const enabledSwitch = (page: Page) => firstRow(page).getByRole("switch").first();
const drawer = (page: Page) => page.getByTestId("edit-query-drawer");

/** Open /queries as the demo user and wait for the seeded row. */
async function openQueries(page: Page, asUser: (u: "demo" | "empty") => Promise<void>, user: "demo" | "empty" = "demo"): Promise<void> {
  await asUser(user);
  await page.goto("/queries");
  await expect(page.getByRole("heading", { name: en["saved.title"] })).toBeVisible();
  if (user === "demo") await expect(firstRow(page)).toBeVisible();
}

test.describe("queries page", () => {
  test.beforeEach(async ({ page }) => {
    await applyTheme(page);
  });

  test("lists every standing query with its schedule, last run and next run", async ({ page, asUser }) => {
    await openQueries(page, asUser);
    const row = firstRow(page);
    await expect(row).toContainText(E2E_SAVED_QUERY_NAME);
    // "every 3 hours" — the human schedule, not a cron expression.
    await expect(row).toContainText("every 3 hours");
    await expect(row).not.toContainText("*/3");
    // The last run: a relative time plus what it found.
    await expect(row).toContainText(/ago|now/);
    await expect(row).toContainText("+3 new, −1 dropped");
    await expect(row).toContainText(en["saved.notify.both"]);
    await expect(row.getByRole("switch")).toHaveCount(1);

    if (isMobile()) {
      await expect(page.getByTestId("queries-list")).toBeVisible();
      await expect(page.getByTestId("queries-table")).toHaveCount(0);
      // Touch targets: the row's actions are at least 40 px tall (spec §6).
      const box = await runButton(page).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
      // Restacking is licensed (spec §6); dropping a column is not. The card carries the same
      // seven facts as the table row, "Notifies on" included.
      await expect(row).toContainText(en["saved.notify.both"]);
      // The stacked list IS the mobile capture: `list-mobile-<theme>.png` below already holds it,
      // so there is no separate "mobile-list" file to keep in step with it.
    } else {
      const table = page.getByTestId("queries-table");
      await expect(table).toBeVisible();
      for (const head of [en["saved.name"], en["saved.schedule"], en["saved.notify_on"], en["saved.last_run"], en["saved.next_run"], en["saved.enabled"], en["saved.actions"]]) {
        await expect(table.getByRole("columnheader", { name: head, exact: true })).toBeVisible();
      }
    }
  });

  test("row expand is a disclosure showing the last diff as real grid cells and the last runs", async ({ page, asUser }) => {
    await openQueries(page, asUser);
    const toggle = detailsButton(page);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const controls = await toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const panel = page.locator(`#${controls}`);
    await expect(panel).toBeVisible();

    // New cells are drawn with the grid's own cell component, so they are real gridcells.
    const newCells = page.getByTestId("diff-new").locator("td[role='gridcell'][data-state='ok']");
    await expect(newCells).toHaveCount(3);
    await expect(newCells.first()).toContainText(/\d/);
    // Dropped cells carry the muted tag, so the state never rides on colour alone.
    const dropped = page.getByTestId("diff-dropped");
    await expect(dropped.locator("td[role='gridcell']")).toHaveCount(1);
    await expect(dropped).toContainText(en["saved.diff.dropped_tag"]);

    // The third bucket: a cell that survived at a lower price. shouldNotify fires on these, so
    // the page has to show them — otherwise a run whose only change was a price drop reads as
    // "no change" while the Telegram digest said prices fell.
    const cheaper = page.getByTestId("diff-price_drop");
    await expect(cheaper.locator("td[role='gridcell']")).toHaveCount(1);
    await expect(cheaper).toContainText(en["saved.diff.price_drops"]);
    await expect(cheaper).toContainText("−15% from 60,000");

    // The run history: three seeded runs, one of them skipped for the daily limit.
    const runs = panel.locator("table.aq-runs tbody tr");
    await expect(runs).toHaveCount(3);
    await expect(panel).toContainText(`skipped: ${en["saved.skip.quota"]}`);
    await expect(panel.getByRole("columnheader", { name: en["saved.runs.calls_used"] })).toBeVisible();
    // `query_runs.calls_used` (drizzle/0002): the column prints the seeded counts, not an en dash.
    // The quota-refused run is an exact 0 — it never reached the network.
    await expect(runs.nth(0)).toContainText("24");
    await expect(runs.nth(1)).toContainText("27");
    await expect(runs.nth(2)).toContainText("0");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveCount(0);
  });

  test("delete confirms inline in the row, never in a dialog", async ({ page, asUser }) => {
    await openQueries(page, asUser);
    await deleteButton(page).click();

    const confirm = page.getByTestId(/^delete-confirm-/);
    await expect(confirm).toBeVisible();
    // The question names the query (docs/UI_PLAN.md §6.7), so "this" is never left unanchored.
    await expect(confirm).toContainText(E2E_SAVED_QUERY_NAME);
    await expect(confirm).toContainText("Delete");
    await expect(confirm.getByRole("button", { name: en["saved.keep"], exact: true })).toBeVisible();
    // Spec §11: inline, never modal. Nothing on the page claims to be a dialog.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("[aria-modal='true']")).toHaveCount(0);
    // The row it belongs to is still on screen and still readable behind the decision.
    await expect(firstRow(page)).toContainText(E2E_SAVED_QUERY_NAME);

    // Focus went to the destructive button (the thing just asked for).
    await expect(confirm.getByRole("button", { name: en["saved.delete"], exact: true })).toBeFocused();

    // Esc cancels, and focus goes BACK to the Delete button — not to <body>, which would make a
    // keyboard user tab through the whole shell to return to the row.
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(deleteButton(page)).toBeFocused();

    // Keep does the same, and keeps the query: the suite's other tests still need it.
    await deleteButton(page).click();
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: en["saved.keep"], exact: true }).click();
    await expect(confirm).toHaveCount(0);
    await expect(deleteButton(page)).toBeFocused();
    await expect(firstRow(page)).toBeVisible();
  });

  test("the enabled switch pauses the query through PATCH", async ({ page, asUser }) => {
    await openQueries(page, asUser);
    const toggle = enabledSwitch(page);
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    const patch = page.waitForRequest((r) => r.method() === "PATCH" && /\/api\/queries\/[^/]+$/.test(new URL(r.url()).pathname));
    await toggle.click();
    const request = await patch;
    expect(request.postData()).toContain('"enabled":false');
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    // A paused query has no next run to promise.
    await expect(firstRow(page)).toContainText(en["saved.paused"]);

    // Put it back, so the rest of the suite sees the seeded state.
    const patchBack = page.waitForRequest((r) => r.method() === "PATCH" && /\/api\/queries\/[^/]+$/.test(new URL(r.url()).pathname));
    await toggle.click();
    await patchBack;
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("edit opens the drawer with the grid's own chips", async ({ page, asUser }) => {
    await openQueries(page, asUser);
    await editButton(page).click();
    const panel = drawer(page);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: en["saved.dialog.edit_title"] })).toBeVisible();
    await expect(panel.getByLabel(en["saved.name"], { exact: true })).toHaveValue(E2E_SAVED_QUERY_NAME);
    await expect(panel.getByLabel(en["saved.schedule"], { exact: true })).toBeVisible();
    await expect(panel.getByLabel(en["saved.notify_on"], { exact: true })).toBeVisible();

    // The same seven chips as the grid, in the same order, inside the drawer.
    const chips = panel.getByRole("region", { name: en["grid.chips.title"] });
    await expect(chips).toBeVisible();
    for (const chip of [en["grid.chips.origins"], en["grid.chips.destinations"], en["grid.chips.dates"], en["grid.chips.cabins"], en["grid.chips.programs"], en["grid.chips.direct_only"], en["grid.chips.sort"]]) {
      await expect(chips.getByRole("button", { name: new RegExp(`^${chip}`) }).first()).toBeVisible();
    }

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("saving the drawer patches the query and says so once", async ({ page, asUser }) => {
    await openQueries(page, asUser);
    await editButton(page).click();
    const panel = drawer(page);
    const threshold = panel.getByLabel(en["saved.drop_threshold"], { exact: true });
    await expect(threshold).toHaveValue("10");
    await threshold.fill("15");

    const patch = page.waitForRequest((r) => r.method() === "PATCH" && /\/api\/queries\/[^/]+$/.test(new URL(r.url()).pathname));
    await panel.getByTestId("edit-query-save").click();
    expect((await patch).postData()).toContain('"drop_threshold_pct":15');
    await expect(panel).toHaveCount(0);

    // One toast, one line, and it uses the verb the button used (docs/UI_PLAN.md §7, §8).
    const toast = page.getByTestId("queries-toast");
    await expect(toast).toHaveText(en["saved.updated"]);

    // Put the threshold back, so the seeded query is what the next test finds.
    await editButton(page).click();
    await panel.getByLabel(en["saved.drop_threshold"], { exact: true }).fill("10");
    await panel.getByTestId("edit-query-save").click();
    await expect(panel).toHaveCount(0);
  });

  test("editing a chip changes what the query watches, and it survives a reload", async ({ page, asUser }) => {
    await openQueries(page, asUser);
    const panel = drawer(page);

    /** Flip the "Direct only" chip inside the drawer and save; returns the PATCH body. */
    const flipDirectOnly = async (): Promise<string> => {
      await editButton(page).click();
      await expect(panel).toBeVisible();
      await panel.locator('[data-chip="direct_only"]').click();
      const popover = page.locator('[data-slot="popover-content"]');
      await expect(popover).toBeVisible();
      await popover.getByRole("switch", { name: en["grid.chips.direct_only"] }).click();
      await page.keyboard.press("Escape");
      const patch = page.waitForRequest((r) => r.method() === "PATCH" && /\/api\/queries\/[^/]+$/.test(new URL(r.url()).pathname));
      await panel.getByTestId("edit-query-save").click();
      const body = (await patch).postData() ?? "";
      await expect(panel).toHaveCount(0);
      return body;
    };

    // The chips ride along in the PATCH body, not just the schedule fields.
    expect(await flipDirectOnly()).toContain('"direct_only":true');
    await expect(page.getByTestId("queries-toast")).toHaveText(en["saved.updated"]);

    // The server kept them: a fresh render of the row shows the chip already on.
    await page.reload();
    await expect(firstRow(page)).toBeVisible();
    await editButton(page).click();
    await expect(panel.locator('[data-chip="direct_only"]')).toContainText(en["grid.chips.on"]);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    // Put it back, so the seeded query is what the next test finds.
    expect(await flipDirectOnly()).toContain('"direct_only":false');
    await page.reload();
    await expect(firstRow(page)).toBeVisible();
  });

  test("run now shows its result in the row, and its error inline", async ({ page, asUser }) => {
    await openQueries(page, asUser);

    // A finished run: the row reports what it found, in the row, not in a dialog.
    await page.route("**/api/queries/*/run", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          run: {
            id: "run-e2e-ok",
            ran_at: new Date().toISOString(),
            new_cells: 2,
            dropped_cells: 1,
            notified: false,
            skipped_reason: null,
            calls_used: 9,
          },
        }),
      }),
    );
    await runButton(page).click();
    // The notice is a row of its own under the query's row, so it is looked up on the page.
    const notice = page.getByTestId("row-notice");
    await expect(notice).toContainText("+2 new, −1 dropped");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The server derives the next run from the last one, so a query that just ran is no longer
    // due: the row says when it runs next instead of standing on "due now" until a reload.
    await expect(firstRow(page)).not.toContainText(en["saved.due_now"]);
    await expect(firstRow(page)).toContainText(/3 hours|hours/);

    // 409: another run is already in progress. Inline in the row, with what to do about it.
    await page.unroute("**/api/queries/*/run");
    await page.route("**/api/queries/*/run", (route) =>
      route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "run_in_progress" }) }),
    );
    await runButton(page).click();
    await expect(notice).toContainText(en["error.run_in_progress"]);
    await page.unroute("**/api/queries/*/run");
  });

  test("the empty state invites the first standing query", async ({ page, asUser }) => {
    await openQueries(page, asUser, "empty");
    const empty = page.getByTestId("queries-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(en["saved.empty"]);
    const cta = empty.getByRole("link", { name: en["saved.empty_cta"] });
    await expect(cta).toHaveAttribute("href", "/grid");
    // docs/UI_PLAN.md §6.7: "`Go to grid` link button, left-aligned, no box". It must still not
    // read as body text, so it carries the accent and the underline every link on the page has —
    // and it must NOT carry a border, which is what §4 reserves for controls.
    const style = await cta.evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopWidth, color: s.color, decoration: s.textDecorationLine, accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() };
    });
    expect(parseFloat(style.border)).toBe(0);
    expect(style.decoration).toContain("underline");
    expect(style.color).not.toBe("");
    expect(style.accent).not.toBe("");
  });
});
