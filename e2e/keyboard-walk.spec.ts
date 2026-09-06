/**
 * Phase 6.6 — the keyboard-only walk (spec §8: "the full grid walk (parse → chips → grid →
 * drawer → open link) is possible without a mouse and is documented in docs/UI.md").
 *
 * This spec IS that walk, and nothing in it clicks: every step is a Tab, an arrow, an Enter or an
 * Escape, and `document.activeElement` is asserted after each one. The prose version — the same
 * fourteen steps, written out — is docs/UI.md "Keyboard walk"; if one of them changes here, that
 * section changes with it.
 *
 * The walk: query bar → type → Enter → chips → open Origins → drop HND → Esc → Run → grid →
 * arrows to a cell → Enter → the drawer's "Open in <program>" link → Esc → back on the cell.
 *
 * Runs on desktop-light only: it is a focus-order contract, not a rendering one, and the drawer's
 * two other presentations (overlay and sheet) trap focus identically — e2e/responsive.spec.ts
 * pins that they exist and axe.spec.ts audits them at both widths.
 */
import type { Page } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import { CANONICAL_QUERY_EN, expect, loginAs, test } from "./fixtures";

/**
 * The one program with a search-URL builder (src/lib/grid/deeplinks/index.ts): AA in v1.
 * Two names, because the grid and the drawer deliberately use different ones: the cell has 112 px
 * and takes PROGRAM_SHORT_NAMES, the drawer takes the long SOURCE_NAMES form (src/lib/grid/format.ts
 * states that rule, and the Open button broke it — "Open in Singapore" named a country).
 */
const LINKED_PROGRAM = "American";
const LINKED_PROGRAM_LONG = "American Airlines AAdvantage";

interface Active {
  tag: string;
  role: string | null;
  testid: string | null;
  chip: string | null;
  label: string | null;
  text: string;
  href: string | null;
  row: number | null;
  col: number | null;
}

/** A description of `document.activeElement` — the assertion subject of every step below. */
function active(page: Page): Promise<Active> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) throw new Error("nothing is focused");
    const num = (v: string | undefined) => (v === undefined ? null : Number(v));
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      testid: el.dataset.testid ?? null,
      chip: el.dataset.chip ?? null,
      label: el.getAttribute("aria-label"),
      text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
      href: el.getAttribute("href"),
      row: num(el.dataset.row),
      col: num(el.dataset.col),
    };
  });
}

/**
 * Press Tab until `match` accepts the focused element. Bounded, and the failure names everything
 * the walk passed through, so "the button is unreachable" and "the button is 40 tabs away" are
 * different failures with different messages.
 */
async function tabTo(page: Page, what: string, match: (a: Active) => boolean, max = 60): Promise<Active> {
  const seen: string[] = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press("Tab");
    const a = await active(page);
    if (match(a)) return a;
    seen.push(`${a.tag}${a.testid ? `[${a.testid}]` : ""}${a.label ? `(${a.label})` : a.text ? `(${a.text})` : ""}`);
  }
  throw new Error(`Tab never reached ${what} in ${max} presses. Passed: ${seen.join(" → ")}`);
}

/** Coordinates of the first available cell whose cheapest program has a deep link. */
async function linkedCell(page: Page): Promise<{ row: number; col: number }> {
  const found = await page.evaluate((program) => {
    for (const cell of document.querySelectorAll<HTMLElement>('td[role="gridcell"][data-state="ok"]')) {
      if (cell.querySelector(".ag-program")?.textContent?.trim() === program) {
        return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
      }
    }
    return null;
  }, LINKED_PROGRAM);
  if (!found) throw new Error(`no ${LINKED_PROGRAM} cell in the demo grid`);
  return found;
}

