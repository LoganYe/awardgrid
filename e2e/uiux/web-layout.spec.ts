/**
 * T19: the Web professional workspace (plan 04 T19; docs/04 S10; spec §17; acceptance A31, A32).
 *
 * Runs in the web-desktop project (1440×900, a fine pointer, no touch): widths are set per test, and the coarse
 * pointer at desktop width has its own block. Every request is counted in the browser (the page's own /api calls) and
 * at the stand-in seats.aero, so "nothing was sent" is measured, not assumed.
 */
// The harness's own test (./test): its network lockdown is what openScenario requires (T01).
import type { Page } from '@playwright/test';
import { evidenceShot, openScenario, webRequestLog } from './helpers';
import { expect, test } from './test';
test('desktop side panels are mutually exclusive', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, 'complete', 'web', { lang: 'zh' });
  await page.getByRole('button', { name: 'AI辅助', exact: true }).click();
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
  await page.getByRole('button', { name: /查看选项/ }).first().click();
  await expect(page.getByTestId('detail-panel')).toBeVisible();
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
});

type Box = { x: number; width: number; height: number; right: number };
const box = (page: Page, selector: string): Promise<Box> =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), width: Math.round(r.width), height: Math.round(r.height), right: Math.round(r.right) };
  });

/** Every /api request the page makes from now on, as "METHOD /path". */
function apiCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) calls.push(`${request.method()} ${url.pathname}`);
  });
  return calls;
}

const ready = async (page: Page) => expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');

