/**
 * T21: the layout audit is only evidence if it fails on the defects it is for. Each case puts one there, expects the
 * audit to name it, takes it away, and expects the audit clean again. The cases are the defects both T21 reviews found
 * or the audit once missed:
 *
 *   iOS  a segment's label in a span running out of its button (review SIZE-3, review 2 CLOSE-1); a row's value wrapping
 *        past a squeezed row (review 2 REACH-2); text drawn over text below the first screen (review 2 CLOSE-3); the
 *        document itself scrolling (review 2 REACH-1).
 *   Web  a fixed 20-px line under 200% text (review SIZE-1); a label that cannot wrap; a control cut by a short hidden
 *        box; a page wider than the screen; the calendar's words running into the next day under aria-hidden (review
 *        A11Y-1, review 2 DELTA-1); a select's value cut (review 2 CLOSE-2); controls with no words cut by a hidden box.
 */
import type { Page } from '@playwright/test';
import { WITH_WEB } from '../../playwright.uiux.config';
import { auditLayout, documentScrolls } from './layout-audit';
import { openScenario, setTextScale } from './helpers';
import { expect, test } from './test';

const CLEAN = { overflowX: 0, clipped: [], overlaps: [] };
/** Puts `css` on the page, returns the audit, and takes it off again. */
async function withStyle(page: Page, css: string) {
  const tag = await page.addStyleTag({ content: css });
  const audit = await auditLayout(page);
  const scrolls = await documentScrolls(page);
  await tag.evaluate((el) => (el as Element).remove());
  return { ...audit, scrolls, all: [...audit.clipped, ...audit.overlaps].join('\n') };
}

test('iOS: the audit names each defect it is for, and is clean without it', async ({ page }) => {
  await openScenario(page, 'long-labels', 'ios', { lang: 'en' });
  await page.setViewportSize({ width: 390, height: 844 });
  await setTextScale(page, 2);
  expect(await auditLayout(page)).toEqual(CLEAN);
  expect(await documentScrolls(page)).toBe(0);
  // A segment's label, in its span, that cannot shrink to its third (the state before the SIZE-3 fix): at 390 it hangs
  // out of its button without touching the next label, so only the words-in-their-control check sees it.
  const segment = await withStyle(page, '.ag-segment-label, .ag-segment-label::after { min-width: auto !important; max-width: none !important; overflow-wrap: normal !important; }');
  expect(segment.all).toMatch(/"Calendar" runs out of it/);
  // Text over text on the second card, which starts below the first screen.
  const below = await withStyle(page, '.ag-result-card:last-of-type .ag-result-when { position: relative; top: -28px; }');
  expect(below.overlaps.some((o) => o.startsWith('text '))).toBe(true);
  // The shell's scroll area no longer the containing block of its hidden status text: the document grows and scrolls.
  const doc = await withStyle(page, '.app-main { position: static !important; }');
  expect(doc.scrolls).toBeGreaterThan(0);
  expect(await auditLayout(page)).toEqual(CLEAN);
  // Words cut by a box that declares an ellipsis it cannot draw (an inline-flex label; a wrapped line cut in height):
  // nothing says they were cut (review 3 SHUT-3).
  const flexEllipsis = await withStyle(page, '.ag-segment-label { overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; min-width: 0 !important; }');
  expect(flexEllipsis.all).toMatch(/Calendar/);
  const wrappedEllipsis = await withStyle(page, '.ag-result-card .ag-result-when { height: 1.2em !important; overflow: hidden !important; text-overflow: ellipsis !important; }');
  expect(wrappedEllipsis.all).toMatch(/ag-result-when/);
  // Audited from a scrolled screen: the sticky header over the scrolled results is by design, not a finding
  // (review 3 SHUT-1), and the audit puts the screen back where it was.
  await page.locator('.app-main').evaluate((el) => (el.scrollTop = 500));
  expect(await auditLayout(page)).toEqual(CLEAN);
  expect(await page.locator('.app-main').evaluate((el) => el.scrollTop)).toBe(500);
  // Text over text in a late row of the matrix, inside its own scroll area inside the screen's (review 3 SHUT-2).
  await page.locator('.app-main').evaluate((el) => (el.scrollTop = 0));
  await page.getByRole('radio', { name: 'Matrix', exact: true }).first().click();
  expect(await auditLayout(page)).toEqual(CLEAN);
  for (const row of [20, 30]) {
    const late = await withStyle(page, `.ag-mx-grid tbody tr:nth-child(${row}) .ag-mx-date-week { position: relative; top: -28px; }`);
    expect(late.overlaps.some((o) => o.startsWith('text '))).toBe(true);
  }
  await page.getByRole('radio', { name: 'List', exact: true }).first().click();
  // A defect at the top of a screen, audited while the screen is scrolled away from it (review 3 SHUT-1).
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.locator('.ag-settings-title, h1').first()).toBeVisible();
  expect(await auditLayout(page)).toEqual(CLEAN);
  await page.locator('.app-main').evaluate((el) => (el.scrollTop = el.scrollHeight));
  const top = await withStyle(page, 'h1 { position: relative; top: 34px; }');
  expect(top.overlaps.some((o) => o.startsWith('text '))).toBe(true);
  await page.evaluate(() => (location.hash = '#/'));

  // The editor's Programs row squeezed back to 44 (the state before the REACH-2 fix): at 320 its value wraps past it.
  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => (location.hash = '#/edit'));
  await expect(page.locator('#query-programs-row')).toBeVisible();
  expect(await auditLayout(page)).toEqual(CLEAN);
  const row = await withStyle(page, '.query-editor-body > * { flex-shrink: 1 !important; }');
  expect(row.all).toMatch(/query-programs-row|runs out of it|spills its box/);
  expect(await auditLayout(page)).toEqual(CLEAN);
});

