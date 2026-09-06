/**
 * Phase 6.2 — the grid (spec §3.3, §3.4, §3.7, §6, §8; docs/UI_PLAN.md §5–§7). One test per
 * page state, each capturing docs/screenshots/v0.2/grid/<state>-<viewport>-<theme>[-zh].png
 * (plain captures — toHaveScreenshot baselines arrive in 6.6) and asserting the semantics:
 * role=grid with aria-rowcount, the roving keyboard focus, the six cell states with their
 * pattern + label, the tooltip, the toolbar, the empty / quota / partial / loading states, and
 * no animation under prefers-reduced-motion. Everything on screen is seeded demo data.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import { zh } from "../src/lib/i18n/dictionaries/zh";
import { applyTheme, CANONICAL_QUERY_EN, CANONICAL_QUERY_ZH, expect, loginAs, projectIndex, projectSuffix, submitQuery, test, type E2eUsername } from "./fixtures";
import { E2E_SLOW_USERS } from "./users";

const GRID_DIR = path.resolve(import.meta.dirname, "..", "docs", "screenshots", "v0.2", "grid");

const isMobile = () => projectSuffix(test.info().project.name).viewport === "mobile";

/** Viewport PNG at docs/screenshots/v0.2/grid/<state>-<viewport>-<theme>[-zh].png. */
async function gridShot(page: Page, state: string, opts: { zh?: boolean } = {}): Promise<string> {
  const { viewport, theme } = projectSuffix(test.info().project.name);
  mkdirSync(GRID_DIR, { recursive: true });
  const file = path.join(GRID_DIR, `${state}-${viewport}-${theme}${opts.zh ? "-zh" : ""}.png`);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Bounded: the quota indicator keeps polling, so "networkidle" may never arrive.
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
  return file;
}

const grid = (page: Page) => page.getByRole("grid");
const cells = (page: Page, state?: string) => page.locator(state ? `td[role="gridcell"][data-state="${state}"]` : 'td[role="gridcell"]');
const toolbar = (page: Page) => page.getByRole("toolbar");
const searching = (page: Page) => page.getByTestId("grid-searching");

