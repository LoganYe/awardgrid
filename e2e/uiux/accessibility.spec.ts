/**
 * T21: accessibility on both surfaces (plan 04 T21; acceptance A36; spec §10, §19).
 *
 *   - axe (WCAG 2.0/2.1 A and AA) on every main screen of the iOS shell and the Web workspace, both themes, both
 *     languages: no serious or critical violation. Counts are logged per screen (evidence/raw/t21-a11y.log).
 *   - Reduced motion: nothing moves (computed durations are 0) where panels and sheets would slide.
 *   - A modal sheet keeps focus inside and gives it back where it came from (iOS here; the Web's panels and palette
 *     are covered in web-layout.spec.ts: LAY-1, LAY-2, LAY-4 and the overlay cases).
 *   - Colour is never the only cue: each state these screens show by colour is also said in words or an attribute.
 *
 * Not here: VoiceOver on a device, the system's Dynamic Type, a real touch screen. Those are reported unverified.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { WEB_URL, WITH_WEB } from '../../playwright.uiux.config';
import { openScenario } from './helpers';
import { expect, test } from './test';

async function axe(page: Page, key: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const counts: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of results.violations) counts[v.impact ?? 'minor'] = (counts[v.impact ?? 'minor'] ?? 0) + 1;
  const bad = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  console.log(`axe ${key}: ${JSON.stringify(counts)}${results.violations.length ? ` [${results.violations.map((v) => `${v.id}:${v.impact}`).join(', ')}]` : ''}`);
  return bad.flatMap((v) => v.nodes.map((n) => `${key} ${v.id}: ${n.target.join(' ')}`));
}

const VIEWS = { zh: ['日历', '矩阵'], en: ['Calendar', 'Matrix'] } as const;
// UIUX_WEB=0 runs the iOS surface only (T18): a Web test is skipped there, and a test over both surfaces keeps its iOS half.
const WEB_OFF = 'UIUX_WEB=0: the Web surface is not started in this run';

for (const theme of ['light', 'dark'] as const) {
  for (const lang of ['zh', 'en'] as const) {
    test(`iOS ${theme} ${lang}: no serious or critical axe violation on any main screen`, async ({ page }) => {
      test.setTimeout(180_000);
      const bad: string[] = [];
      const screens: Array<[string, string, string | null]> = [
        ['long-labels', '#/', null], ['long-labels', '#/', VIEWS[lang][0]], ['long-labels', '#/', VIEWS[lang][1]],
        ['long-labels', '#/edit', null], ['long-labels', '#/ask', null], ['long-labels', '#/settings', null],
        ['watch-changes', '#/watches', null], ['favorite-snapshot', '#/saved', null], ['no-seats-key', '#/', null], ['partial', '#/', null],
      ];
      for (const [scenario, hash, view] of screens) {
        await openScenario(page, scenario, 'ios', { lang, theme });
        await page.evaluate((h) => (location.hash = h), hash);
        if (view) await page.getByRole('radio', { name: view, exact: true }).first().click();
        bad.push(...(await axe(page, `ios ${theme} ${lang} ${scenario} ${hash}${view ? ` ${view}` : ''}`)));
      }
      await openScenario(page, 'long-labels', 'ios', { lang, theme });
      await page.locator('.ag-result-open-button').first().click();
      await expect(page).toHaveURL(/#\/detail\//);
      bad.push(...(await axe(page, `ios ${theme} ${lang} detail`)));
      expect(bad).toEqual([]);
    });

    test(`Web ${theme} ${lang}: no serious or critical axe violation on the workspace, its views and panels, Saved and Queries`, async ({ page }) => {
      test.skip(!WITH_WEB, WEB_OFF);
      test.setTimeout(180_000);
      const bad: string[] = [];
      await page.setViewportSize({ width: 1440, height: 900 });
      await openScenario(page, 'long-labels', 'web', { lang, theme });
      await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
      bad.push(...(await axe(page, `web ${theme} ${lang} workspace list`)));
      for (const view of VIEWS[lang]) {
        await page.getByRole('button', { name: view, exact: true }).click();
        bad.push(...(await axe(page, `web ${theme} ${lang} workspace ${view}`)));
      }
      await page.getByRole('button', { name: lang === 'zh' ? '列表' : 'List', exact: true }).click();
      await page.getByRole('button', { name: lang === 'zh' ? /查看选项/ : /^View option/ }).first().click();
      await expect(page.getByTestId('detail-panel')).toBeVisible();
      bad.push(...(await axe(page, `web ${theme} ${lang} detail panel`)));
      await page.getByRole('button', { name: lang === 'zh' ? 'AI辅助' : 'AI assistance', exact: true }).click();
      await expect(page.getByTestId('assistant-panel')).toBeVisible();
      bad.push(...(await axe(page, `web ${theme} ${lang} assistant panel`)));
      await page.keyboard.press('Escape');
      await page.keyboard.press('ControlOrMeta+k');
      await expect(page.getByTestId('command-palette')).toBeVisible();
      bad.push(...(await axe(page, `web ${theme} ${lang} palette`)));
      await page.keyboard.press('Escape');
      for (const path of ['/workspace/saved', '/queries']) {
        await page.goto(`${WEB_URL}${path}`);
        bad.push(...(await axe(page, `web ${theme} ${lang} ${path}`)));
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${WEB_URL}/workspace`);
      bad.push(...(await axe(page, `web ${theme} ${lang} workspace 390`)));
      expect(bad).toEqual([]);
    });
  }
}

test('reduced motion: nothing slides on either surface', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const moving = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .map((el) => {
          const cs = getComputedStyle(el);
          const total = (list: string) => list.split(',').reduce((sum, t) => sum + (parseFloat(t) || 0), 0);
          return total(cs.transitionDuration) + total(cs.animationDuration) > 0 ? `${el.tagName}.${String(el.className).split(' ')[0]}` : null;
        })
        .filter(Boolean),
    );
  // iOS: a modal sheet over the saved results.
  await openScenario(page, 'favorite-snapshot', 'ios', { lang: 'en' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => (location.hash = '#/saved'));
  await page.getByRole('link', { name: /^Open saved results: / }).first().click();
  await page.getByRole('button', { name: 'Search again', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await moving()).toEqual([]);
  if (!WITH_WEB) {
    test.info().annotations.push({ type: 'skip', description: `Web half: ${WEB_OFF}` });
    return;
  }
  // Web: an overlay panel and the palette.
  await page.setViewportSize({ width: 1024, height: 768 });
  await openScenario(page, 'complete', 'web', { lang: 'en' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: /^View option/ }).first().click();
  await expect(page.getByTestId('detail-panel')).toHaveAttribute('data-mode', 'overlay');
  expect(await moving()).toEqual([]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('command-palette')).toBeVisible();
  expect(await moving()).toEqual([]);
});

test('iOS: a modal sheet keeps focus inside and gives it back to what opened it', async ({ page }) => {
  await openScenario(page, 'favorite-snapshot', 'ios', { lang: 'en' });
  await page.evaluate(() => (location.hash = '#/saved'));
  await page.getByRole('link', { name: /^Open saved results: / }).first().click();
  const opener = page.getByRole('button', { name: 'Search again', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('the Web workspace\'s headings step one level at a time (T18 review REG-2): list on a phone, calendar, cell options', async ({ page }) => {
  test.skip(!WITH_WEB, WEB_OFF);
  const order = async (key: string) => {
    const results = await new AxeBuilder({ page }).withRules(['heading-order']).analyze();
    return results.violations.flatMap((v) => v.nodes.map((n) => `${key}: ${n.target.join(' ')}`));
  };
  const bad: string[] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await openScenario(page, 'long-labels', 'web', { lang: 'en' });
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
  bad.push(...(await order('list 390')));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  bad.push(...(await order('calendar')));
  await page.getByRole('button', { name: 'Matrix', exact: true }).click();
  await page.locator('[data-testid="matrix-view"] [role="gridcell"][data-has-results]').first().click();
  bad.push(...(await order('matrix cell options')));
  expect(bad).toEqual([]);
});

test('colour is never the only cue: each state is also words or an attribute', async ({ page }) => {
  // iOS, a search not checked to the end: the matrix says so in words in its cells, not only by tint.
  await openScenario(page, 'partial', 'ios', { lang: 'en' });
  await page.getByRole('radio', { name: 'Matrix', exact: true }).first().click();
  const cells = page.locator('[role="gridcell"]');
  expect(await cells.count()).toBeGreaterThan(0);
  const named = await cells.evaluateAll((els) => els.every((el) => (el.getAttribute('aria-label') ?? '').length > 10 && (el.textContent ?? '').trim().length > 0));
  expect(named).toBe(true);
  if (!WITH_WEB) {
    test.info().annotations.push({ type: 'skip', description: `Web half: ${WEB_OFF}` });
    return;
  }
  // Web (desktop, where the list is a table): the sorted column, the pressed view and a saved option say their state.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, 'complete', 'web', { lang: 'en' });
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
  await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Lowest miles');
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Save option' }).first().click();
  const saved = page.getByRole('button', { name: 'Saved', exact: true }).first();
  await expect(saved).toHaveAttribute('aria-pressed', 'true');
  await expect(saved).toHaveText('Saved');
  // The palette (T21 review A11Y-2): the option Enter will run has a ring as well as its tint (focus stays in the
  // search box, so the option's own look is the only sign), and one that cannot run now says so in words.
  await openScenario(page, 'no-seats-key', 'web', { lang: 'en' });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('command-palette')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  const active = page.locator('.ag-ws-palette-option[aria-selected="true"]');
  await expect(active).toHaveCount(1);
  const ring = await active.evaluate((el) => ({ style: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth) }));
  expect(ring.style).toBe('solid');
  expect(ring.width).toBeGreaterThanOrEqual(2);
  const unavailable = page.locator('.ag-ws-palette-option[aria-disabled="true"]');
  expect(await unavailable.count()).toBeGreaterThan(0);
  for (const option of await unavailable.all()) await expect(option).toContainText('Not available now');
});

// ---- Overscroll (plan 04 T21 Step 3). A layer over the page (a sheet, a popover, the palette's list) and a sideways
// scroller in it keep their scrolling to themselves: reaching the end never scrolls the page behind, and a sideways swipe
// at a table's edge never turns into the browser's back gesture. Read from the computed style in Chromium; the rubber
// band itself is WebKit's, on the Simulator or a device (not run).
test('overscroll stays in the layer or scroller it started in, on both surfaces', async ({ page }) => {
  const contained = (sel: string, axis: 'x' | 'y') =>
    page.locator(sel).first().evaluate((el, a) => getComputedStyle(el)[a === 'x' ? 'overscrollBehaviorX' : 'overscrollBehaviorY'], axis);
  await openScenario(page, 'long-labels', 'ios', { lang: 'en' });
  expect(await contained('.ag-results-filters', 'x')).toBe('contain');
  await page.getByRole('radio', { name: 'Matrix', exact: true }).first().click();
  expect(await contained('.ag-mx-scroll', 'x')).toBe('contain');
  await page.getByRole('radio', { name: 'List', exact: true }).first().click();
  await page.locator('.ag-result-open-button').first().click();
  await expect(page).toHaveURL(/#\/detail\//);
  expect(await contained('.ag-detail-body', 'y')).toBe('contain');
  await openScenario(page, 'favorite-snapshot', 'ios', { lang: 'en' });
  await page.evaluate(() => (location.hash = '#/saved'));
  await page.getByRole('link', { name: /^Open saved results: / }).first().click();
  await page.getByRole('button', { name: 'Search again', exact: true }).click();
  await expect(page.locator('.ag-sheet')).toBeVisible();
  expect(await contained('.ag-sheet', 'y')).toBe('contain');
  await openScenario(page, 'long-labels', 'ios', { lang: 'en' });
  await page.locator('#edit-search').click();
  await page.locator('#query-origins').fill('Tok');
  await expect(page.locator('.query-options:not([hidden])')).toBeVisible();
  expect(await contained('.query-options:not([hidden])', 'y')).toBe('contain');
  if (!WITH_WEB) {
    test.info().annotations.push({ type: 'skip', description: `Web half: ${WEB_OFF}` });
    return;
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, 'long-labels', 'web', { lang: 'en' });
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
  expect(await contained('.ag-ws-table-wrap', 'x')).toBe('contain');
  await page.getByRole('button', { name: 'Matrix', exact: true }).click();
  expect(await contained('.ag-ws-matrix-scroll', 'x')).toBe('contain');
  await page.locator('.ag-ws-programs summary, .ag-ws-programs button').first().click();
  await expect(page.locator('.ag-ws-programs-list')).toBeVisible();
  expect(await contained('.ag-ws-programs-list', 'y')).toBe('contain');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('.ag-ws-palette-list')).toBeVisible();
  expect(await contained('.ag-ws-palette-list', 'y')).toBe('contain');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: /^View option/ }).first().click();
  await expect(page.locator('.ag-drawer-body').first()).toBeVisible();
  expect(await contained('.ag-drawer-body', 'y')).toBe('contain');
});
