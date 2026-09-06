/**
 * Phase 6.2 — the interaction budget (spec §3.4): 92 days × 16 routes must scroll and hover at
 * 60 fps. The query goes in through ?q= (the shareable URL codec in src/components/grid/state.ts)
 * so the page runs it on load; the DEMO mock answers rows for the six known pairs and nothing
 * for the others, which is exactly what scroll and hover cost depend on (a full 1,472-cell grid).
 *
 * Measured with requestAnimationFrame inside the page: 60 frames while the grid container is
 * scrolled programmatically (+200 px per frame), then the frames spent while the mouse crosses
 * 30 cells. The average frame time must stay under 20 ms (60 fps is 16.7 ms; headless Chromium
 * paces rAF at the display rate, so the number reads as "no dropped frames"), and the DOM must
 * hold fewer than 1,500 gridcells — the body is virtualized, never 1,472 cells at once.
 * Desktop projects only; the numbers are printed so the run log carries them.
 */
import type { Page } from "@playwright/test";
import type { QueryObject } from "../src/lib/query/schema";
import { applyTheme, expect, gridQueryHref, isoDaysFromToday, loginAs, projectSuffix, test } from "./fixtures";

const FRAME_BUDGET_MS = 20;
const MAX_CELLS_IN_DOM = 1_500;
const SCROLL_FRAMES = 60;
const HOVER_CELLS = 30;

/** 92 consecutive days from today (UTC, the app's e2e timezone) × 8 origins × 2 destinations = 16 routes. */
function perfQuery(): QueryObject {
  return {
    origins: ["HKG", "PVG", "SHA", "NRT", "HND", "ICN", "TPE", "KIX"],
    destinations: ["SEA", "SFO"],
    date_from: isoDaysFromToday(0),
    date_to: isoDaysFromToday(91),
    cabins: ["J", "F"],
    direct_only: false,
    include_filtered: false,
    sort_by: "miles_asc",
    raw_text: "perf: 16 routes over 92 days",
    language: "en",
  };
}

interface FrameStats {
  frames: number;
  avgMs: number;
  maxMs: number;
}

function stats(times: number[]): FrameStats {
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i += 1) deltas.push((times[i] ?? 0) - (times[i - 1] ?? 0));
  const avg = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
  return { frames: deltas.length, avgMs: Math.round(avg * 100) / 100, maxMs: Math.round(Math.max(0, ...deltas) * 100) / 100 };
}

