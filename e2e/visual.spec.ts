/**
 * Phase 6.6 — visual regression (spec §9, §11).
 *
 * A curated subset of the capture matrix, held to committed `toHaveScreenshot` baselines: eight
 * states × three projects (desktop light and dark, mobile light) = 24 comparisons. The full
 * matrix in `e2e/screenshots.spec.ts` is documentation; this is the alarm. Both reach their
 * states through the same helpers in `e2e/states.ts`, so a state can never mean one thing here
 * and another there.
 *
 * Baselines live in `e2e/__screenshots__/<project>/visual.spec.ts/<name>.png` — **no platform
 * suffix** (`snapshotPathTemplate`), because they are generated on Linux CI and would never match
 * a Mac's font rasterisation. Locally the assertions are inert:
 *
 *     pnpm e2e                          # visual tests run, snapshots ignored (no VISUAL)
 *     VISUAL=1 pnpm e2e -g visual       # compare against the committed Linux baselines
 *     VISUAL=1 pnpm e2e:update -g visual  # rewrite them (put the reason in the commit message)
 *
 * Everything whose text is a clock reading is masked (`timeMasks`): freshness ages, the quota
 * counters, the grid's date row headers (the demo dataset is shifted so day one is today),
 * relative run times. The box is still compared — only the reading inside it is exempt.
 */
import type { Page } from "@playwright/test";
import { applyTheme, expect, test } from "./fixtures";
import {
  askDrawer,
  cellDrawer,
  closePopover,
  expandFirstQuery,
  isMobile,
  openAsk,
  openCellDrawer,
  openChipEditor,
  openGridWithCells,
  openQueries,
  openSettings,
  timeMasks,
} from "./states";

/**
 * The demo dataset starts today, so the Dates chip and the Ask drawer's "Current grid" pill name
 * today's range. The chip's text is masked, but its WIDTH is not: at 390 px "Sep 6 – Oct 5"
 * fits beside Destinations and "Sep 25 – Oct 24" wraps to another row, which moved everything
 * under it by 48 px on some days of each month and failed the mobile /grid baselines by the
 * calendar alone. Before a /grid screenshot the range is written as this one fixed reading (the
 * app's own separators are kept), so the layout is the same on every day.
 */
const HELD_RANGE = { start: "Sep 25", end: "Oct 24" };
const RANGE = /([A-Z][a-z]{2} \d{1,2})(\s*–\s*)((?:[A-Z][a-z]{2} )?\d{1,2})/;

async function holdTheCalendar(page: Page): Promise<void> {
  const held = await page.evaluate(
    ({ source, start, end }) => {
      const range = new RegExp(source);
      const hold = (el: Element | null) => {
        if (!el || !range.test(el.textContent ?? "")) return false;
        el.textContent = (el.textContent ?? "").replace(range, (_m, _a, sep: string) => `${start}${sep}${end}`);
        return true;
      };
      const chip = hold(document.querySelector('[data-chip="dates"] > span:last-child'));
      const pill = document.querySelector('[data-testid="ask-pill-grid"]');
      return { chip, pill: pill ? hold(pill) : null };
    },
    { source: RANGE.source, ...HELD_RANGE },
  );
  // Never a silent no-op: if the markup moves, this fails instead of letting the calendar back in.
  expect(held.chip, "the Dates chip's range was found and held").toBe(true);
  if (held.pill !== null) expect(held.pill, "the Ask pill's range was found and held").toBe(true);
}

/** Mobile dark adds a fourth copy of every baseline and has never caught anything the other three missed. */
const CURATED_PROJECTS = ["desktop-light", "desktop-dark", "mobile-light"];

test.describe("visual", () => {
  test.skip(() => !CURATED_PROJECTS.includes(test.info().project.name), "the curated subset runs on desktop light/dark and mobile light");

  test.beforeEach(async ({ page }) => {
    await applyTheme(page);
  });

  test("visual: login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page).toHaveScreenshot("login.png", { fullPage: true, mask: timeMasks(page) });
  });

  test("visual: grid results", async ({ page }) => {
    await openGridWithCells(page);
    await holdTheCalendar(page);
    await expect(page).toHaveScreenshot("grid-results.png", { mask: timeMasks(page) });
  });

  test("visual: the cell drawer", async ({ page }) => {
    await openGridWithCells(page);
    await openCellDrawer(page);
    await expect(cellDrawer(page)).toBeVisible();
    await holdTheCalendar(page);
    await expect(page).toHaveScreenshot("grid-cell-drawer.png", { mask: timeMasks(page) });
  });

  test("visual: the Ask drawer", async ({ page }) => {
    await openGridWithCells(page, { params: "askdemo=1" });
    const ask = await openAsk(page);
    await expect(ask.getByTestId("ask-suggestions")).toBeVisible();
    await expect(askDrawer(page)).toBeVisible();
    await holdTheCalendar(page);
    await expect(page).toHaveScreenshot("grid-ask-drawer.png", { mask: timeMasks(page) });
  });

  test("visual: the Origins chip editor", async ({ page }) => {
    await openGridWithCells(page);
    await openChipEditor(page, "origins");
    await holdTheCalendar(page);
    await expect(page).toHaveScreenshot("grid-origins-editor.png", { mask: timeMasks(page) });
    await closePopover(page);
  });

  test("visual: the queries list", async ({ page }) => {
    await openQueries(page);
    await expect(page).toHaveScreenshot("queries-list.png", { fullPage: true, mask: timeMasks(page) });
  });

  test("visual: an expanded query row", async ({ page }) => {
    await openQueries(page);
    await expandFirstQuery(page);
    await expect(page).toHaveScreenshot("queries-expanded.png", { fullPage: true, mask: timeMasks(page) });
  });

  test("visual: settings", async ({ page }) => {
    await openSettings(page);
    // The mobile column stacks; the desktop one is the 880 px reading column (spec §5).
    expect(isMobile() || (await page.locator("main > div").first().evaluate((el) => el.getBoundingClientRect().width)) <= 880).toBe(true);
    await expect(page).toHaveScreenshot("settings.png", { fullPage: true, mask: timeMasks(page) });
  });
});