test.describe('S10 geometry (A31)', () => {
  test('1440: rail 72, padding 24, main 936 + gap 24 + assistant 360 + padding 24; detail 400 with main 896; none 1320', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'zh' });
    await ready(page);
    expect(await box(page, '.ag-ws-rail')).toMatchObject({ x: 0, width: 72 });
    expect(await box(page, '.ag-ws-main')).toMatchObject({ x: 96, width: 1320 });

    await page.getByRole('button', { name: 'AI辅助', exact: true }).click();
    const assistant = page.getByTestId('assistant-panel');
    await expect(assistant).toHaveAttribute('data-mode', 'docked');
    expect(await box(page, '.ag-ws-main')).toMatchObject({ x: 96, width: 936 });
    expect(await box(page, '[data-testid="assistant-panel"]')).toMatchObject({ x: 96 + 936 + 24, width: 360, right: 1440 - 24 });

    await page.getByRole('button', { name: /查看选项/ }).first().click();
    await expect(page.getByTestId('detail-panel')).toHaveAttribute('data-mode', 'docked');
    await expect(assistant).toHaveCount(0);
    expect(await box(page, '.ag-ws-main')).toMatchObject({ x: 96, width: 896 });
    expect(await box(page, '[data-testid="detail-panel"]')).toMatchObject({ x: 96 + 896 + 24, width: 400, right: 1440 - 24 });

    // Nothing else pushes the page: the grid's own push mode is not used here.
    expect(await page.evaluate(() => document.documentElement.dataset.drawerPush ?? null)).toBeNull();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('detail-panel')).toHaveCount(0);
    expect(await box(page, '.ag-ws-main')).toMatchObject({ width: 1320 });
  });

  test('1920: the content stops at 1600; 1280 still docks', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    expect((await box(page, '.ag-ws-page')).width).toBe(1600);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'AI assistance', exact: true }).click();
    await expect(page.getByTestId('assistant-panel')).toHaveAttribute('data-mode', 'docked');
    expect((await box(page, '.ag-ws-main')).width).toBe(1280 - 72 - 24 - 24 - 360 - 24);
  });

  for (const width of [1024, 768]) {
    test(`${width}: a panel overlays the results and never squeezes them`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openScenario(page, 'complete', 'web', { lang: 'en' });
      await ready(page);
      const before = await box(page, '.ag-ws-main');
      await page.getByRole('button', { name: /^View option/ }).first().click();
      const detail = page.getByTestId('detail-panel');
      await expect(detail).toHaveAttribute('data-mode', 'overlay');
      await expect(detail).toHaveAttribute('aria-modal', 'true');
      expect(await box(page, '.ag-ws-main')).toEqual(before);
      expect((await box(page, '[data-testid="detail-panel"]')).width).toBe(400);
      await page.keyboard.press('Escape');
      await expect(detail).toHaveCount(0);
      // Focus came back to the control that opened the panel.
      await expect(page.getByRole('button', { name: /^View option/ }).first()).toBeFocused();
    });
  }

  test('390, English (the longer labels): nothing widens the page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole('combobox', { name: 'Cabin mix' }).selectOption('75');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('390: one column, a bottom bar, a full-height panel, no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openScenario(page, 'complete', 'web', { lang: 'zh' });
    await ready(page);
    const rail = await box(page, '.ag-ws-rail');
    expect(rail.width).toBe(390);
    expect(await page.locator('.ag-ws-rail').evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // Every control in the bar is at least 44 × 44.
    for (const item of await page.locator('.ag-ws-rail-item').all()) {
      const b = await item.boundingBox();
      expect(b!.height).toBeGreaterThanOrEqual(44);
      expect(b!.width).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('button', { name: /查看选项/ }).first().click();
    const detail = page.getByTestId('detail-panel');
    await expect(detail).toHaveAttribute('data-mode', 'sheet');
    // Once its slide in has finished.
    await expect.poll(() => box(page, '[data-testid="detail-panel"]')).toMatchObject({ x: 0, width: 390, height: 844 });
    await detail.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(detail).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe('panels keep the page as it was', () => {
  test('opening and closing a panel keeps the view, the scroll and the conditions; the assistant sends nothing on open', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 560 });
    const calls = apiCalls(page);
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    await page.getByRole('combobox', { name: 'Stops' }).selectOption('nonstop');
    // The page scrolled so the last row sits mid-screen: its control is already in view, and a click never scrolls to it.
    const view = page.getByRole('button', { name: /^View option/ }).last();
    await view.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(0);
    const scrolled = await page.evaluate(() => Math.round(scrollY));
    const before = calls.length;
    expect(await view.evaluate((el) => el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await view.click();
    await expect(page.getByTestId('detail-panel')).toBeVisible();
    expect(await page.evaluate(() => Math.round(scrollY))).toBe(scrolled);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('detail-panel')).toHaveCount(0);
    await expect(view).toBeFocused();
    expect(await page.evaluate(() => Math.round(scrollY))).toBe(scrolled);
    // The assistant from the palette, then back.
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: 'Type a command' }).fill('AI');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
    expect(await page.evaluate(() => Math.round(scrollY))).toBe(scrolled);
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'list');
    await expect(page.getByRole('combobox', { name: 'Stops' })).toHaveValue('nonstop');
    // Opening the assistant asked nothing of Claude: no question was posted.
    expect(calls.slice(before).filter((c) => c === 'POST /api/ask')).toEqual([]);
  });
});