test.describe("keyboard walk", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-light", "a focus-order contract, walked once");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  });

  test("parse → chips → grid → drawer → open link, with no mouse at all", async ({ page }) => {
    await loginAs(page, "demo");
    await page.goto("/grid");
    // Focus starts on the document, not on an element this test put it on.
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

    // 1. Tab to the query bar.
    const bar = await tabTo(page, "the query bar", (a) => a.label === en["grid.search"]);
    expect(bar.tag).toBe("textarea");

    // 2. Type the canonical query and run it with Enter.
    await page.keyboard.type(CANONICAL_QUERY_EN);
    await expect(page.getByRole("textbox", { name: en["grid.search"] })).toHaveValue(CANONICAL_QUERY_EN);
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-chip="origins"]')).toBeVisible({ timeout: 60_000 });
    // Enter runs the query; it does not move focus out of the field the user is typing in.
    expect((await active(page)).label).toBe(en["grid.search"]);

    // 3. Tab to the chips row and open the Origins editor with Enter.
    const origins = await tabTo(page, "the Origins chip", (a) => a.chip === "origins");
    expect(origins.tag).toBe("button");
    await page.keyboard.press("Enter");
    const popover = page.locator('[data-slot="popover-content"]');
    await expect(popover).toBeVisible();
    // The popover takes focus, so the editor is reachable without going back to the page.
    expect(await popover.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    // 4. Remove HND with the keyboard. Tokyo is one city row (TYO ▸ NRT ✓ HND ✓), so the control
    //    that drops a single airport is that airport's own toggle; the row's × removes both.
    const hnd = await tabTo(page, "the HND toggle", (a) => a.label === `HND ${en["grid.chips.selected"]}`);
    expect(hnd.tag).toBe("button");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-chip="origins"]')).not.toContainText("HND");
    await expect(page.locator('[data-chip="origins"]')).toContainText("NRT");

    // 5. Esc closes the editor and hands focus back to the chip that opened it.
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    expect((await active(page)).chip).toBe("origins");

    // 6. Tab to the Run affordance the edit revealed, and run.
    const run = await tabTo(page, "the Run affordance", (a) => a.testid === "chips-run");
    expect(run.text).toBe(en["grid.run"]);
    await page.keyboard.press("Enter");
    const grid = page.getByRole("grid");
    await expect(grid).toBeVisible({ timeout: 60_000 });
    await expect(grid).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
    await expect(page.locator('td[role="gridcell"][data-state="ok"]').first()).toBeVisible();

    // 7. Tab into the grid: exactly one cell is tabbable (the roving tabindex, spec §3.4).
    const landing = await tabTo(page, "the grid", (a) => a.role === "gridcell");
    expect(landing.row).not.toBeNull();

    // 8. Arrows to a cell whose cheapest program has a booking link. Right first, then down —
    //    the same two keys a user would reach for, one press per step, no wrapping.
    const target = await linkedCell(page);
    for (let c = landing.col!; c < target.col; c += 1) await page.keyboard.press("ArrowRight");
    for (let c = landing.col!; c > target.col; c -= 1) await page.keyboard.press("ArrowLeft");
    for (let r = landing.row!; r < target.row; r += 1) await page.keyboard.press("ArrowDown");
    for (let r = landing.row!; r > target.row; r -= 1) await page.keyboard.press("ArrowUp");
    const onCell = await active(page);
    expect({ row: onCell.row, col: onCell.col }).toEqual(target);
    expect(onCell.role).toBe("gridcell");
    expect(onCell.label).toContain(LINKED_PROGRAM);

    // 9. Enter opens the cell drawer, and the drawer takes focus.
    await page.keyboard.press("Enter");
    const drawer = page.getByTestId("cell-drawer");
    await expect(drawer).toBeVisible();
    expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    // 10. Tab to "Open in <program>": a real link with a real href, so the user leaves for the
    //     program's site from the keyboard (spec §3.5).
    const open = await tabTo(page, `"${en["grid.sheet.open_in"].replace("{program}", LINKED_PROGRAM_LONG)}"`, (a) => a.testid === "drawer-open");
    expect(open.tag).toBe("a");
    expect(open.text).toBe(en["grid.sheet.open_in"].replace("{program}", LINKED_PROGRAM_LONG));
    expect(open.href).toBeTruthy();
    expect(open.href).toMatch(/^https:\/\//);
    // The confirmation line is on screen above it, not in a tooltip the keyboard cannot open.
    await expect(drawer.getByTestId("drawer-caveat")).toHaveText(en["grid.deeplink_caveat"]);

    // 11. Esc closes the drawer and returns focus to the cell that opened it.
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    const back = await active(page);
    expect({ row: back.row, col: back.col, role: back.role }).toEqual({ ...target, role: "gridcell" });
  });
});
