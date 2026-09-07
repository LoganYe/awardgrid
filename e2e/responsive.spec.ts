/**
 * Phase 6.6 — the responsive and reduced-motion pass (spec §6, §8; docs/UI_PLAN.md §6.2–§6.6).
 *
 * Three bands, one spec: 1440 (≥ 1280), 1024 (768–1279) and 390 (< 768). The viewport is set by
 * the test rather than by the project, so all three bands are exercised in ONE pass instead of
 * being split across projects that would each re-run the whole query — density is width-driven
 * (`useDensity`, matchMedia on 1280 / 768), so a resized desktop context is the same UI a phone
 * gets. The spec therefore runs on desktop-light only; mobile-light is the project that proves
 * the same states under real touch emulation (axe.spec.ts, grid.spec.ts, cell-drawer.spec.ts).
 *
 * What it pins:
 *   §6 cells      three lines / two lines / one line, at 48 / 32 / 40 px rows
 *   §6.2b cells   Per cabin: two 16 px lines, 48 / 40 / 40 px rows, and no line overflows in zh
 *   §6 drawers    push (≥ 1280) / overlay (768–1279) / sheet + bottom sheet (< 768)
 *   §6 toolbar    collapses into the "Filters" bottom sheet below 768
 *   §6 chips      wrap to several lines at 390
 *   §6 top bar    name + quota + Menu only below 768
 *   §6 grid       the date column stays sticky and the table scrolls sideways at 390
 *   §3.4          every interactive element is at least 40 px at 390 (offenders are listed)
 *   §6            no page scrolls sideways at 390, on any page
 *   §8            nothing animates under prefers-reduced-motion — drawer or skeleton
 *   §8            zh-CN is complete: no en string leaks through on any page
 */
import type { Page } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import { zh } from "../src/lib/i18n/dictionaries/zh";
import { applyTheme, CANONICAL_QUERY_EN, expect, loginAs, openAskDrawer, openCellDrawer, openGridWithResults, submitQuery, test } from "./fixtures";

const WIDE = { width: 1440, height: 900 };
const MID = { width: 1024, height: 800 };
const NARROW = { width: 390, height: 844 };

/** Every route a signed-in user can reach, for the sweeps that must hold on all of them. */
const PAGES = ["/grid", "/queries", "/settings", "/legal"] as const;

const cells = (page: Page) => page.locator('td[role="gridcell"][data-state="ok"]');

/**
 * Wait for the density hook to catch up with a resize: it reads matchMedia in an effect, so the
 * wrapper's data-density is the signal that React has re-rendered at the new width.
 */
async function resize(page: Page, size: { width: number; height: number }, density?: "desktop" | "tablet" | "mobile"): Promise<void> {
  await page.setViewportSize(size);
  if (density) await expect(page.locator(".ag-wrap")).toHaveAttribute("data-density", density);
}

/** Height of the first available cell's row, and how many of the three anatomy lines it draws. */
function cellShape(page: Page): Promise<{ rowHeight: number; lines: number }> {
  return page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>('td[role="gridcell"][data-state="ok"]');
    if (!cell) throw new Error("no available cell on screen");
    const inner = cell.querySelector<HTMLElement>(".ag-cell-in");
    const lines = inner ? inner.querySelectorAll(".ag-l1, .ag-l2, .ag-l3").length : 0;
    return { rowHeight: Math.round(cell.getBoundingClientRect().height), lines };
  });
}


/**
 * Flip the Cells toggle at the CURRENT viewport width. `e2e/states.ts` picks the inline toolbar
 * or the Filters sheet from the PROJECT, and this spec resizes one desktop project through all
 * three bands, so the choice has to come from the width instead.
 */
async function setCellsAt(page: Page, layout: "best" | "per_cabin", width: number): Promise<void> {
  const narrow = width < 768;
  let controls = page.getByRole("toolbar");
  if (narrow) {
    await controls.getByRole("button", { name: en["grid.toolbar.filters"] }).click();
    controls = page.getByRole("dialog");
    await expect(controls).toBeVisible();
  }
  const name = layout === "per_cabin" ? en["grid.toolbar.cells_per_cabin"] : en["grid.toolbar.cells_best"];
  await controls.getByRole("group", { name: en["grid.toolbar.cells"] }).getByRole("button", { name, exact: true }).click();
  if (narrow) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await expect(page.locator(layout === "per_cabin" ? ".ag-cabin-line" : ".ag-l1").first()).toBeAttached();
}