test.describe('one snapshot, three views (A31; plan Step 4)', () => {
  test('the list, the calendar and the matrix show the same options of the same snapshot; switching sends nothing', async ({ page }) => {
    const calls = apiCalls(page);
    await openScenario(page, 'complete', 'web', { lang: 'zh' });
    await ready(page);
    const list = await page
      .getByTestId('availability-list')
      .locator('[data-row-key]')
      .evaluateAll((els) => els.map((el) => [el.getAttribute('data-row-key'), el.getAttribute('data-snapshot-id')]));
    expect(list.length).toBeGreaterThan(0);
    const snapshotId = list[0]![1];
    const keys = list.map(([k]) => k).sort();
    const finds = calls.filter((c) => c === 'POST /api/find').length;

    await page.getByRole('button', { name: '矩阵', exact: true }).click();
    await expect(page.getByTestId('matrix-view')).toBeVisible();
    // Open every cell with results and collect its options (one opens the details; several list below).
    const matrixKeys = new Set<string>();
    const cells = page.locator('[data-testid="matrix-view"] [role="gridcell"][data-has-results]');
    for (let i = 0; i < (await cells.count()); i++) {
      await cells.nth(i).click();
      const detail = page.getByTestId('detail-panel');
      if (await detail.isVisible()) {
        const row = detail.locator('[data-row-key]');
        expect(await row.getAttribute('data-snapshot-id')).toBe(snapshotId);
        matrixKeys.add((await row.getAttribute('data-row-key'))!);
        await page.keyboard.press('Escape');
        await expect(detail).toHaveCount(0);
      } else {
        for (const key of await page.getByTestId('matrix-cell-options').locator('[data-row-key]').evaluateAll((els) => els.map((el) => el.getAttribute('data-row-key')!))) matrixKeys.add(key);
      }
    }
    expect([...matrixKeys].sort()).toEqual(keys);

    await page.getByRole('button', { name: '日历', exact: true }).click();
    await expect(page.getByTestId('calendar-view')).toBeVisible();
    const calendarKeys = new Set<string>();
    const cabins = await page.locator('.ag-ws-calendar select option').evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
    for (const cabin of cabins.length > 0 ? cabins : [null]) {
      if (cabin) await page.locator('.ag-ws-calendar select').selectOption(cabin);
      const days = page.locator('[data-testid="calendar-view"] .ag-ws-day[data-state="results"]');
      for (let i = 0; i < (await days.count()); i++) {
        await days.nth(i).click();
        const detail = page.getByTestId('detail-panel');
        if (await detail.isVisible()) {
          calendarKeys.add((await detail.locator('[data-row-key]').getAttribute('data-row-key'))!);
          await page.keyboard.press('Escape');
          await expect(detail).toHaveCount(0);
        } else {
          for (const key of await page.getByTestId('calendar-day-options').locator('[data-row-key]').evaluateAll((els) => els.map((el) => el.getAttribute('data-row-key')!))) calendarKeys.add(key);
        }
      }
    }
    expect([...calendarKeys].sort()).toEqual(keys);
    // No view change searched again.
    await page.getByRole('button', { name: '列表', exact: true }).click();
    expect(calls.filter((c) => c === 'POST /api/find').length).toBe(finds);
  });

  test('more than one route opens on the matrix; a view chosen by hand is kept for the account', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'list');
    await page.getByLabel('From', { exact: true }).fill('HKG, PVG');
    await page.getByRole('button', { name: 'Find award options', exact: true }).click();
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'matrix');
    await expect(page.getByTestId('matrix-view')).toBeVisible();
    await expect(page.locator('[data-testid="matrix-view"] th[role="columnheader"]')).toHaveCount(3);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.reload();
    await ready(page);
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'list');
  });
});

