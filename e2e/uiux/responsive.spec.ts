/**
 * T21: cross-size and text scale (plan 04 T21; acceptance A35, A36).
 */
// The harness's own test (./test): its network lockdown is what openScenario requires (T01).
import { WEB_URL, WITH_WEB } from '../../playwright.uiux.config';
import { fakeKeyboard, keyboard, openScenario, requestLog, searchByText, setTextScale } from './helpers';
import { auditLayout, documentScrolls, type LayoutAudit } from './layout-audit';
import { expect, test } from './test';
// UIUX_WEB=0 runs the iOS surface only (T18): the tests that open the Web (the plan's widths from 768, and the Web audits)
// are skipped there, never failed. The plan's test below stays verbatim, so the rule is by title.
const WEB_OFF = 'UIUX_WEB=0: the Web surface is not started in this run';
test.beforeEach(async ({}, info) => {
  test.skip(!WITH_WEB && /^(core data survives width (768|1024|1280|1440) |Web )/.test(info.title), WEB_OFF);
});
for (const width of [320,390,430,768,1024,1280,1440]) {
  test(`core data survives width ${width} at 200% text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openScenario(page, 'long-labels', width < 768 ? 'ios' : 'web', { lang: 'zh' });
    await setTextScale(page, 2);
    await expect(page.getByText('75,000').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  });
}

// ---- T21 Step 3/4: every screen, measured (plan: "inspect every long-label/action bounding box"; A35) ----
//
// The plan's check above compares with innerWidth, which a mobile browser widens when it zooms out to fit a page that
// is too wide, so it can pass over the very overflow it looks for. These measure against the layout viewport
// (clientWidth) and also look for text cut by its box and for controls that cover each other (./layout-audit.ts).

const SCALES = [1, 1.3, 1.6, 2] as const;
const clean = (a: LayoutAudit) => a.overflowX === 0 && a.clipped.length === 0 && a.overlaps.length === 0;
/** After a resize or a scale change: two frames, so a density switch (table ↔ cards) has rendered before measuring. */
const settle = (page: import('@playwright/test').Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const VIEWS = { zh: ['日历', '矩阵', '列表'], en: ['Calendar', 'Matrix', 'List'] } as const;

for (const lang of ['zh', 'en'] as const) {
  test(`iOS (${lang}): every screen at 320, 390 and 430, at 100–200% text: nothing wider than the screen, cut or covered`, async ({ page }) => {
    test.setTimeout(240_000);
    const screens: Array<[string, string, string | null]> = [
      ['long-labels', '#/', null], ['long-labels', '#/', VIEWS[lang][0]], ['long-labels', '#/', VIEWS[lang][1]],
      ['long-labels', '#/edit', null], ['long-labels', '#/ask', null], ['long-labels', '#/settings', null], ['long-labels', '#/settings/seats', null],
      ['watch-changes', '#/watches', null], ['favorite-snapshot', '#/saved', null], ['no-seats-key', '#/', null],
    ];
    const problems: Record<string, LayoutAudit> = {};
    for (const [scenario, hash, view] of screens) {
      await openScenario(page, scenario, 'ios', { lang });
      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate((h) => (location.hash = h), hash);
        if (view) await page.getByRole('radio', { name: view, exact: true }).first().click();
        for (const scale of SCALES) {
          await setTextScale(page, scale);
          await settle(page);
          const a = await auditLayout(page);
          // The shell's document never scrolls: each screen scrolls its own area (review 2 REACH-1).
          const scrolls = await documentScrolls(page);
          if (scrolls) a.clipped.push(`the document scrolls by ${scrolls}`);
          if (!clean(a)) problems[`${scenario} ${hash}${view ? ` ${view}` : ''} ${width} ${scale}`] = a;
        }
      }
    }
    await openScenario(page, 'long-labels', 'ios', { lang });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => (location.hash = '#/'));
      await page.locator('.ag-result-open-button').first().click();
      await expect(page).toHaveURL(/#\/detail\//);
      for (const scale of SCALES) {
        await setTextScale(page, scale);
        await settle(page);
        const a = await auditLayout(page);
        const scrolls = await documentScrolls(page);
        if (scrolls) a.clipped.push(`the document scrolls by ${scrolls}`);
        if (!clean(a)) problems[`detail ${width} ${scale}`] = a;
      }
    }
    expect(problems).toEqual({});
  });

  test(`Web (${lang}): the workspace, its three views and Saved from 320 to 1440 at 100–200% text; Queries and Settings at every width`, async ({ page }) => {
    test.setTimeout(300_000);
    await openScenario(page, 'long-labels', 'web', { lang });
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
    // Real content on every page audited (T21 review SIZE-5): a saved option, and standing queries, one of them with a
    // 60-character name that has no space to break at (SIZE-6).
    await page.getByRole('button', { name: lang === 'zh' ? '收藏选项' : 'Save option', exact: true }).first().click();
    const availability = (await import('../../packages/core/test/fixtures/uiux/availability-rows.json', { with: { type: 'json' } })).default;
    for (const name of ['HKGSEABusinessFirstOctoberWeekendsAeroplanOnlyWatchlistNoSpa', lang === 'zh' ? '香港到西雅图十月商务舱与头等舱周末' : 'Hong Kong to Seattle, October, business']) {
      const res = await page.request.post(`${WEB_URL}/api/queries`, { data: { name, query: availability.query }, headers: { Origin: WEB_URL } });
      expect(res.status()).toBe(201);
    }
    const problems: Record<string, LayoutAudit> = {};
    // The workspace and Saved follow the Quiet Precision text scale; /queries and /settings are the Web's older pages,
    // on its own fixed type (their large text is the browser's zoom, which is a narrower page: the widths cover it).
    const pages: Array<[string, readonly number[]]> = [['/workspace', SCALES], ['/workspace/saved', SCALES], ['/queries', [1]], ['/settings', [1]]];
    for (const [path, scales] of pages) {
      if (path !== '/workspace') await page.goto(`${WEB_URL}${path}`);
      for (const width of [320, 390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const scale of scales) {
          await setTextScale(page, scale);
          await settle(page);
          const a = await auditLayout(page);
          if (!clean(a)) problems[`${path} ${width} ${scale}`] = a;
          if (path !== '/workspace') continue;
          for (const view of VIEWS[lang]) {
            const button = page.getByRole('button', { name: view, exact: true });
            await button.evaluate((el) => el.scrollIntoView({ block: 'center' }));
            await button.click();
            const b = await auditLayout(page);
            if (!clean(b)) problems[`${path} ${view} ${width} ${scale}`] = b;
          }
        }
      }
    }
    expect(problems).toEqual({});
  });

  test(`Web (${lang}): a detail, the assistant and the palette on a phone at 200% text`, async ({ page }) => {
    await openScenario(page, 'long-labels', 'web', { lang });
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
    const problems: Record<string, LayoutAudit> = {};
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await setTextScale(page, 2);
      const view = page.getByRole('button', { name: lang === 'zh' ? /查看选项/ : /^View option/ }).first();
      await view.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await view.click();
      await expect.poll(async () => (await page.getByTestId('detail-panel').boundingBox())?.x).toBe(0);
      const d = await auditLayout(page);
      if (!clean(d)) problems[`detail ${width}`] = d;
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('detail-panel')).toHaveCount(0);
      await page.keyboard.press('ControlOrMeta+k');
      await expect(page.getByTestId('command-palette')).toBeVisible();
      const p = await auditLayout(page);
      if (!clean(p)) problems[`palette ${width}`] = p;
      await page.keyboard.press('Escape');
    }
    expect(problems).toEqual({});
  });
}

// ---- The software keyboard at large text (plan 04 risk 3: "200% Chinese, the soft keyboard and 320 wide hide the main
// action"; T11 held it at 100%). A stand-in keyboard (helpers.fakeKeyboard), not a device one.
for (const [width, height, kb, pan] of [[320, 568, 260, 0], [320, 568, 260, 180], [390, 844, 336, 0]] as const) {
  test(`iOS keyboard at ${width} × ${height}, 200% Chinese${pan ? ', panned' : ''}: Find and the field being typed in stay above it`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await fakeKeyboard(page);
    await openScenario(page, 'long-labels', 'ios', { lang: 'zh' });
    await setTextScale(page, 2);
    await page.locator('#edit-search').click();
    const field = page.locator(pan ? '#query-miles' : '#query-origins');
    await field.scrollIntoViewIfNeeded();
    await field.focus();
    await keyboard(page, kb, pan);
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'open');
    const limit = height - (kb - pan);
    const submit = page.getByRole('button', { name: '查找兑换选项', exact: true });
    await expect.poll(async () => {
      const b = (await submit.boundingBox())!;
      return b.y + b.height;
    }).toBeLessThanOrEqual(limit + 0.5);
    const b = (await submit.boundingBox())!;
    // Its whole label is inside it, and a tap on it lands on it.
    expect(await submit.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('button')?.textContent ?? null, [b.x + b.width / 2, b.y + b.height / 2])).toContain('查找兑换选项');
    const footerTop = (await page.locator('.query-editor-footer').boundingBox())!.y;
    await expect.poll(async () => {
      const f = (await field.boundingBox())!;
      return f.y + f.height;
    }).toBeLessThanOrEqual(footerTop + 0.5);
    await expect(field).toBeFocused();
    expect(await requestLog(page)).toMatchObject({ seats: 0, anthropic: 0 });
  });
}

// ---- The shell's document never scrolls (T21 review 2 REACH-1): hidden status text inside a screen's scroll area once
// made the document taller than the screen, so a drag slid the header and tab bar off and left the screen half blank.
// Seen at 100% after an ordinary search with four rows, as well as at large text (the loop above).
test('iOS: after a real search at 100% text, the document is exactly the screen; only the results scroll', async ({ page }) => {
  await openScenario(page, 'complete', 'ios', { lang: 'en' });
  await searchByText(page, 'Synthetic HKG to SEA October business and first');
  await expect(page.getByTestId('availability-card').first()).toBeVisible();
  await settle(page);
  expect(await documentScrolls(page)).toBe(0);
  expect(await page.evaluate(() => { const m = document.querySelector('.app-main')!; return m.scrollHeight > m.clientHeight; })).toBe(true);
});

// ---- A short screen at large text, with options chosen (T21 review 2 REACH-3; docs/04 S01: at large text the header is
// measured, and stops being sticky rather than cover the results). With the compare bar up, a sticky header of 225 left
// the results 50 px, or none: with one option chosen, the next could not be tapped at all.
for (const lang of ['en', 'zh'] as const) {
  for (const [width, height] of [[320, 568], [375, 667]] as const) {
    test(`iOS (${lang}) at ${width} × ${height}, 200% text, options chosen: the results keep room, and each option can be tapped`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openScenario(page, 'long-labels', 'ios', { lang });
      await setTextScale(page, 2);
      await settle(page);
      const boxes = page.locator('[data-testid="availability-card"] input[type="checkbox"]');
      expect(await boxes.count()).toBeGreaterThanOrEqual(2);
      for (const i of [0, 1]) {
        // A real tap: the box must be reachable by scrolling and be what the tap lands on.
        await boxes.nth(i).click({ timeout: 5_000 });
        await expect(boxes.nth(i)).toBeChecked();
        await settle(page);
        const room = await page.evaluate(() => {
          const main = document.querySelector('.app-main')!;
          const sticky = document.querySelector('.ag-results-sticky')!;
          const pinned = getComputedStyle(sticky).position === 'sticky' ? sticky.getBoundingClientRect().height : 0;
          return { main: main.clientHeight, free: main.clientHeight - pinned };
        });
        expect(room.free).toBeGreaterThanOrEqual(room.main / 3);
      }
      expect(await documentScrolls(page)).toBe(0);
    });
  }
}

// ---- The header's sticky state does not follow the selection (T21 review 3 REGR-1). The compare bar is taller with one
// option chosen (it says why it cannot compare yet), so a bare 40% test flipped the header static and then sticky again
// on the second pick, pinning it back over the box just chosen, focus included.
for (const [lang, width, height, scale] of [['en', 320, 568, 1.3], ['zh', 375, 667, 2], ['zh', 320, 568, 1.6]] as const) {
  test(`iOS (${lang}) at ${width} × ${height}, ${scale * 100}% text: choosing a second option leaves the header as it was, and the box just chosen in view`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openScenario(page, 'long-labels', 'ios', { lang });
    await setTextScale(page, scale);
    await settle(page);
    const boxes = page.locator('[data-testid="availability-card"] input[type="checkbox"]');
    const state = () => page.locator('.ag-results-sticky').evaluate((el) => getComputedStyle(el).position);
    await boxes.nth(0).click();
    await settle(page);
    const afterOne = await state();
    // The second box about 30 px below the top of the results' scroll area, where a sticky header would cover it.
    await page.evaluate(() => {
      const main = document.querySelector('.app-main')!;
      const box = document.querySelectorAll('[data-testid="availability-card"] input[type="checkbox"]')[1]!;
      main.scrollTop += box.getBoundingClientRect().top - main.getBoundingClientRect().top - 30;
    });
    await boxes.nth(1).click();
    await expect(boxes.nth(1)).toBeChecked();
    await settle(page);
    expect(await state()).toBe(afterOne);
    // What a tap there now reaches is the box itself, not the header.
    const hit = await boxes.nth(1).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === el || (top instanceof Element && top.closest('label') === el.closest('label'));
    });
    expect(hit).toBe(true);
  });
}