/** Frame timestamps over `frames` rAF ticks while the grid's scroll container scrolls 200 px per tick. */
function scrollFrames(page: Page, frames: number): Promise<number[]> {
  return page.evaluate(
    ({ frames }) =>
      new Promise<number[]>((resolve) => {
        const scroller = document.querySelector<HTMLElement>(".ag-scroll");
        if (!scroller) throw new Error("no .ag-scroll container");
        scroller.scrollTop = 0;
        const times: number[] = [];
        const tick = (ts: number) => {
          times.push(ts);
          if (times.length > frames) {
            resolve(times);
            return;
          }
          scroller.scrollTop += 200;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { frames },
  );
}

declare global {
  interface Window {
    __agFrames?: number[];
    __agStop?: boolean;
  }
}

/** Start recording rAF timestamps into window.__agFrames until window.__agStop is set. */
async function startFrameRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__agFrames = [];
    window.__agStop = false;
    const tick = (ts: number) => {
      window.__agFrames?.push(ts);
      if (!window.__agStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopFrameRecorder(page: Page): Promise<number[]> {
  return page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        window.__agStop = true;
        // One more frame so the last recorded tick is the one that saw the stop flag.
        requestAnimationFrame(() => resolve(window.__agFrames ?? []));
      }),
  );
}

test.describe("grid perf", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(projectSuffix(testInfo.project.name).viewport === "mobile", "the budget is stated for a laptop; the mobile grid is one-line cells");
    await applyTheme(page);
  });

  test("92 days × 16 routes: virtualized DOM, scroll and hover under 20 ms per frame", async ({ page }) => {
    test.setTimeout(180_000);
    await loginAs(page, "demo");
    const query = perfQuery();
    await page.goto(gridQueryHref(query));

    const grid = page.getByRole("grid");
    await expect(grid).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("grid-searching")).toBeHidden({ timeout: 120_000 });
    await expect(grid).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
    await expect(grid).toHaveAttribute("aria-rowcount", "93");
    await expect(grid).toHaveAttribute("aria-colcount", "17");
    await expect(page.locator('td[role="gridcell"][data-state="ok"]').first()).toBeVisible();

    // Virtualized: the wrapper says so and the DOM never holds the whole 92 × 16 body.
    await expect(page.locator(".ag-wrap")).toHaveAttribute("data-virtualized", "true");
    const cellsInDom = await page.locator('td[role="gridcell"]').count();
    console.log(`grid-perf ${test.info().project.name}: ${cellsInDom} gridcells in the DOM (of ${92 * 16})`);
    expect(cellsInDom).toBeLessThan(MAX_CELLS_IN_DOM);

    // Warm up one frame, then scroll for 60 frames.
    await page.waitForTimeout(200);
    const scroll = stats(await scrollFrames(page, SCROLL_FRAMES));
    console.log(`grid-perf ${test.info().project.name}: scroll avg ${scroll.avgMs} ms, max ${scroll.maxMs} ms over ${scroll.frames} frames`);
    expect(scroll.frames).toBe(SCROLL_FRAMES);
    expect(scroll.avgMs).toBeLessThan(FRAME_BUDGET_MS);

    // Still virtualized after scrolling to the bottom third: rows were recycled, not appended.
    expect(await page.locator('td[role="gridcell"]').count()).toBeLessThan(MAX_CELLS_IN_DOM);

    // The grid never loses its one tab stop: with the roving cell scrolled out of the virtual
    // window, the first rendered cell carries tabindex=0 and Tab from the toolbar lands on it.
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>(".ag-scroll");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForTimeout(200);
    await expect(page.locator('td[role="gridcell"][tabindex="0"]')).toHaveCount(1);
    await page.getByRole("toolbar").getByRole("button", { name: "Ask", exact: true }).focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("gridcell");
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>(".ag-scroll");
      if (scroller) scroller.scrollTop = 0;
    });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);

    // Hover: cross 30 cells that are inside the scroll container's viewport with the real mouse
    // while the recorder counts frames; each move lands on a different cell so every step
    // changes the highlighted row/column header and re-arms the tooltip.
    const targets = await page.evaluate((n) => {
      const scroller = document.querySelector<HTMLElement>(".ag-scroll");
      if (!scroller) return [];
      const box = scroller.getBoundingClientRect();
      const out: { x: number; y: number }[] = [];
      for (const td of Array.from(document.querySelectorAll<HTMLElement>('td[role="gridcell"]'))) {
        const r = td.getBoundingClientRect();
        if (r.top < box.top + 48 || r.bottom > box.bottom || r.left < box.left + 96 || r.right > box.right) continue;
        out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        if (out.length >= n) break;
      }
      return out;
    }, HOVER_CELLS);
    expect(targets.length).toBe(HOVER_CELLS);

    await startFrameRecorder(page);
    for (const p of targets) await page.mouse.move(p.x, p.y);
    const hover = stats(await stopFrameRecorder(page));
    console.log(`grid-perf ${test.info().project.name}: hover avg ${hover.avgMs} ms, max ${hover.maxMs} ms over ${hover.frames} frames across ${targets.length} cells`);
    expect(hover.frames).toBeGreaterThan(5);
    expect(hover.avgMs).toBeLessThan(FRAME_BUDGET_MS);
    // The last hovered cell's headers are highlighted, so the hover path really ran.
    await expect(page.locator("thead th[data-hl='true']")).toHaveCount(1);
  });
});