test.describe('the query: explicit confirmation (D08), no AI', () => {
  test('editing a hard condition sends nothing and says so; only Find runs it, once; nothing asks AI', async ({ page }) => {
    const calls = apiCalls(page);
    await openScenario(page, 'complete', 'web', { lang: 'zh' });
    await ready(page);
    const before = calls.length;
    const rows = async () => page.getByTestId('availability-list').locator('[data-row-key]').evaluateAll((els) => els.map((el) => el.getAttribute('data-snapshot-id')));
    const shown = await rows();
    await page.getByRole('combobox', { name: '经停' }).selectOption('nonstop');
    await page.getByLabel('目的机场', { exact: true }).fill('SEA, YVR');
    await page.getByRole('checkbox', { name: '经济舱' }).check();
    await expect(page.getByText('条件已修改。运行前不会查询。')).toBeVisible();
    await page.waitForTimeout(300);
    expect(calls.slice(before)).toEqual([]);
    expect(await rows()).toEqual(shown);
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.getByLabel('目的机场', { exact: true })).toHaveValue('SEA');
    await expect(page.getByText('条件已修改。运行前不会查询。')).toHaveCount(0);

    await page.getByRole('combobox', { name: '经停' }).selectOption('nonstop');
    await page.getByRole('button', { name: '查找兑换选项', exact: true }).click();
    await expect.poll(() => calls.slice(before).filter((c) => c === 'POST /api/find').length).toBe(1);
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
    expect(calls.some((c) => c === 'POST /api/parse' || c === 'POST /api/ask')).toBe(false);
    // The address names the search on screen.
    expect(new URL(page.url()).searchParams.get('q')).not.toBeNull();
  });

  test('a broken condition names itself, takes focus and runs nothing', async ({ page }) => {
    const calls = apiCalls(page);
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    const before = calls.length;
    await page.getByLabel('From', { exact: true }).fill('HK1');
    await page.getByRole('button', { name: 'Find award options', exact: true }).click();
    await expect(page.getByText('Unknown airport or city code: HK1')).toBeVisible();
    await expect(page.getByLabel('From', { exact: true })).toBeFocused();
    await expect(page.getByLabel('From', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    expect(calls.slice(before).filter((c) => c === 'POST /api/find')).toEqual([]);
  });
});

test.describe('keyboard (A32)', () => {
  test('"/" focuses the query from the page, never while typing or composing; Cmd/Ctrl+Enter runs only from the query', async ({ page }) => {
    const calls = apiCalls(page);
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    const from = page.getByLabel('From', { exact: true });
    await page.getByRole('heading', { name: 'Search workspace' }).click();
    await page.keyboard.press('/');
    await expect(from).toBeFocused();
    // Typing "/" inside a field is text, not a shortcut.
    const to = page.getByLabel('To', { exact: true });
    await to.fill('SEA');
    await page.keyboard.type('/');
    await expect(to).toHaveValue('SEA/');
    await expect(to).toBeFocused();
    await to.fill('SEA');
    // A key that belongs to an IME composition is left alone.
    const list = page.getByRole('button', { name: 'List', exact: true });
    await list.focus();
    await page.evaluate(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true, isComposing: true })));
    await page.evaluate(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true, keyCode: 229 })));
    await expect(list).toBeFocused();
    // Cmd/Ctrl+Enter outside the query runs nothing; inside it, it is Find.
    const before = calls.filter((c) => c === 'POST /api/find').length;
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);
    expect(calls.filter((c) => c === 'POST /api/find').length).toBe(before);
    await page.getByRole('checkbox', { name: 'Economy', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Economy', exact: true }).press('ControlOrMeta+Enter');
    await expect.poll(() => calls.filter((c) => c === 'POST /api/find').length).toBe(before + 1);
  });

  test('Cmd/Ctrl+K and the visible Commands button open the palette: 560 wide, 48 search, 44 options, app actions only; Esc returns focus', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'zh' });
    await ready(page);
    const commands = page.getByRole('button', { name: /^命令/ });
    await commands.focus();
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    await expect(palette).toHaveAttribute('aria-modal', 'true');
    expect((await box(page, '[data-testid="command-palette"]')).width).toBe(560);
    expect((await box(page, '.ag-ws-palette-input')).height).toBe(48);
    for (const option of await palette.getByRole('option').all()) expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(palette.getByRole('combobox')).toBeFocused();
    // Only the page's own actions: nothing to type a command or an address into.
    await palette.getByRole('combobox').fill('rm -rf');
    await expect(palette.getByRole('option')).toHaveCount(0);
    await expect(palette.getByText('没有匹配的命令。')).toBeVisible();
    await palette.getByRole('combobox').fill('矩阵');
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'matrix');
    await expect(commands).toBeFocused();
    // The visible alternative, and Esc back to it.
    await commands.click();
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    await expect(commands).toBeFocused();
  });

  test('shortcuts can be turned off (and back on), for this account, and every action keeps its control', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    await page.getByRole('button', { name: /^Commands/ }).click();
    await page.getByRole('option', { name: /Turn keyboard shortcuts off/ }).click();
    await expect(page.locator('.ag-web-notice')).toContainText('Keyboard shortcuts are off.');
    await expect(page.locator('.ag-ws-kbd')).toHaveCount(0);
    await page.reload();
    await ready(page);
    await page.getByRole('heading', { name: 'Search workspace' }).click();
    await page.keyboard.press('/');
    await expect(page.getByLabel('From', { exact: true })).not.toBeFocused();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
    // Every control is still there.
    await page.getByRole('button', { name: /^Commands/ }).click();
    await page.getByRole('option', { name: /Turn keyboard shortcuts on/ }).click();
    await page.getByRole('heading', { name: 'Search workspace' }).click();
    await page.keyboard.press('/');
    await expect(page.getByLabel('From', { exact: true })).toBeFocused();
  });

  test('the matrix is one tab stop: arrows move, Enter opens, Esc returns to the cell', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    await page.getByRole('button', { name: 'Matrix', exact: true }).click();
    const cells = page.locator('[data-testid="matrix-view"] [role="gridcell"]');
    await expect(cells.first()).toHaveAttribute('tabindex', '0');
    expect(await page.locator('[data-testid="matrix-view"] [role="gridcell"][tabindex="0"]').count()).toBe(1);
    await cells.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(cells.nth(1)).toBeFocused();
    await page.keyboard.press('ControlOrMeta+End');
    await expect(cells.last()).toBeFocused();
    const withResults = page.locator('[data-testid="matrix-view"] [role="gridcell"][data-has-results]').first();
    await withResults.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('detail-panel').or(page.getByTestId('matrix-cell-options')).first()).toBeVisible();
    // Focus has moved to what opened: the details, or the cell's options.
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="detail-panel"], .ag-ws-cell-options'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(withResults).toBeFocused();
  });
});