/** The toolbar controls: inline on desktop, inside the "Filters" sheet on mobile. */
async function openControls(page: Page): Promise<Locator> {
  if (!isMobile()) return toolbar(page);
  await toolbar(page).getByRole("button", { name: en["grid.toolbar.filters"] }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closeControls(page: Page): Promise<void> {
  if (!isMobile()) return;
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
}

/** Wait for a search to finish: the status line is gone and the table is not busy. */
async function settled(page: Page): Promise<void> {
  await expect(searching(page)).toBeHidden({ timeout: 60_000 });
  await expect(grid(page)).toBeVisible({ timeout: 60_000 });
  await expect(grid(page)).not.toHaveAttribute("aria-busy", "true");
}

/** Log in, open /grid, run the canonical query and wait for the results grid. */
async function openGrid(page: Page, user: E2eUsername = "demo", opts: { zh?: boolean } = {}): Promise<void> {
  await loginAs(page, user);
  if (opts.zh) {
    const baseURL = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3400");
    await page.context().addCookies([{ name: "ag_locale", value: "zh", domain: baseURL.hostname, path: "/" }]);
  }
  await page.goto("/grid");
  if (opts.zh) {
    // The query box is named in the UI language; the shared fixture only knows the English name.
    const box = page.getByRole("textbox", { name: zh["grid.search"] });
    await box.fill(CANONICAL_QUERY_ZH);
    await box.press("Enter");
  } else {
    await submitQuery(page, CANONICAL_QUERY_EN);
  }
}

async function expectResultsGrid(page: Page): Promise<void> {
  await settled(page);
  await expect(cells(page, "ok").first()).toBeVisible();
}

/** rgb() of a color token on :root, for toHaveCSS comparisons. */
async function tokenRgb(page: Page, token: string): Promise<string> {
  const hex = (await page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), token)).replace("#", "");
  return `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
}

/**
 * Number of `.ag-l1` lines that overflow once every column is forced to the spec's 112 px minimum
 * (the fixed-width layout the grid uses under column virtualization).
 */
function overflowingLinesAt112(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cols = document.querySelectorAll("thead th").length - 1;
    const style = document.createElement("style");
    style.textContent = `.ag-table{table-layout:fixed;width:${96 + 112 * cols}px;min-width:0}.ag-table thead th:not(.ag-corner),.ag-table td{width:112px;max-width:112px}`;
    document.head.appendChild(style);
    const n = Array.from(document.querySelectorAll<HTMLElement>(".ag-l1")).filter((el) => el.scrollWidth > el.clientWidth).length;
    style.remove();
    return n;
  });
}

/** Data coordinates of the focused grid cell, or null when focus is elsewhere. */
function focusedCell(page: Page): Promise<{ row: number; col: number } | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el.getAttribute("role") !== "gridcell") return null;
    return { row: Number(el.dataset.row), col: Number(el.dataset.col) };
  });
}

test.describe("grid", () => {
  test.beforeEach(async ({ page }) => {
    await applyTheme(page);
  });

  test("results: semantics, the six cell states, the legend", async ({ page }) => {
    await openGrid(page);
    await expectResultsGrid(page);
    const table = grid(page);

    // role=grid with aria-rowcount = dates + 1 (the header row) and aria-colcount = routes + 1.
    const rows = await table.locator("tbody tr[role='row']").count();
    const cols = await table.locator("thead th[role='columnheader']").count();
    await expect(table).toHaveAttribute("aria-rowcount", String(rows + 1));
    await expect(table).toHaveAttribute("aria-colcount", String(cols));
    expect(rows).toBeGreaterThanOrEqual(30);

    // Column headers are routes with the arrow notation and a muted program count; row headers are
    // dates with the ISO date in the title.
    const firstCol = table.locator("thead th[role='columnheader']").nth(1);
    await expect(firstCol).toContainText(/[A-Z]{3} → [A-Z]{3}/);
    // The count is programs MONITORING the pair from the routes catalog (all seven demo
    // programs list every monitored pair), not the programs with availability in this view.
    if (!isMobile()) await expect(firstCol.locator(".ag-head-sub")).toHaveText(en["grid.header.programs_other"].replace("{n}", "7"));
    const firstRow = table.locator("tbody th[role='rowheader']").first();
    await expect(firstRow).toHaveAttribute("title", /^\d{4}-\d{2}-\d{2}$/);
    // "Wed Oct 15" at ≥ 768 px; the 72 px sticky column below that drops the weekday ("Oct 15").
    await expect(firstRow).toHaveText(isMobile() ? /^[A-Z][a-z]{2} \d{1,2}$/ : /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/);

    // Sticky header and first column (both themes: the header paints its own ground).
    await expect(firstCol).toHaveCSS("position", "sticky");
    await expect(firstRow).toHaveCSS("position", "sticky");

    // Rows are exactly 48 px (40 px touch): the 1 px grid line is part of the row, so header
    // and body rows share one line grid (plan §4).
    const rowH = isMobile() ? 40 : 48;
    expect((await table.locator("thead tr").boundingBox())?.height).toBe(rowH);
    expect((await table.locator("tbody tr[role='row']").first().boundingBox())?.height).toBe(rowH);
    expect((await cells(page).first().boundingBox())?.height).toBe(rowH);

    // Available cells: aria-label sentence from the spec; the miles figure is weight 600.
    const ok = cells(page, "ok").first();
    await expect(ok).toHaveAttribute("aria-label", /^[A-Z]{3} to [A-Z]{3}, [A-Z][a-z]+ \d{1,2}, (business|first), [\d,]+ miles/);
    await expect(ok.locator(".ag-miles")).toHaveCSS("font-weight", "600");
    // Both cabins are shown, so every available cell carries a J/F tag (a glyph, not a color).
    await expect(ok.locator(".ag-cabin")).toHaveText(/^[JF]$/);
    // The freshness mark is an inline SVG whose shape carries the tier; the age text is always there.
    await expect(ok.locator("svg.ag-mark")).toHaveAttribute("data-shape", /^(dot|half|ring)$/);
    await expect(ok.locator(".ag-age span")).toHaveText(/^(now|\d+[mhd]|\?)$/);

    // No availability: one quiet en dash, aria "No availability".
    const none = cells(page, "none").first();
    await expect(none).toBeAttached();
    await expect(none).toHaveText(en["grid.cell.none"]);
    await expect(none).toHaveAttribute("aria-label", new RegExp(en["grid.cell.no_availability"]));

    // Not monitored (ICN→SEA in the demo dataset): hatch fill + title + aria text.
    const hatched = cells(page, "unmonitored").first();
    await expect(hatched).toBeAttached();
    await expect(hatched).toHaveAttribute("aria-label", new RegExp(en["grid.cell.not_monitored"]));
    await expect(hatched).toHaveAttribute("title", en["grid.cell.not_monitored"]);
    await expect(hatched).toHaveCSS("background-image", /repeating-linear-gradient/);
    // Its grid lines stay visible through the pattern: --line-strong, not --line, on the raised ground.
    await expect(hatched).toHaveCSS("border-bottom-color", await tokenRgb(page, "--line-strong"));
    await expect(hatched).toHaveCSS("border-right-color", await tokenRgb(page, "--line-strong"));

    // A visually hidden legend precedes the grid and the grid is described by it.
    const legend = page.locator("p.sr-only", { hasText: en["grid.legend"].slice(0, 24) });
    await expect(legend).toBeAttached();
    await expect(table).toHaveAttribute("aria-describedby", await legend.getAttribute("id").then((id) => id ?? ""));

    // Toolbar: rows toggle, cabin chips, the dynamic-pricing switch, Save and Export.
    const controls = await openControls(page);
    await expect(controls.getByRole("group", { name: en["grid.toolbar.rows"] }).getByRole("button", { name: en["grid.toolbar.rows_dates"] })).toHaveAttribute("aria-pressed", "true");
    await expect(controls.getByRole("group", { name: en["grid.toolbar.cabins"] }).getByRole("button", { name: en["grid.toolbar.cabin_both"] })).toHaveAttribute("aria-pressed", "true");
    await expect(controls.getByRole("switch", { name: en["grid.include_filtered"] })).toHaveAttribute("aria-checked", "false");
    // The muted note explains the cost of the switch only while the dynamic scope is not cached
    // (one app process serves every project, so an earlier project may have warmed it).
    if ((await cells(page, "filtered").count()) === 0) await expect(controls.getByText(en["grid.toolbar.dynamic_note"])).toBeVisible();
    else await expect(controls.getByText(en["grid.toolbar.dynamic_note"])).toHaveCount(0);
    await expect(controls.getByRole("button", { name: en["grid.save_query"] })).toBeEnabled();
    await expect(controls.getByRole("button", { name: en["grid.export_csv"] })).toBeEnabled();
    await closeControls(page);

    // Nothing in a cell is joined with a middle dot.
    await expect(table).not.toContainText("·");
    await gridShot(page, "results");
  });

  test("results in Chinese", async ({ page }) => {
    await openGrid(page, "demo", { zh: true });
    await expectResultsGrid(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    const table = grid(page);
    await expect(table).toHaveAttribute("aria-label", zh["grid.grid_label"]);
    await expect(cells(page, "ok").first()).toHaveAttribute("aria-label", /里程/);
    await expect(cells(page, "unmonitored").first()).toHaveAttribute("aria-label", new RegExp(zh["grid.cell.not_monitored"]));
    await expect(table.locator("thead th[role='columnheader']").nth(1)).toContainText(/里程计划/);
    await gridShot(page, "results", { zh: true });
  });

  test("hover: row and column headers highlight, the tooltip lists every program", async ({ page }) => {
    test.skip(isMobile(), "tooltips never open on touch (the tap opens the drawer)");
    await openGrid(page);
    await expectResultsGrid(page);
    // A cell with more than one program, so the sorted list is visible.
    const multi = page.locator('td[role="gridcell"][data-state="ok"]').filter({ has: page.locator(".ag-l3") }).first();
    await multi.hover();
    const tip = page.getByRole("tooltip");
    await expect(tip).toBeVisible();
    await expect(multi).toHaveAttribute("aria-describedby", await tip.getAttribute("id").then((id) => id ?? ""));
    await expect(tip).toContainText(/[A-Z]{3} → [A-Z]{3}/);
    const rows = tip.locator(".ag-tip-row");
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
    // Sorted by miles: each row's own freshness mark and age.
    const miles = await rows.locator(".ag-tip-miles").allTextContents();
    const numeric = miles.map((m) => Number(m.replace(/[^\d]/g, "")));
    expect([...numeric].sort((a, b) => a - b)).toEqual(numeric);
    await expect(rows.first().locator("svg.ag-mark")).toBeAttached();
    // Headers of the hovered cell are highlighted.
    const row = Number(await multi.getAttribute("data-row"));
    const col = Number(await multi.getAttribute("data-col"));
    await expect(page.locator(`tbody tr[aria-rowindex="${row + 2}"] th[role="rowheader"]`)).toHaveAttribute("data-hl", "true");
    await expect(page.locator(`thead th[aria-colindex="${col + 2}"]`)).toHaveAttribute("data-hl", "true");
    await gridShot(page, "hover-tooltip");
    // Hoverable (WCAG 2.1 SC 1.4.13): the pointer can move onto the tooltip and it stays open,
    // still describing the same cell; no other cell's tooltip replaces it meanwhile.
    const tipId = (await tip.getAttribute("id")) ?? "";
    await tip.hover();
    await page.waitForTimeout(600);
    await expect(tip).toBeVisible();
    await expect(tip).toHaveAttribute("id", tipId);
    await expect(multi).toHaveAttribute("aria-describedby", tipId);
    // Leaving the tooltip (and the cell) closes it.
    await page.mouse.move(0, 0);
    await expect(tip).toBeHidden();
  });

  test("keyboard: one tab stop, arrows move focus, the ring is the accent, Enter opens the drawer", async ({ page }) => {
    await openGrid(page);
    await expectResultsGrid(page);
    const table = grid(page);

    // Exactly one cell is tabbable.
    await expect(table.locator('td[role="gridcell"][tabindex="0"]')).toHaveCount(1);
    expect(await table.locator('td[role="gridcell"][tabindex="-1"]').count()).toBeGreaterThan(10);

    // Tab into the grid from the toolbar's last control.
    const last = isMobile() ? toolbar(page).getByRole("button", { name: en["grid.toolbar.filters"] }) : toolbar(page).getByRole("button", { name: en["ask.open"] });
    await last.focus();
    await page.keyboard.press("Tab");
    const start = await focusedCell(page);
    expect(start).not.toBeNull();

    // Data dimensions: aria-rowcount / aria-colcount include the header row and column.
    const lastCol = Number(await table.getAttribute("aria-colcount")) - 2;
    const lastRow = Number(await table.getAttribute("aria-rowcount")) - 2;

    // ArrowRight × 2 moves the focus (and the roving tabindex) two columns to the right.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const after = await focusedCell(page);
    expect(after).toEqual({ row: start!.row, col: Math.min(start!.col + 2, lastCol) });
    const focused = page.locator('td[role="gridcell"]:focus');
    await expect(focused).toHaveAttribute("tabindex", "0");
    await expect(table.locator('td[role="gridcell"][tabindex="0"]')).toHaveCount(1);
    // Focus ring: 2 px solid in the accent color.
    await expect(focused).toHaveCSS("outline-style", "solid");
    await expect(focused).toHaveCSS("outline-width", "2px");
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
    const outlineColor = await focused.evaluate((el) => getComputedStyle(el).outlineColor);
    const hex = accent.replace("#", "");
    const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
    expect(outlineColor).toBe(rgb);
    // The focused cell's headers highlight, and the tooltip opens after the delay.
    await expect(page.locator(`thead th[aria-colindex="${after!.col + 2}"]`)).toHaveAttribute("data-hl", "true");
    await expect(page.getByRole("tooltip")).toBeVisible();
    await gridShot(page, "focus-ring");
    // Esc closes the tooltip; the grid keeps focus.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toBeHidden();
    expect(await focusedCell(page)).toEqual(after);

    // Home / End / PageDown / Ctrl+Home via the pure model.
    await page.keyboard.press("End");
    expect((await focusedCell(page))!.col).toBe(lastCol);
    await page.keyboard.press("Home");
    expect((await focusedCell(page))!.col).toBe(0);
    await page.keyboard.press("PageDown");
    expect((await focusedCell(page))!.row).toBe(Math.min(start!.row + 7, lastRow));
    await page.keyboard.press("Control+Home");
    expect(await focusedCell(page)).toEqual({ row: 0, col: 0 });

    // Enter on an available cell opens the cell drawer; Esc closes it.
    await page.keyboard.press("Escape");
    const okCell = cells(page, "ok").first();
    await okCell.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("rows toggle: dates become columns", async ({ page }) => {
    await openGrid(page);
    await expectResultsGrid(page);
    const routes = Number(await grid(page).getAttribute("aria-colcount")) - 1;
    const controls = await openControls(page);
    await controls.getByRole("group", { name: en["grid.toolbar.rows"] }).getByRole("button", { name: en["grid.toolbar.rows_routes"] }).click();
    await closeControls(page);
    const table = grid(page);
    await expect(table.locator("thead th.ag-corner")).toHaveText(en["grid.toolbar.rows_routes"]);
    await expect(table.locator("tbody th[role='rowheader']").first()).toContainText(/[A-Z]{3} → [A-Z]{3}/);
    await expect(table.locator("thead th[role='columnheader']").nth(1)).toHaveAttribute("title", /^\d{4}-\d{2}-\d{2}$/);
    // Every route becomes a row, 30+ dates the columns: still below the virtualization threshold.
    await expect(table).toHaveAttribute("aria-rowcount", String(routes + 1));
    await gridShot(page, "rows-routes");
  });

  test("cabin chips: J, then F, drop the cabin tag", async ({ page }) => {
    await openGrid(page);
    await expectResultsGrid(page);
    for (const cabin of ["J", "F"] as const) {
      const controls = await openControls(page);
      await controls.getByRole("group", { name: en["grid.toolbar.cabins"] }).getByRole("button", { name: cabin, exact: true }).click();
      await closeControls(page);
      await settled(page);
      const chip = (await openControls(page)).getByRole("group", { name: en["grid.toolbar.cabins"] }).getByRole("button", { name: cabin, exact: true });
      await expect(chip).toHaveAttribute("aria-pressed", "true");
      await closeControls(page);
      // One cabin shown: no J/F tag, and every available cell names that cabin.
      await expect(page.locator(".ag-cabin")).toHaveCount(0);
      const ok = cells(page, "ok").first();
      await expect(ok).toHaveAttribute("aria-label", cabin === "J" ? /, business, / : /, first, /);
      await gridShot(page, `cabin-${cabin}`);
    }
  });

  test("dynamic pricing: the switch fetches the dynamic scope; off again shows filtered cells", async ({ page }) => {
    await openGrid(page);
    await expectResultsGrid(page);
    // First run: unless an earlier project already warmed the dynamic scope (one app process and
    // one cache serve every project), nothing is "filtered" yet and the note explains the cost.
    const preCached = (await cells(page, "filtered").count()) > 0;
    let controls = await openControls(page);
    if (preCached) await expect(controls.getByText(en["grid.toolbar.dynamic_note"])).toHaveCount(0);
    else await expect(controls.getByText(en["grid.toolbar.dynamic_note"])).toBeVisible();
    await controls.getByRole("switch", { name: en["grid.include_filtered"] }).click();
    await closeControls(page);
    await settled(page);
    controls = await openControls(page);
    await expect(controls.getByRole("switch", { name: en["grid.include_filtered"] })).toHaveAttribute("aria-checked", "true");
    await expect(controls.getByText(en["grid.toolbar.dynamic_note"])).toHaveCount(0);
    await closeControls(page);
    await expect(cells(page, "filtered")).toHaveCount(0);
    const withDynamic = await cells(page, "ok").count();
    await gridShot(page, "dynamic-on");

    // Off again: the scope is cached, so the dynamic rows render as muted "filtered" cells.
    controls = await openControls(page);
    await controls.getByRole("switch", { name: en["grid.include_filtered"] }).click();
    await closeControls(page);
    await settled(page);
    const filtered = cells(page, "filtered");
    expect(await filtered.count()).toBeGreaterThan(0);
    expect(await cells(page, "ok").count()).toBeLessThan(withDynamic);
    const first = filtered.first();
    await expect(first).toHaveAttribute("aria-label", new RegExp(`${en["grid.cell.filtered"]}\\.$`));
    await expect(first).toHaveAttribute("title", en["grid.cell.filtered_title"]);
    // The state is never color alone: the text tag is there at every density, and the aria
    // label carries the full word.
    await expect(first.locator(".ag-tag")).toHaveText(en["grid.cell.filtered_short"]);
    // At the spec's 112 px minimum column (fixed-width layout) line 1 — cabin tag, miles, the
    // dynamic tag — never clips.
    if (!isMobile()) expect(await overflowingLinesAt112(page)).toBe(0);
    await gridShot(page, "dynamic-off-filtered");
  });

  test("empty results: the sentence and three suggestions", async ({ page }) => {
    await openGrid(page, "empty");
    await expect(searching(page)).toBeHidden({ timeout: 60_000 });
    const empty = page.getByTestId("grid-empty-results");
    await expect(empty).toBeVisible();
    // "Checked 7 programs": the programs monitoring these routes per the catalog, not the 26 sources.
    await expect(empty.locator("p")).toHaveText(/^No J or F availability on these \d+ routes between [A-Z][a-z]{2} \d{1,2} and [A-Z][a-z]{2} \d{1,2}\. Checked 7 programs, \d+ [mhd] ago\.$/);
    await expect(empty.getByRole("button", { name: en["grid.empty.widen_dates"] })).toBeVisible();
    await expect(empty.getByRole("button", { name: en["grid.empty.add_cabin"] })).toBeVisible();
    // The grid is replaced by the empty state until the hatched cells are reviewed.
    await expect(grid(page)).toBeHidden();
    await gridShot(page, "empty-results");
    const review = empty.getByRole("button", { name: en["grid.empty.review_unmonitored"] });
    if (await review.count()) {
      await review.click();
      await expect(grid(page)).toBeVisible();
      await expect(page.locator('td[role="gridcell"]:focus')).toHaveAttribute("data-state", "unmonitored");
    }
  });

  test("quota: the persistent banner", async ({ page }) => {
    await openGrid(page, "quota");
    await expect(searching(page)).toBeHidden({ timeout: 60_000 });
    const banner = page.getByTestId("quota-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText(/^seats\.aero daily limit reached \(950 of 1,000\)\. Resets in \d+ [hm]( \d+ m)?\. Cached results are still shown\.$/);
    await expect(banner).toHaveCSS("border-left-width", "1px");
    // No alert dialog: the banner is the state.
    await expect(page.getByRole("alert").filter({ hasText: /limit/ })).toHaveCount(0);
    // Run and Save are off (with the reason in their title); Export stays available.
    const run = page.getByRole("button", { name: en["grid.search"], exact: true });
    await expect(run).toBeDisabled();
    await expect(run.locator("xpath=..")).toHaveAttribute("title", en["grid.toolbar.run_disabled_quota"]);
    const controls = await openControls(page);
    await expect(controls.getByRole("button", { name: en["grid.save_query"] })).toBeDisabled();
    await expect(controls.getByTestId("save-query")).toHaveAttribute("title", en["grid.toolbar.save_disabled_quota"]);
    await closeControls(page);
    await gridShot(page, "quota");
  });

  test("partial: one program's Get Routes failed, the grid still renders", async ({ page }) => {
    await openGrid(page, "partial");
    await expectResultsGrid(page);
    // The failed program never shows up in a cell.
    await expect(page.locator(".ag-program", { hasText: "Aeroplan" })).toHaveCount(0);
    // Pairs no LOADED program monitors (ICN→SEA, GMP→SEA) may belong to the failed one: they are
    // "not fetched" (dotted outline + reason), never "no availability" or "not monitored" — on
    // the live run and on the cached grid of a later project alike.
    const notFetched = cells(page, "not_fetched");
    expect(await notFetched.count()).toBeGreaterThan(0);
    await expect(cells(page, "unmonitored")).toHaveCount(0);
    const first = notFetched.first();
    await expect(first).toHaveAttribute("aria-label", /Not fetched/);
    await expect(first).toHaveAttribute("title", /Not fetched/);
    await expect(first.locator(".ag-cell-in")).toHaveCSS("outline-style", "dotted");
    // With a route list missing, the header counts what it sees instead of claiming a monitoring count.
    if (!isMobile()) await expect(grid(page).locator("thead th[role='columnheader']").nth(1).locator(".ag-head-sub")).toHaveText(/with availability$/);
    await gridShot(page, "partial-not-fetched");
  });

  test("loading: a skeleton in the real shape, static under reduced motion", async ({ page }) => {
    // One app process and one per-user cache serve every project, so each project has its own
    // slow user: a cached answer from an earlier project would skip the loading state.
    const user = E2E_SLOW_USERS[projectIndex(test.info().project.name)] ?? "slow";
    await openGrid(page, user);
    // Parse is instant; the mock delays every seats.aero answer 1.5 s, so the skeleton is up.
    const table = grid(page);
    await expect(table).toHaveAttribute("aria-busy", "true", { timeout: 10_000 });
    await expect(searching(page)).toHaveText(en["grid.searching"]);
    const skeletons = page.getByTestId("cell-skeleton");
    expect(await skeletons.count()).toBeGreaterThan(100);
    // The skeleton has the eventual shape: every origin × destination pair (+ the corner) and 30+ date rows.
    expect(Number(await table.getAttribute("aria-colcount"))).toBeGreaterThanOrEqual(7);
    expect(Number(await table.getAttribute("aria-rowcount"))).toBeGreaterThanOrEqual(31);
    // Nothing animates under prefers-reduced-motion (applyTheme emulates "reduce").
    const bar = page.locator(".ag-skel-bar").first();
    await expect(bar).toHaveCSS("animation-name", "none");
    // Skeleton cells are not tabbable.
    await expect(table.locator('td[role="gridcell"][tabindex="0"]')).toHaveCount(0);
    await page.waitForTimeout(300);
    await gridShot(page, "loading");
    await expectResultsGrid(page);
    await expect(page.getByTestId("cell-skeleton")).toHaveCount(0);
  });
});