/** Height of the first available cell's row and the number of per-cabin lines it stacks. */
function perCabinShape(page: Page): Promise<{ rowHeight: number; lines: number; headerHeight: number }> {
  return page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>('td[role="gridcell"][data-state="ok"]');
    if (!cell) throw new Error("no available cell on screen");
    const header = document.querySelector<HTMLElement>("thead tr");
    return {
      rowHeight: Math.round(cell.getBoundingClientRect().height),
      lines: cell.querySelectorAll(".ag-cabin-line").length,
      headerHeight: Math.round(header?.getBoundingClientRect().height ?? 0),
    };
  });
}

test.describe("responsive", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-light", "one pass over the three width bands");
    await applyTheme(page);
  });

  /**
   * Spec §6's headline: the cell loses a line at each step down, and the row height follows the
   * plan's 48 / 32 / 40 (docs/UI_PLAN.md §4 — 40 px at the narrowest because that is a touch row,
   * not a denser one).
   */
  test("cells are three, two and one line at 1440, 1024 and 390", async ({ page }) => {
    await resize(page, WIDE);
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);

    await expect(page.locator(".ag-wrap")).toHaveAttribute("data-density", "desktop");
    expect(await cellShape(page)).toEqual({ rowHeight: 48, lines: 3 });

    await resize(page, MID, "tablet");
    expect(await cellShape(page)).toEqual({ rowHeight: 32, lines: 2 });

    await resize(page, NARROW, "mobile");
    expect(await cellShape(page)).toEqual({ rowHeight: 40, lines: 1 });

    // The column minimum holds at every width: the grid scrolls rather than squeezing (§3.4).
    const width = await cells(page).first().evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThanOrEqual(112);
  });


  /**
   * §6.2b: the per-cabin cell stacks one 16 px line per cabin, so the row is max(density, 16n+8).
   * The phone pays nothing (2 × 16 + 8 IS the 40 px touch row) and the tablet grows 32 → 40 —
   * the one density this mode costs. The sticky header band follows the row height with it.
   */
  test("per-cabin cells are two 16 px lines: 40 px rows at 390 and at 1024, 48 at 1440", async ({ page }) => {
    await resize(page, NARROW);
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);
    await expect(page.locator(".ag-wrap")).toHaveAttribute("data-density", "mobile");
    await setCellsAt(page, "per_cabin", NARROW.width);

    // 390: 2 × 16 + 8 = 40, exactly --row-touch, so the phone loses no rows to the mode.
    expect(await perCabinShape(page)).toEqual({ rowHeight: 40, lines: 2, headerHeight: 40 });
    // The row head is still the 72 px sticky date column, and the columns still clear 112 px.
    const head = page.locator("tbody th.ag-rowhead").first();
    await expect(head).toHaveCSS("position", "sticky");
    expect(Math.round((await head.boundingBox())?.width ?? 0)).toBe(72);
    expect(await cells(page).first().evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(112);
    // And the page still does not scroll sideways.
    const { scrollWidth, innerWidth } = await settledOverflow(page);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);

    // 1024: 40, not the 32 a "best" cell gets — the one density the mode costs.
    await resize(page, MID, "tablet");
    expect(await perCabinShape(page)).toEqual({ rowHeight: 40, lines: 2, headerHeight: 40 });

    // 1440: two 16 px lines still fit the 48 px desktop row, so nothing changes there.
    await resize(page, WIDE, "desktop");
    expect(await perCabinShape(page)).toEqual({ rowHeight: 48, lines: 2, headerHeight: 48 });

    // Back to Best and the tablet row is 32 again: the mode costs nothing when it is off.
    await resize(page, MID, "tablet");
    await setCellsAt(page, "best", MID.width);
    expect(await cellShape(page)).toEqual({ rowHeight: 32, lines: 2 });
  });

  /** §8: the zh compact age ("45分钟") is the widest per-cabin line; none of them may overflow. */
  test("no per-cabin line overflows its cell at 390 in Chinese", async ({ page }) => {
    await resize(page, NARROW);
    await loginAs(page, "demo");
    const baseURL = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3400");
    await page.context().addCookies([{ name: "ag_locale", value: "zh", domain: baseURL.hostname, path: "/" }]);
    await page.goto("/grid");
    const box = page.getByRole("textbox", { name: zh["grid.search"] });
    await box.fill(CANONICAL_QUERY_EN);
    await box.press("Enter");
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("grid")).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
    await expect(cells(page).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

    const controls = page.getByRole("toolbar");
    await controls.getByRole("button", { name: zh["grid.toolbar.filters"] }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("group", { name: zh["grid.toolbar.cells"] }).getByRole("button", { name: zh["grid.toolbar.cells_per_cabin"], exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page.locator(".ag-cabin-line").first()).toBeAttached();

    // Every line, and every line's cell, at the 112 px column the grid guarantees.
    const overflowing = await page.evaluate(() => {
      const out: string[] = [];
      for (const line of document.querySelectorAll<HTMLElement>(".ag-cabin-line")) {
        const cell = line.closest<HTMLElement>(".ag-cell-in");
        if (line.scrollWidth > line.clientWidth + 1) out.push(`line "${(line.textContent ?? "").trim()}" ${line.scrollWidth}>${line.clientWidth}`);
        if (cell && cell.scrollWidth > cell.clientWidth + 1) out.push(`cell "${(line.textContent ?? "").trim()}" ${cell.scrollWidth}>${cell.clientWidth}`);
      }
      return out;
    });
    expect(overflowing, "per-cabin lines wider than their cell in zh at 390").toEqual([]);
    expect(await perCabinShape(page)).toEqual({ rowHeight: 40, lines: 2, headerHeight: 40 });
  });

  /**
   * §6: "drawers overlay instead of pushing content" between 768 and 1279, and become sheets
   * below that. Push is the only non-modal mode — the grid beside it stays usable — so the three
   * modes are three different contracts, not three widths of the same one.
   */
  test("the cell drawer pushes, overlays and becomes a sheet", async ({ page }) => {
    await resize(page, WIDE);
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);

    const drawer = page.getByTestId("cell-drawer");
    await openCellDrawer(page);
    await expect(drawer).toHaveAttribute("data-mode", "push");
    await expect(drawer).not.toHaveAttribute("aria-modal", "true");
    expect((await drawer.boundingBox())?.width).toBe(480);
    // Pushing means the page gives up the width, so nothing of the grid is covered.
    const pushed = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("main")!).paddingRight));
    expect(pushed).toBeGreaterThanOrEqual(480);
    await expect(page.getByTestId("cell-drawer-scrim")).toHaveCount(0);

    await resize(page, MID, "tablet");
    await expect(drawer).toHaveAttribute("data-mode", "overlay");
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    await expect(page.getByTestId("cell-drawer-scrim")).toBeVisible();
    // An overlay does not shrink the page; it covers it.
    const notPushed = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("main")!).paddingRight));
    expect(notPushed).toBeLessThan(480);

    await resize(page, NARROW, "mobile");
    await expect(drawer).toHaveAttribute("data-mode", "sheet");
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    expect((await drawer.boundingBox())?.width).toBe(NARROW.width);
  });

  /** §6: below 768 the Ask drawer is a bottom sheet with a drag handle. */
  test("the Ask drawer is a bottom sheet with a drag handle at 390", async ({ page }) => {
    await resize(page, NARROW);
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);
    const ask = await openAskDrawer(page);

    await expect(ask).toHaveAttribute("data-mode", "bottom-sheet");
    await expect(ask).toHaveAttribute("data-side", "bottom");
    const box = await ask.boundingBox();
    expect(box?.width).toBe(NARROW.width);
    // Anchored to the bottom edge, not the right one.
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(NARROW.height);

    const handle = ask.locator(".ag-drawer-handle");
    await expect(handle).toBeVisible();
    await expect(handle).toHaveAccessibleName(en["drawer.handle"]);
    expect((await handle.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  });

  /** §6: "the toolbar collapses into a Filters sheet" — one button, and every control inside it. */
  test("the toolbar collapses into a Filters sheet below 768", async ({ page }) => {
    await resize(page, MID);
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);
    const toolbar = page.getByRole("toolbar");
    const filters = toolbar.getByRole("button", { name: en["grid.toolbar.filters"] });

    // At 1024 the toolbar is still inline: the controls are on the bar, there is no Filters button.
    await expect(filters).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: en["grid.export_csv"] })).toBeVisible();

    await resize(page, NARROW, "mobile");
    await expect(filters).toBeVisible();
    await expect(toolbar.getByRole("button", { name: en["grid.export_csv"] })).toHaveCount(0);

    await filters.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    // Everything spec §3.3 lists, plus the Ask entry point (UI_PLAN §11), is in the sheet.
    await expect(sheet.getByRole("group", { name: en["grid.toolbar.rows"] })).toBeVisible();
    await expect(sheet.getByRole("group", { name: en["grid.toolbar.cabins"] })).toBeVisible();
    await expect(sheet.getByRole("switch", { name: en["grid.include_filtered"] })).toBeVisible();
    await expect(sheet.getByRole("button", { name: en["grid.save_query"] })).toBeVisible();
    await expect(sheet.getByRole("button", { name: en["grid.export_csv"] })).toBeVisible();
    await expect(sheet.getByRole("button", { name: en["ask.open"] })).toBeVisible();
  });

  /** §6: "chips wrap to multiple lines" — seven chips cannot sit on one 390 px row. */
  test("the chips wrap at 390", async ({ page }) => {
    await resize(page, NARROW);
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);

    const tops = await page.locator("[data-chip]").evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().top)))]);
    expect(tops.length).toBeGreaterThan(1);
    // Every chip is fully inside the viewport: wrapping, not clipping.
    const overflowing = await page.locator("[data-chip]").evaluateAll((els, w) => els.filter((el) => el.getBoundingClientRect().right > w + 1).length, NARROW.width);
    expect(overflowing).toBe(0);
  });

  /** §6: "the top bar keeps only name, quota, and a menu". */
  test("the top bar is name, quota and a menu below 768", async ({ page }) => {
    await loginAs(page, "demo");
    await resize(page, WIDE);
    await page.goto("/grid");
    const bar = page.getByRole("banner");
    await expect(bar.getByRole("navigation", { name: en["nav.primary"] })).toBeVisible();
    await expect(bar.getByRole("group", { name: en["locale.label"] })).toBeVisible();
    await expect(bar.getByRole("button", { name: en["nav.menu"] })).toBeHidden();

    await resize(page, NARROW);
    await expect(bar.getByText(en["app.name"], { exact: true })).toBeVisible();
    await expect(page.getByTestId("quota-indicator")).toBeVisible();
    await expect(bar.getByRole("button", { name: en["nav.menu"] })).toBeVisible();
    // The nav, the language toggle, the theme toggle and the user menu move into the panel.
    await expect(bar.getByRole("navigation", { name: en["nav.primary"] })).toBeHidden();
    await expect(bar.getByRole("group", { name: en["locale.label"] })).toBeHidden();

    await bar.getByRole("button", { name: en["nav.menu"] }).click();
    await expect(bar.getByRole("navigation", { name: en["nav.primary"] })).toBeVisible();
    await expect(bar.getByRole("group", { name: en["locale.label"] })).toBeVisible();
  });

  /** §6: "the grid stays a table with the sticky date column and horizontal scroll". */
  test("the date column stays sticky while the grid scrolls sideways at 390", async ({ page }) => {
    await resize(page, NARROW);
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);

    const head = page.locator("tbody th.ag-rowhead").first();
    await expect(head).toHaveCSS("position", "sticky");
    await expect(head).toHaveCSS("left", "0px");

    const before = await head.evaluate((el) => el.getBoundingClientRect().left);
    const scrollable = await page.locator(".ag-scroll").evaluate((el) => {
      const room = el.scrollWidth - el.clientWidth;
      el.scrollLeft = room;
      return room;
    });
    // The table is wider than a phone: six routes at the 112 px minimum do not fit in 390 px.
    expect(scrollable).toBeGreaterThan(0);
    await expect.poll(() => head.evaluate((el) => Math.round(el.getBoundingClientRect().left))).toBe(Math.round(before));
    // The header row stays put on the other axis too.
    await expect(page.locator("thead th.ag-corner").first()).toHaveCSS("position", "sticky");
  });

  /**
   * Spec §3.4: "Touch targets on mobile 40 px". Measured, not asserted per component, so a new
   * control cannot slip in under the floor. Inline links inside running text are exempt — the
   * same exception WCAG 2.5.8 makes — because growing them to 40 px would break the line box
   * they sit in; everything else, including everything in a drawer or a sheet, must clear it.
   */
  for (const route of PAGES) {
    test(`touch targets are at least 40 px at 390 on ${route}`, async ({ page }) => {
      await resize(page, NARROW);
      if (route === "/grid") await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);
      else {
        await loginAs(page, "demo");
        await page.goto(route);
      }
      expect(await smallTargets(page)).toEqual([]);
    });
  }

  test("touch targets are at least 40 px at 390 inside the drawers and the Filters sheet", async ({ page }) => {
    await resize(page, NARROW);
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);

    await page.getByRole("toolbar").getByRole("button", { name: en["grid.toolbar.filters"] }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await smallTargets(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await openCellDrawer(page);
    expect(await smallTargets(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await openAskDrawer(page);
    expect(await smallTargets(page)).toEqual([]);
  });

  /**
   * The other half of "no horizontal overflow": a control can stay inside the document and still
   * be cut in half by a clipping ancestor, which the scrollWidth check cannot see. Every
   * interactive element on the grid page — the densest one — must be fully inside the viewport.
   */
  test("no control is cut off at the right edge at 390", async ({ page }) => {
    await resize(page, NARROW);
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);
    const clipped = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea")) {
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none" || el.closest("[inert],[hidden]")) continue;
        const rect = el.getBoundingClientRect();
        // The grid table scrolls sideways on purpose; its cells are meant to leave the viewport.
        if (rect.width === 0 || el.closest(".ag-scroll")) continue;
        if (rect.right > window.innerWidth + 0.5 || rect.left < -0.5) {
          out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(rect.left)}..${Math.round(rect.right)}`);
        }
      }
      return out;
    });
    expect(clipped, "controls hanging off the 390 px viewport").toEqual([]);
  });

  /** §6: nothing on any page pushes the document sideways at 390. */
  for (const route of PAGES) {
    test(`no horizontal page overflow at 390 on ${route}`, async ({ page }) => {
      await resize(page, NARROW);
      if (route === "/grid") await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);
      else {
        await loginAs(page, "demo");
        await page.goto(route);
      }
      const { scrollWidth, innerWidth, offenders } = await settledOverflow(page);
      expect(scrollWidth, `${route} scrolls sideways; the boxes past the edge are: ${offenders.join(" | ") || "none — check a margin or a fixed width"}`).toBeLessThanOrEqual(innerWidth);
    });
  }

  test("no horizontal page overflow at 390 on /login and /register", async ({ page }) => {
    await resize(page, NARROW);
    for (const route of ["/login", "/register"]) {
      await page.goto(route);
      const { scrollWidth, innerWidth, offenders } = await settledOverflow(page);
      expect(scrollWidth, `${route} scrolls sideways; the boxes past the edge are: ${offenders.join(" | ") || "none — check a margin or a fixed width"}`).toBeLessThanOrEqual(innerWidth);
    }
  });
});

// ---------------------------------------------------------------------------
// Reduced motion (spec §8, §1.1: "prefers-reduced-motion respected everywhere")
// ---------------------------------------------------------------------------

test.describe("reduced motion", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-light", "one pass");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  });

  /**
   * `getAnimations()` is the honest check: it returns every running CSS transition, CSS animation
   * and Web Animation on the document, so a rule that survived the global reduced-motion override
   * shows up here whatever it was written in. Sampled at the two moments the app actually moves —
   * the frame a drawer opens, and while a skeleton is on screen.
   */
  test("nothing animates while a drawer opens or a skeleton shows", async ({ page }) => {
    // Hold /api/find long enough to sample the skeleton. A fixed delay rather than a latch the
    // test releases: unrouting while a handler is still pending is a race ("Route is already
    // handled"), and the assertion below only needs the skeleton to be on screen once.
    await page.route("**/api/find", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      await route.continue();
    });

    await loginAs(page, "demo");
    await page.goto("/grid");
    await submitQuery(page, CANONICAL_QUERY_EN);

    // The skeleton in the query's real shape (spec §3.7), with the search still in flight.
    await expect(page.getByTestId("cell-skeleton").first()).toBeVisible({ timeout: 60_000 });
    expect(await running(page), "a skeleton must be static under prefers-reduced-motion").toEqual([]);

    await expect(page.getByRole("grid")).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
    await expect(cells(page).first()).toBeVisible({ timeout: 60_000 });

    // The drawer's own transform and the scrim's opacity are the only motion the app has left.
    await openCellDrawer(page);
    expect(await running(page), "a drawer must not slide under prefers-reduced-motion").toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await openAskDrawer(page);
    expect(await running(page), "the Ask drawer must not slide under prefers-reduced-motion").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// i18n floor (spec §8: "zh-CN and en both complete")
// ---------------------------------------------------------------------------

/**
 * en values that are the same string in zh on purpose — proper nouns and the product's own
 * vocabulary, from the docs/COPY.md glossary and src/lib/i18n/copy-allowlist.ts. A visible en
 * value only counts as a leak when the zh dictionary actually says something different.
 */
const SAME_IN_BOTH = new Set(["awardgrid", "seats.aero", "Telegram", "Duffel", "Ignav", "EN", "中文", "CSV", "IATA", "UTC"]);

/**
 * Every en value whose zh translation differs, longest first (so "Save as standing query" is
 * matched before "Save"), with the placeholders stripped down to the literal words around them —
 * only fragments long enough to be unambiguous are searched for.
 */
function leakCandidates(): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  for (const [key, value] of Object.entries(en)) {
    const other = (zh as Record<string, string>)[key];
    if (typeof value !== "string" || typeof other !== "string") continue;
    if (value === other || SAME_IN_BOTH.has(value)) continue;
    // Only the literal, placeholder-free strings: a template's fragments are too short to pin.
    if (value.includes("{")) continue;
    if (value.replace(/[^A-Za-z]/g, "").length < 8) continue;
    out.push({ key, text: value });
  }
  return out.sort((a, b) => b.text.length - a.text.length);
}

test.describe("i18n floor", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-light", "one pass");
    await applyTheme(page);
  });

  /** `loginAs` clears the context's cookies, so the locale cookie is written after it, never before. */
  async function useChinese(page: Page): Promise<void> {
    const baseURL = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3400");
    await page.context().addCookies([{ name: "ag_locale", value: "zh", domain: baseURL.hostname, path: "/" }]);
  }

  for (const route of [...PAGES, "/login", "/register"]) {
    test(`no English leaks into zh on ${route}`, async ({ page }) => {
      if (route === "/grid") {
        await loginAs(page, "demo");
        await useChinese(page);
        await page.goto("/grid");
        const box = page.getByRole("textbox", { name: zh["grid.search"] });
        await box.fill("香港、上海、东京、首尔到西雅图，未来一个月最便宜的头等舱");
        await box.press("Enter");
        await expect(page.getByRole("grid")).toBeVisible({ timeout: 60_000 });
        await expect(page.getByRole("grid")).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
      } else {
        if (route !== "/login" && route !== "/register") await loginAs(page, "demo");
        await useChinese(page);
        await page.goto(route);
      }
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

      const text = await visibleTextInLocale(page);
      const leaked = leakCandidates()
        .filter(({ text: value }) => text.includes(value))
        .map(({ key, text: value }) => `${key}: ${value}`);
      expect(leaked, `English dictionary values visible on ${route} in zh`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Shared page probes
// ---------------------------------------------------------------------------

/** Every interactive element smaller than 40 px in either axis, as "<tag> name WxH". */
function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const MIN = 40;
    const SELECTOR = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="switch"], [role="checkbox"], [role="option"], [role="tab"], [tabindex]:not([tabindex="-1"])';
    const offenders: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || el.closest("[inert],[hidden],[aria-hidden='true']")) continue;
      // A control wrapped in its own <label> is tapped through the label, so the label is the
      // target (the theme radios are a 14 px dot inside a 40 px row).
      const wrapper = el.matches("input") ? el.closest("label") : null;
      const box = wrapper ?? el;
      const rect = box.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // The real hit area: some controls are deliberately small on screen and carry an absolute
      // ::after overlay that extends past their box (the switch is a 14 px track with a 40 px
      // target). Negative insets grow the box; positive ones cannot shrink it below the element.
      const after = getComputedStyle(box, "::after");
      let { width, height } = rect;
      if (after.content !== "none" && after.position === "absolute") {
        const px = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
        width = Math.max(width, width - px(after.left) - px(after.right));
        height = Math.max(height, height - px(after.top) - px(after.bottom));
      }
      // WCAG 2.5.8's inline exception: a link in running text cannot be 40 px tall without
      // breaking the paragraph around it. Anything laid out as its own box must clear the floor.
      if (style.display.startsWith("inline") && !style.display.includes("flex") && !style.display.includes("block") && el.matches("a[href]")) continue;
      // Grid cells are the table, sized by the row height and the 112 px column (spec §3.4).
      if (el.closest('[role="gridcell"], [role="grid"]')) continue;
      if (Math.round(width) < MIN || Math.round(height) < MIN) {
        const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40) || el.getAttribute("data-testid") || "";
        offenders.push(`<${el.tagName.toLowerCase()}> ${name} ${Math.round(width)}x${Math.round(height)}`);
      }
    }
    return [...new Set(offenders)];
  });
}

/** Names of every animation/transition currently running on the document. */
function running(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const names = document.getAnimations().map((a) => {
      const target = a.effect && "target" in a.effect ? (a.effect as KeyframeEffect).target : null;
      const what = target ? `${target.tagName.toLowerCase()}${target.className ? `.${String(target.className).split(" ")[0]}` : ""}` : "?";
      const property = a instanceof CSSTransition ? a.transitionProperty : a instanceof CSSAnimation ? a.animationName : a.id;
      return `${what}: ${property}`;
    });
    return [...new Set(names)];
  });
}

interface Overflow {
  scrollWidth: number;
  innerWidth: number;
  offenders: string[];
}

/**
 * Document scroll width at the current viewport, plus the boxes that stick out past the right
 * edge WITHOUT living in a scroll container of their own. Wide content is allowed — the grid
 * table is 918 px on a phone on purpose — as long as it scrolls inside `.ag-scroll` rather than
 * dragging the page with it (spec §6: "horizontal scroll" is the grid's, not the document's).
 */
function overflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const innerWidth = window.innerWidth;
    const offenders: string[] = [];
    const clipped = (el: HTMLElement) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        if (getComputedStyle(node).overflowX !== "visible") return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= innerWidth + 1) continue;
      // Only the outermost offender of each branch: its children are wide because it is.
      if (el.parentElement && el.parentElement.getBoundingClientRect().right > innerWidth + 1) continue;
      if (clipped(el)) continue;
      const id = `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? `.${el.className.split(" ").slice(0, 2).join(".")}` : ""}`;
      offenders.push(`${id} right=${Math.round(rect.right)}`);
    }
    return { scrollWidth: document.scrollingElement!.scrollWidth, innerWidth, offenders: offenders.slice(0, 6) };
  });
}

/**
 * The same reading, once the page has settled. A layout that depends on a client hook — the
 * queries list swaps its table for cards at `useDensity() === "mobile"` — is still the desktop
 * one for the frames between load and hydration, which is not what this rule is about.
 */
async function settledOverflow(page: Page, timeoutMs = 15_000): Promise<Overflow> {
  const deadline = Date.now() + timeoutMs;
  let last = await overflow(page);
  while (last.scrollWidth > last.innerWidth && Date.now() < deadline) {
    await page.waitForTimeout(250);
    last = await overflow(page);
  }
  return last;
}

/**
 * The page's visible text, minus every subtree that declares a language of its own — LEGAL.md is
 * an English document rendered inside the Chinese UI (`<div lang="en">` in src/app/legal/page.ts),
 * and quoting it is not a missing translation. Anything without a `lang` of its own belongs to
 * the page's language and is fair game.
 */
function visibleTextInLocale(page: Page): Promise<string> {
  return page.evaluate(() => {
    const foreign = [...document.querySelectorAll<HTMLElement>("[lang]")].filter((el) => el !== document.documentElement && !el.lang.toLowerCase().startsWith("zh"));
    const previous = foreign.map((el) => el.style.display);
    for (const el of foreign) el.style.display = "none";
    const text = document.body.innerText;
    foreign.forEach((el, i) => {
      el.style.display = previous[i] ?? "";
    });
    return text;
  });
}