test.describe('details are local until asked', () => {
  test('opening an option fetches nothing; "View flight itineraries" says its cost, sends one Get Trips, and the header re-reads the count', async ({ page }) => {
    const calls = apiCalls(page);
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    const trips = (await webRequestLog(page, 'complete')).trips;
    await page.getByRole('button', { name: /^View option/ }).first().click();
    const detail = page.getByTestId('detail-panel');
    await expect(detail).toBeVisible();
    await expect(detail.getByText('Loading itineraries sends one request to seats.aero and counts against your quota.')).toBeVisible();
    await page.waitForTimeout(200);
    expect(calls.filter((c) => c.startsWith('GET /api/trips'))).toEqual([]);
    expect((await webRequestLog(page, 'complete')).trips).toBe(trips);
    const usageBefore = calls.filter((c) => c === 'GET /api/usage').length;
    await detail.getByRole('button', { name: 'View flight itineraries', exact: true }).click();
    await expect(detail.getByTestId('flights-list').or(detail.getByTestId('flights-error')).first()).toBeVisible();
    expect(calls.filter((c) => c.startsWith('GET /api/trips'))).toHaveLength(1);
    await expect.poll(() => calls.filter((c) => c === 'GET /api/usage').length).toBeGreaterThan(usageBefore);
  });
});

test.describe('coarse pointer at desktop width (spec §17: targets follow the pointer, not the width)', () => {
  test.use({ hasTouch: true });
  test('every control in the workspace is at least 44 tall', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'zh' });
    await ready(page);
    const short = await page
      .locator('.ag-ws :is(button, select, input:not([type="checkbox"]), summary, a)')
      .evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => [el.textContent?.trim() || el.getAttribute('aria-label') || el.tagName, Math.round(el.getBoundingClientRect().height)] as const)
          .filter(([, h]) => h < 44),
      );
    expect(short).toEqual([]);
  });
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: evidence at 1440 in Chinese (the assistant, the matrix with an option) and the 1024 overlay`, async ({ page }) => {
    await openScenario(page, 'multi-program', 'web', { theme, lang: 'zh' });
    await ready(page);
    await page.getByRole('button', { name: 'AI辅助', exact: true }).click();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    await evidenceShot(page, `t19-web-1440-assistant-${theme}`);
    await page.getByRole('button', { name: '矩阵', exact: true }).click();
    await page.locator('[data-testid="matrix-view"] [role="gridcell"][data-has-results]').first().click();
    await expect(page.getByTestId('detail-panel').or(page.getByTestId('matrix-cell-options')).first()).toBeVisible();
    await evidenceShot(page, `t19-web-1440-matrix-${theme}`);
    // Esc closes the top-most layer each time: the cell's options (if listed), then the panel.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
    await expect(page.getByTestId('detail-panel')).toHaveCount(0);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.getByRole('button', { name: '列表', exact: true }).click();
    await page.getByRole('button', { name: /查看选项/ }).first().click();
    await expect(page.getByTestId('detail-panel')).toHaveAttribute('data-state', 'open');
    await evidenceShot(page, `t19-web-1024-overlay-${theme}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await evidenceShot(page, `t19-web-palette-${theme}`);
  });
}

// ---- T19 review regressions (each first reproduced by the review; see evidence/T19-web-workspace.md) ----