test('Web: the audit names each defect it is for, and is clean without it', async ({ page }) => {
  test.skip(!WITH_WEB, 'UIUX_WEB=0: the Web surface is not started in this run');
  await openScenario(page, 'long-labels', 'web', { lang: 'en' });
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
  await page.setViewportSize({ width: 390, height: 844 });
  await setTextScale(page, 2);
  expect(await auditLayout(page)).toEqual(CLEAN);
  // The review's SIZE-1: scaled type on a fixed 20px line (the state before the fix).
  const line = await withStyle(page, '.ag-ws, .ag-ws-tokens, .ag-ws *, .ag-web-option-miles, .ag-web-option-route, .ag-web-option-meta, .ag-web-button { line-height: 20px !important; }');
  expect(line.overlaps.some((o) => o.startsWith('text '))).toBe(true);
  // A label that cannot wrap, wider than its button.
  const label = await withStyle(page, '.ag-ws-segment { white-space: nowrap !important; overflow-wrap: normal !important; flex: 0 0 60px !important; }');
  expect(label.clipped.length + label.overlaps.length).toBeGreaterThan(0);
  // A control cut by a short box that hides its overflow; and controls with no words of their own.
  const cut = await withStyle(page, '.ag-web-option-actions { height: 12px !important; overflow: hidden !important; }');
  expect(cut.all).toMatch(/cuts its content/);
  const icons = await withStyle(page, '.ag-ws-head-actions { height: 10px !important; overflow: hidden !important; } .ag-ws-head-actions * { font-size: 0 !important; }');
  expect(icons.all).toMatch(/cuts its content/);
  // A select's value cut, with no ellipsis to say so.
  const select = await withStyle(page, '.ag-ws-select { width: 140px !important; text-overflow: clip !important; }');
  expect(select.all).toMatch(/value ".*" cut/);
  // A page wider than the screen.
  const wide = await withStyle(page, '.ag-ws-title { min-width: 600px !important; flex: none !important; }');
  expect(wide.overflowX).toBeGreaterThan(0);
  expect(await auditLayout(page)).toEqual(CLEAN);
  // The head's Commands drawn over the title, audited while the page is scrolled down to the views (review 3 SHUT-1).
  await page.getByRole('button', { name: 'Matrix', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  const head = await withStyle(page, '.ag-ws-head-actions { position: relative; top: -60px; }');
  expect(head.all).toMatch(/Search workspace|Commands/);

  // The review's A11Y-1: at 768 and 160%, the month kept at seven columns runs its (aria-hidden) words into the next day.
  await page.setViewportSize({ width: 768, height: 900 });
  await setTextScale(page, 1.6);
  const calendar = page.getByRole('button', { name: 'Calendar', exact: true });
  await calendar.scrollIntoViewIfNeeded();
  await calendar.click();
  await expect(page.getByTestId('calendar-view')).toBeVisible();
  expect(await auditLayout(page)).toEqual(CLEAN);
  const month = await withStyle(page, '.ag-ws-month { container-type: normal !important; }');
  expect(month.all).toMatch(/ag-ws-day/);
  expect(await auditLayout(page)).toEqual(CLEAN);
});
