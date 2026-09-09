/**
 * Phase 6.4 — the cell drawer (spec §3.5, §6, §8; docs/UI_PLAN.md §6.5). One test per state,
 * asserting the semantics the spec pins: a labelled role=dialog, programs sorted by miles, the
 * confirmation line directly above "Open in <program>" in DOM order, the h2/h3 heading
 * structure, and Esc returning focus to the cell that opened the drawer.
 *
 * The two Get Trips states are driven by intercepting /api/trips (a delayed continue for
 * "loading", a 502 for "error") rather than by a mock scenario key: every "slow" seed user is
 * already claimed by grid.spec.ts and chips.spec.ts, and the suite runs single-worker, so
 * borrowing one here would warm its availability cache and take the loading state away from the
 * spec that owns it. Nothing in scripts/mock-seatsaero.ts needed changing.
 *
 * This spec asserts; it does not photograph. Every capture of these states is declared in
 * `e2e/matrix.ts` and written by `e2e/screenshots.spec.ts` (#34) — one owner per file.
 */
import type { Locator, Page } from "@playwright/test";
import { en } from "@awardgrid/core/i18n/dictionaries/en";
import { zh } from "@awardgrid/core/i18n/dictionaries/zh";
import { applyTheme, availableCells, CANONICAL_QUERY_EN, CANONICAL_QUERY_ZH, expect, loginAs, openGridWithResults, projectSuffix, test } from "./fixtures";

const isMobile = () => projectSuffix(test.info().project.name).viewport === "mobile";

interface CellPos {
  row: string | undefined;
  col: string | undefined;
}

const drawer = (page: Page) => page.getByTestId("cell-drawer");

/** Data coordinates of the focused grid cell, or null when focus is elsewhere. */
function focusedCell(page: Page): Promise<CellPos | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el.getAttribute("role") !== "gridcell") return null;
    return { row: el.dataset.row, col: el.dataset.col };
  });
}

/**
 * Focus the first cell that has miles and open the drawer from the keyboard (Enter), so the
 * "focus goes back to the cell" assertion is testing the real walk and not a mouse side effect.
 */
async function openDrawer(page: Page): Promise<{ panel: Locator; cell: CellPos }> {
  const cell = availableCells(page).first();
  await cell.scrollIntoViewIfNeeded();
  await cell.focus();
  const pos = await cell.evaluate((el) => ({ row: (el as HTMLElement).dataset.row, col: (el as HTMLElement).dataset.col }));
  await page.keyboard.press("Enter");
  const panel = drawer(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("program-row").first()).toBeVisible();
  return { panel, cell: pos };
}

/** The grid in Chinese, without going through the English-named query box (grid.spec.ts §zh). */
async function openGridZh(page: Page): Promise<void> {
  await loginAs(page, "demo");
  const baseURL = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3400");
  await page.context().addCookies([{ name: "ag_locale", value: "zh", domain: baseURL.hostname, path: "/" }]);
  await page.goto("/grid");
  const box = page.getByRole("textbox", { name: zh["grid.search"] });
  await box.fill(CANONICAL_QUERY_ZH);
  await box.press("Enter");
  await expect(page.getByRole("grid")).toBeVisible({ timeout: 60_000 });
  await expect(availableCells(page).first()).toBeVisible({ timeout: 60_000 });
}