/** Hold /api/find's answers until released (the request reaches the server; its answer waits). */
async function holdFind(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const bodies: Array<Record<string, unknown>> = [];
  await page.route('**/api/find', async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  return { release, bodies };
}

const focusInside = (page: Page, testId: string) => page.evaluate((id) => !!document.querySelector(`[data-testid="${id}"]`)?.contains(document.activeElement), testId);

test.describe('review: panels, focus and layers', () => {
  test('LAY-1: crossing 1280 with a panel open keeps focus in the panel, and an overlay traps it', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    await page.getByRole('button', { name: 'AI assistance', exact: true }).click();
    await expect(page.getByTestId('assistant-panel')).toHaveAttribute('data-mode', 'docked');
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.getByTestId('assistant-panel')).toHaveAttribute('data-mode', 'overlay');
    await expect.poll(() => focusInside(page, 'assistant-panel')).toBe(true);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await focusInside(page, 'assistant-panel')).toBe(true);
    }
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^View option/ }).first().click();
    await expect(page.getByTestId('detail-panel')).toHaveAttribute('data-mode', 'overlay');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('detail-panel')).toHaveAttribute('data-mode', 'docked');
    await expect.poll(() => focusInside(page, 'detail-panel')).toBe(true);
  });

  test('LAY-2: the palette is above an overlay panel; Esc closes the palette first, then the panel', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    await page.getByRole('button', { name: 'AI assistance', exact: true }).click();
    await expect(page.getByTestId('assistant-panel')).toHaveAttribute('data-mode', 'overlay');
    // Once it has slid in: 360 wide against the right edge.
    await expect.poll(async () => (await page.getByTestId('assistant-panel').boundingBox())?.x).toBe(1024 - 360);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    const box = (await page.getByTestId('assistant-panel').boundingBox())!;
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.className ?? '', [box.x + box.width / 2, box.y + box.height - 40])).toContain('ag-ws-palette-scrim');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
    await expect(page.getByTestId('assistant-panel')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
  });

  test('LAY-3: the palette\'s "Focus the query" over an overlay closes the panel and focuses the query', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    await page.getByRole('button', { name: 'AI assistance', exact: true }).click();
    await expect(page.getByTestId('assistant-panel')).toHaveAttribute('data-mode', 'overlay');
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: 'Type a command' }).fill('Focus');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
    await expect(page.getByLabel('From', { exact: true })).toBeFocused();
  });

  test('LAY-4: switching panels, Esc returns focus to the control that opened the panel on screen', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    const ai = page.getByRole('button', { name: 'AI assistance', exact: true });
    const view = page.getByRole('button', { name: /^View option/ }).last();
    await ai.click();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    await view.click();
    await expect(page.getByTestId('detail-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('detail-panel')).toHaveCount(0);
    await expect(view).toBeFocused();
    // The other way round.
    await view.click();
    await expect(page.getByTestId('detail-panel')).toBeVisible();
    await ai.click();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
    await expect(ai).toBeFocused();
  });

  test('LAY-9: Esc in the Programs popover closes it, not the panel behind; a second Esc closes the panel', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    await page.getByRole('button', { name: 'AI assistance', exact: true }).click();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    const programs = page.locator('details.ag-ws-programs');
    await programs.locator('summary').click();
    await programs.getByRole('checkbox').first().focus();
    await page.keyboard.press('Escape');
    expect(await programs.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    await expect(programs.locator('summary')).toBeFocused();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
  });

  test('REG-7: an Esc that belongs to an IME (keyCode 229) in the query does not close the panel', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'zh' });
    await ready(page);
    await page.getByRole('button', { name: 'AI辅助', exact: true }).click();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    const from = page.getByLabel('出发机场', { exact: true });
    await from.focus();
    await page.evaluate(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, bubbles: true, cancelable: true })));
    await expect(page.getByTestId('assistant-panel')).toHaveCount(1);
    await expect(from).toBeFocused();
  });

  test('LAY-8: arrowing through the palette keeps the active option in view', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.press('ArrowUp');
    const inView = await page.evaluate(() => {
      const input = document.querySelector('.ag-ws-palette-input')!;
      const option = document.getElementById(input.getAttribute('aria-activedescendant')!)!.getBoundingClientRect();
      const list = document.querySelector('.ag-ws-palette-list')!.getBoundingClientRect();
      return option.top >= list.top - 1 && option.bottom <= list.bottom + 1;
    });
    expect(inView).toBe(true);
  });

  for (const lang of ['en', 'zh'] as const) {
    test(`LAY-11 (${lang}): at 1440×900 the docked assistant's question box and Send are in view when it opens`, async ({ page }) => {
      await openScenario(page, 'complete', 'web', { lang });
      await ready(page);
      await page.getByRole('button', { name: lang === 'en' ? 'AI assistance' : 'AI辅助', exact: true }).click();
      const panel = page.getByTestId('assistant-panel');
      await expect(panel).toHaveAttribute('data-mode', 'docked');
      const bottom = (sel: string) => panel.locator(sel).first().evaluate((el) => el.getBoundingClientRect().bottom);
      expect(await bottom('[data-testid="ask-prompt"]')).toBeLessThanOrEqual(900);
      expect(await bottom('[data-testid="ask-send"]')).toBeLessThanOrEqual(900);
      expect(await page.evaluate(() => scrollY)).toBe(0);
    });
  }
});

test.describe('review: no sideways scroll, the footer, the calendar', () => {
  for (const [width, lang] of [[1024, 'en'], [900, 'en'], [768, 'en'], [768, 'zh']] as const) {
    test(`LAY-5: ${width} ${lang}: the list never widens the page, before or after a panel`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openScenario(page, 'complete', 'web', { lang });
      await ready(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.getByRole('button', { name: lang === 'en' ? /^View option/ : /查看选项/ }).first().click();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('detail-panel')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  test('LAY-6: at 390 the footer\'s Legal link is reachable above the bottom bar, on the workspace and Saved', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    for (const where of ['workspace', 'saved'] as const) {
      if (where === 'saved') {
        await page.locator('.ag-ws-rail').getByRole('link', { name: 'Saved', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Saved', exact: true })).toBeVisible();
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => page.evaluate(() => Math.round(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1)).toBe(true);
      const legal = page.locator('footer a[href="/legal"]');
      const b = (await legal.boundingBox())!;
      expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('a')?.getAttribute('href') ?? null, [b.x + b.width / 2, b.y + b.height / 2])).toBe('/legal');
    }
  });

  for (const width of [390, 320]) {
    test(`LAY-12: at ${width} the calendar is a list of dates and nothing is cut`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openScenario(page, 'complete', 'web', { lang: 'en' });
      await ready(page);
      await page.getByRole('button', { name: 'Calendar', exact: true }).click();
      await expect(page.getByTestId('calendar-view')).toBeVisible();
      await expect(page.locator('.ag-ws-weekdays').first()).toBeHidden();
      const cut = await page.locator('.ag-ws-day').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length);
      expect(cut).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      // Arrows move one day in the list.
      const days = page.locator('.ag-ws-day');
      await days.first().focus();
      await page.keyboard.press('ArrowDown');
      await expect(days.nth(1)).toBeFocused();
    });
  }
});

test.describe('review: coarse pointer inside the panels (LAY-10, REG-3)', () => {
  test.use({ hasTouch: true });
  test('with a panel open, every control in it is at least 44 × 44 where it is a button', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'zh' });
    await ready(page);
    const small = (scope: string) =>
      page.locator(`[data-testid="${scope}"] :is(button, textarea, select, input:not([type="checkbox"]):not([type="radio"]), [role="button"])`).evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => {
            const r = el.getBoundingClientRect();
            const button = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
            return [el.textContent?.trim() || el.getAttribute('aria-label') || el.tagName, Math.round(r.width), Math.round(r.height), button] as const;
          })
          .filter(([, w, h, button]) => h < 44 || (button && w < 44)),
      );
    await page.getByRole('button', { name: /查看选项/ }).first().click();
    await expect(page.getByTestId('detail-panel')).toBeVisible();
    expect(await small('detail-panel')).toEqual([]);
    await page.getByRole('button', { name: 'AI辅助', exact: true }).click();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    expect(await small('assistant-panel')).toEqual([]);
  });
});