test.describe("cell drawer", () => {
  test.beforeEach(async ({ page }) => {
    await applyTheme(page);
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);
  });

  test("opens as a labelled dialog, sorted by miles, with the confirmation line above the button", async ({ page }) => {
    const { panel, cell } = await openDrawer(page);

    // role=dialog, named by the route as words ("HKG to SEA"): the drawn "→" is aria-hidden.
    await expect(panel).toHaveAttribute("role", "dialog");
    await expect(panel).toHaveAttribute("aria-label", /^[A-Z]{3} to [A-Z]{3}$/);

    // One h2 (the route) and one h3 per program.
    const programs = panel.getByTestId("program-row");
    const count = await programs.count();
    expect(count).toBeGreaterThan(0);
    await expect(panel.getByRole("heading", { level: 2 })).toHaveCount(1);
    await expect(panel.getByRole("heading", { level: 3 })).toHaveCount(count);

    // Every program for this cell, sorted by miles (spec §3.5) whatever the grid's own sort is.
    const miles = await panel
      .getByTestId("program-miles")
      .evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.miles)));
    expect(miles).toHaveLength(count);
    expect(miles).toEqual([...miles].sort((a, b) => a - b));

    // The confirmation line is body text directly above the button, never a tooltip (§3.5).
    await expect(panel.getByTestId("drawer-caveat")).toHaveText(en["grid.deeplink_caveat"]);
    const order = await panel.evaluate((el) => {
      const caveat = el.querySelector("[data-testid='drawer-caveat']");
      const open = el.querySelector("[data-testid='drawer-open']");
      if (!caveat || !open) return "missing";
      return caveat.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING ? "caveat-first" : "button-first";
    });
    expect(order).toBe("caveat-first");
    await expect(panel.getByTestId("drawer-copy")).toBeVisible();
    await expect(panel.getByRole("button", { name: en["grid.save_query"] })).toBeVisible();

    // Desktop presents the drawer at 480 px (spec §3.5); below 768 it is a full-height sheet (§6).
    await expect(panel).toHaveAttribute("data-mode", isMobile() ? "sheet" : "push");
    if (!isMobile()) expect((await panel.boundingBox())?.width).toBe(480);


    // Esc closes and hands focus back to the cell that opened it (§3.4 keyboard model).
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    expect(await focusedCell(page)).toEqual(cell);
  });

  test("shows flights: skeleton while the call is in flight, then the flight rows", async ({ page }) => {
    // Hold the Get Trips response long enough to photograph the skeleton, then let it through.
    await page.route("**/api/trips/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });
    const { panel } = await openDrawer(page);
    const program = panel.getByTestId("program-row").first();

    // The cost of the call is on the button, not shouted beside it (docs/UI_PLAN.md §8 row 11).
    const button = program.getByTestId("show-flights");
    await expect(button).toHaveAttribute("title", en["grid.sheet.load_trips_cost"]);
    await button.click();

    await expect(program.getByTestId("flights-skeleton")).toBeVisible();

    await expect(program.getByTestId("flights-list")).toBeVisible({ timeout: 30_000 });
    await page.unroute("**/api/trips/**");
    // Airport-local times are printed as given, never converted (ARCHITECTURE §2.3).
    await expect(program.getByTestId("flights-list")).toContainText(/\d{2}:\d{2}/);
    await expect(program.getByTestId("flights-skeleton")).toHaveCount(0);
  });

  test("says what failed and retries, without losing the drawer", async ({ page }) => {
    let fail = true;
    await page.route("**/api/trips/**", async (route) => {
      if (!fail) return route.continue();
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "seatsaero", kind: "upstream" }) });
    });
    const { panel } = await openDrawer(page);
    const program = panel.getByTestId("program-row").first();
    await program.getByTestId("show-flights").click();

    const error = program.getByTestId("flights-error");
    await expect(error).toContainText(en["grid.drawer.flights_error"]);

    fail = false;
    await program.getByTestId("flights-retry").click();
    await expect(program.getByTestId("flights-list")).toBeVisible({ timeout: 30_000 });
    await expect(program.getByTestId("flights-error")).toHaveCount(0);
  });

  test("copies the details as plain text and says so", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    const { panel } = await openDrawer(page);
    await panel.getByTestId("drawer-copy").click();
    await expect(panel.getByTestId("drawer-toast")).toHaveText(en["grid.sheet.copied"]);

    // The confirmation line travels with the copied block, so a pasted plan carries the caveat.
    const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
    if (copied) expect(copied).toContain(en["grid.deeplink_caveat"]);
  });

  /**
   * Spec §3 and §11: the two right-hand drawers are mutually exclusive. The unit test covers the
   * reducer; this covers the wiring — the toolbar's Ask button and a cell click land in the same
   * slot, so one drawer is on screen at a time and neither is left behind in the DOM.
   */
  test("the cell drawer and the Ask drawer replace each other", async ({ page }) => {
    test.skip(isMobile(), "below 768 px the cell sheet covers the toolbar the Ask button lives in");
    const { panel } = await openDrawer(page);

    // Ask, from the toolbar beside the pushed drawer: the cell drawer goes.
    await page.getByRole("button", { name: en["ask.open"], exact: true }).click();
    const ask = page.getByTestId("ask-drawer");
    await expect(ask).toBeVisible();
    await expect(panel).toBeHidden();
    await expect(page.getByRole("dialog")).toHaveCount(1);

    // A cell click while Ask is open: the Ask drawer goes, the cell drawer comes back.
    await availableCells(page).first().click();
    await expect(drawer(page)).toBeVisible();
    await expect(ask).toBeHidden();
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });


  /**
   * Spec §3.5: "Save as standing query (prefilled to this route and a ±3-day window)". The saved
   * query is NOT the query on the grid, so the dialog has to say what it will watch before the
   * user commits to it (§1.3) — the prefilled name only carries the cell's single date.
   */
  test("the save dialog says the route and the ±3-day window it will watch", async ({ page }) => {
    // Nothing is persisted: the POST is intercepted, read and answered here, so the e2e database
    // (and every other spec's /queries page) is left exactly as it was found.
    let posted: { origins?: string[]; destinations?: string[]; date_from?: string; date_to?: string } | null = null;
    await page.route("**/api/queries", async (route, request) => {
      if (request.method() !== "POST") return route.continue();
      posted = (JSON.parse(request.postData() ?? "{}") as { query?: typeof posted }).query ?? null;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          query: { id: "test", name: "test", schedule_cron: "0 */3 * * *", notify_on: "both", drop_threshold_pct: 10, enabled: true },
        }),
      });
    });

    const { panel } = await openDrawer(page);
    await panel.getByRole("button", { name: en["grid.save_query"] }).click();
    // By accessible name: the drawer behind it also *contains* the words (its Save button).
    const dialog = page.getByRole("dialog", { name: en["saved.dialog.save_title"] });
    await expect(dialog).toBeVisible();

    // It no longer claims to re-run "this exact query" — it re-runs the route and the window.
    await expect(dialog).toContainText(en["saved.dialog.save_body_cell"]);
    await expect(dialog).not.toContainText(en["saved.dialog.save_body"]);

    // The scope line names the route, the window and the cabins, before anything is saved.
    const scope = dialog.getByTestId("save-query-scope");
    await expect(scope).toBeVisible();
    await expect(scope).toHaveText(/^Watches [A-Z]{3} to [A-Z]{3}, .+\.$/);

    await dialog.getByRole("button", { name: en["saved.dialog.submit"], exact: true }).click();
    await expect(dialog.getByText(en["saved.dialog.saved"])).toBeVisible();

    // …and the line was telling the truth: one route, a window of at most ±3 days (spec §3.5).
    expect(posted).not.toBeNull();
    const saved = posted as unknown as { origins: string[]; destinations: string[]; date_from: string; date_to: string };
    expect(saved.origins).toHaveLength(1);
    expect(saved.destinations).toHaveLength(1);
    const days = (Date.parse(`${saved.date_to}T00:00:00Z`) - Date.parse(`${saved.date_from}T00:00:00Z`)) / 86_400_000;
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(6);
    await page.unroute("**/api/queries");
  });

  /**
   * Spec §3.6's cell pill can only exist if the selection outlives the cell drawer: opening Ask
   * puts Ask in the same single slot. "Ask about this cell" is the entry point that makes the
   * walk possible, and the pill is what proves the cell really travelled with it.
   */
  test("Ask about this cell carries the selection into the Ask drawer", async ({ page }) => {
    const { panel } = await openDrawer(page);
    await panel.getByTestId("drawer-ask").click();

    const ask = page.getByTestId("ask-drawer");
    await expect(ask).toBeVisible();
    await expect(drawer(page)).toBeHidden();
    // "Selected: NRT→SEA Sep 6 J 70,000 Aeroplan" (spec §3.6, verbatim format).
    const pill = ask.getByTestId("ask-pill-cell");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText(/^Selected: [A-Z]{3}→[A-Z]{3} .+ [FJWY] [\d,]+ .+$/);
    await expect(pill).toHaveAttribute("aria-pressed", "true");

    // Switching it off is how the user stops the cell being sent (the pill is a real toggle).
    await pill.click();
    await expect(pill).toHaveAttribute("aria-pressed", "false");
  });

  test("every action in the mobile sheet is a 40 px touch target (spec §3.4)", async ({ page }) => {
    test.skip(!isMobile(), "the 40 px rule applies to the sheet and bottom-sheet presentations");
    const { panel } = await openDrawer(page);
    const heights = await panel.locator("[data-slot='button']").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(3);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(40);
  });

  test("is a full-height sheet below 768 px", async ({ page }) => {
    test.skip(!isMobile(), "the sheet presentation only exists below 768 px");
    const { panel } = await openDrawer(page);
    await expect(panel).toHaveAttribute("data-mode", "sheet");
    const box = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(box?.width).toBe(viewport?.width);
  });
});

/**
 * The drawer is a state of the grid page, and §9's capture matrix adds zh-CN for that page, so
 * the drawer gets the same two languages. Nothing here re-asserts the semantics the English
 * tests pin: this is about the copy reading in the UI language and the panel still fitting.
 */
test.describe("cell drawer in Chinese", () => {
  test.beforeEach(async ({ page }) => {
    await applyTheme(page);
    await openGridZh(page);
  });

  test("reads in the UI language and fits the panel", async ({ page }) => {
    const { panel } = await openDrawer(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(panel.getByTestId("drawer-caveat")).toHaveText(zh["grid.deeplink_caveat"]);
    await expect(panel.getByRole("button", { name: zh["grid.save_query"] })).toBeVisible();
    await expect(panel.getByTestId("drawer-ask")).toHaveText(zh["grid.drawer.ask_about"]);
    // No horizontal overflow inside the 480 px panel (or the full-width sheet below 768 px).
    const overflow = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