test('LAY-10: with a fine pointer, a docked panel\'s Close is at least 36 × 36', async ({ page }) => {
  await openScenario(page, 'complete', 'web', { lang: 'en' });
  await ready(page);
  await page.getByRole('button', { name: /^View option/ }).first().click();
  const close = page.getByTestId('detail-panel').getByRole('button', { name: 'Close', exact: true });
  const b = (await close.boundingBox())!;
  expect(b.width).toBeGreaterThanOrEqual(36);
  expect(b.height).toBeGreaterThanOrEqual(36);
});

test.describe('review: the query and what it says', () => {
  test('PRD-1: a city code expands to its airports, says so, and the search sends the airports', async ({ page }) => {
    const find = await holdFind(page);
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    find.release();
    await ready(page);
    await page.getByLabel('From', { exact: true }).fill('TYO');
    await expect(page.getByTestId('expands-origins')).toHaveText('TYO means NRT, HND.');
    await page.getByRole('button', { name: 'Find award options', exact: true }).click();
    await expect.poll(() => find.bodies.length).toBe(2);
    expect((find.bodies[1]!.query as { origins: string[] }).origins).toEqual(['NRT', 'HND']);
  });

  test('PRD-3: every coverage notice is shown with its routes, with no results too', async ({ page }) => {
    // The Web server's own coverage for the unmonitored scenario (its route catalogue leaves the pair out).
    await openScenario(page, 'unmonitored', 'web', { lang: 'en' });
    await ready(page);
    await expect(page.getByTestId('coverage-notice').filter({ hasText: 'These routes are not monitored by the data source.' })).toHaveCount(1);
    await expect(page.getByTestId('coverage-notice').first()).toContainText('HKG → SEA');
    await openScenario(page, 'complete-empty', 'web', { lang: 'en' });
    await ready(page);
    await expect(page.getByTestId('coverage-notice').filter({ hasText: 'No matches in the checked range.' })).toHaveCount(1);
  });

  test('PRD-5, PRD-6: during a search its own conditions are not "changed"; an edit made during it survives the answer', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    const find = await holdFind(page);
    await page.getByRole('checkbox', { name: 'First', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Find award options', exact: true }).click();
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'running');
    await expect(page.getByText('Conditions changed. Nothing is searched until you run them.')).toHaveCount(0);
    await page.getByLabel('To', { exact: true }).fill('YVR');
    await expect(page.getByText('Conditions changed. Nothing is searched until you run them.')).toBeVisible();
    find.release();
    await ready(page);
    await expect(page.getByLabel('To', { exact: true })).toHaveValue('YVR');
    await expect(page.getByText('Conditions changed. Nothing is searched until you run them.')).toBeVisible();
  });

  test('PRD-7: an invalid mileage cap is said under the cap, takes focus, and runs nothing', async ({ page }) => {
    const calls = apiCalls(page);
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await ready(page);
    const before = calls.filter((c) => c === 'POST /api/find').length;
    await page.getByLabel('Mileage cap').fill('0');
    await page.getByRole('button', { name: 'Find award options', exact: true }).click();
    await expect(page.getByText('Enter a whole number of miles above 0, or leave it empty.')).toBeVisible();
    await expect(page.getByLabel('Mileage cap')).toBeFocused();
    await expect(page.getByLabel('Mileage cap')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.filter((c) => c === 'POST /api/find').length).toBe(before);
  });

  test('PRD-8: Find carries the sort the view shows; it is never undone by an older one', async ({ page }) => {
    const find = await holdFind(page);
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    find.release();
    await ready(page);
    const sort = page.getByRole('combobox', { name: 'Sort' });
    await sort.selectOption('fees_asc');
    await page.getByRole('checkbox', { name: 'Economy', exact: true }).check();
    await page.getByRole('button', { name: 'Find award options', exact: true }).click();
    await ready(page);
    await sort.selectOption('date_asc');
    await page.getByRole('checkbox', { name: 'Premium economy', exact: true }).check();
    await page.getByRole('button', { name: 'Find award options', exact: true }).click();
    await expect.poll(() => find.bodies.length).toBe(3);
    await ready(page);
    expect((find.bodies[2]!.query as { sort_by: string }).sort_by).toBe('date_asc');
    await expect(sort).toHaveValue('date_asc');
  });
});
