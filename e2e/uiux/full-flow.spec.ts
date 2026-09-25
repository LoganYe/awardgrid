/**
 * T22: the full flow on the fixture, end to end (plan 04 T22; A37, A38).
 */
// The harness's own test (./test): its network lockdown is what openScenario requires (T01).
import type { Page } from '@playwright/test';
import { WITH_WEB } from '../../playwright.uiux.config';
import { evidenceShot, openScenario, requestLog, searchByText, setTextScale, webRequestLog } from './helpers';
import { expect, test } from './test';
test('saved snapshot opens without becoming a booking claim', async ({ page }) => {
  await openScenario(page, 'complete', 'ios', { lang: 'zh' });
  // The one line added to the plan's test (DECISIONS U-057): the fixture's `complete` opens before its first search (T01),
  // as the app does after install, so one search puts its results on screen.
  await searchByText(page, 'Synthetic HKG to SEA October business and first');
  await page.getByRole('button', { name: '收藏选项', exact: true }).first().click();
  await page.getByRole('link', { name: '收藏', exact: true }).click();
  await expect(page.getByText('收藏快照，库存可能变化。').first()).toBeVisible();
  await expect(page.getByText('预订已确认', { exact: true })).toHaveCount(0);
});

// ---- Step 3/4: the user's whole path on each surface, one run each (plan 04 T22 Interfaces: query → view → detail →
// compare → AI proposal confirmation → watch → favourite). Everything is synthetic; the real hosts are blocked, and the
// fixture counts what each step sends, so the spend of each step is held too.

const tabs = (page: Page) => page.getByRole('navigation', { name: /Main navigation|主导航/ });
/** Availability requests the fixture's seats.aero saw (Get Routes left out): what a search spends. */
const searches = (page: Page) => page.evaluate(() => (window.__uiuxFixture?.log.seatsPaths ?? []).filter((p) => !p.includes('/routes')).length);
const settled = (page: Page) => expect(page.locator('.ag-results[data-run]')).toHaveAttribute('data-run', 'finished');

test('iOS, the whole path: a query, its three views, details, compare, an AI proposal confirmed, a watch and a saved option', async ({ page }) => {
  test.setTimeout(120_000);
  await openScenario(page, 'ai-pending', 'ios', { lang: 'en' });
  const opened = await requestLog(page);
  expect(opened).toMatchObject({ seats: 0, anthropic: 0 });

  // 1. Query: the editor, then Find. Only Find sends.
  await page.getByTestId('query-summary').getByRole('link').click();
  await expect(page.getByRole('button', { name: 'Find award options' })).toBeVisible();
  expect(await searches(page)).toBe(0);
  await page.getByRole('button', { name: 'Find award options' }).click();
  await settled(page);
  const afterQuery = await searches(page);
  expect(afterQuery).toBeGreaterThan(0);
  const revision = await page.locator('.ag-results').getAttribute('data-revision');

  // 2. Views: one snapshot, three views, nothing fetched by switching.
  const cards = await page.getByTestId('availability-card').count();
  expect(cards).toBeGreaterThan(1);
  await page.getByRole('radio', { name: 'Calendar', exact: true }).first().click();
  await expect(page.getByTestId('calendar-view')).toBeVisible();
  await page.getByRole('radio', { name: 'Matrix', exact: true }).first().click();
  await expect(page.getByTestId('matrix-view')).toBeVisible();
  await page.getByRole('radio', { name: 'List', exact: true }).first().click();
  await expect(page.getByTestId('availability-card')).toHaveCount(cards);
  await expect(page.locator('.ag-results')).toHaveAttribute('data-revision', revision!);
  expect(await searches(page)).toBe(afterQuery);

  // 3. Details: opened from the card, closed back to it; opening sends nothing (no search, no Get Trips, no model).
  const beforeDetail = await requestLog(page);
  const opener = page.getByTestId('availability-card').first().getByRole('button', { name: /^View option/ });
  await opener.click();
  await expect(page).toHaveURL(/#\/detail\//);
  await page.getByRole('button', { name: 'Return to results', exact: true }).click();
  await expect(opener).toBeFocused();
  expect(await requestLog(page)).toMatchObject({ seats: beforeDetail.seats, trips: beforeDetail.trips, anthropic: beforeDetail.anthropic });

  // 4. Compare two, and back.
  const boxes = page.getByTestId('availability-list').getByRole('checkbox');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('link', { name: 'Compare selected options' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Compare selected options' })).toBeFocused();
  await page.getByRole('button', { name: 'Back to results' }).first().click();
  await settled(page);
  expect(await searches(page)).toBe(afterQuery);

  // 5. AI: a proposed change is shown as a change and runs only when confirmed, once.
  await page.getByTestId('results-header').getByRole('link').click();
  await page.getByRole('textbox', { name: 'Question for Claude' }).fill('Is there anything later in the autumn?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const proposal = page.getByTestId('query-change-proposal');
  await expect(proposal).toHaveAttribute('data-status', 'pending');
  expect(await searches(page)).toBe(afterQuery);
  expect((await requestLog(page)).anthropic).toBeGreaterThan(0);
  await proposal.getByRole('button', { name: 'Apply and search' }).click();
  await expect(proposal).toHaveAttribute('data-status', 'applied');
  await proposal.getByRole('link', { name: 'View results' }).click();
  await settled(page);
  await expect(page.getByTestId('query-summary')).toContainText('Oct 18 – Nov 6');
  const afterApply = await searches(page);
  expect(afterApply).toBeGreaterThan(afterQuery);

  // 6. Watch this search: kept as its conditions; nothing is checked until the Watches screen asks.
  await page.getByRole('button', { name: 'Watch this search' }).click();
  await tabs(page).getByRole('link', { name: /Watches/ }).click();
  await expect(page.getByTestId('watch-card').first()).toContainText('HKG → SEA');

  // 7. Save one option, then open it in Saved: a snapshot, said as one, and nothing is fetched.
  await tabs(page).getByRole('link', { name: 'Search' }).click();
  await settled(page);
  const save = page.getByTestId('availability-card').first().getByRole('button', { name: 'Save option', exact: true });
  await save.click();
  await expect(page.getByTestId('availability-card').first().getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ag-results-save')).toContainText('Option saved on this device.');
  const beforeSaved = await requestLog(page);
  await tabs(page).getByRole('link', { name: 'Saved' }).click();
  const favorite = page.getByTestId('favorite-card').first();
  await expect(favorite).toContainText('Saved snapshot; availability may change.');
  await expect(favorite).toContainText('1 option when saved');
  await favorite.getByRole('link', { name: /^Open saved results: / }).click();
  await expect(page.getByTestId('saved-list').getByTestId('availability-card')).toHaveCount(1);
  await expect(page.getByText(/booked|confirmed booking|ticketed/i)).toHaveCount(0);
  expect(await requestLog(page)).toMatchObject({ seats: beforeSaved.seats, anthropic: beforeSaved.anthropic });
});

test('Web, the same path in the workspace: a query, three views, details, a saved option in this account\'s Saved', async ({ page }) => {
  test.skip(!WITH_WEB, 'UIUX_WEB=0: the Web surface is not started in this run');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScenario(page, 'complete', 'web', { lang: 'en' });
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
  // The search itself may come from this account's cache (earlier tests ran it); what matters is that nothing after it
  // sends anything.
  const first = await webRequestLog(page, 'complete');
  for (const view of ['Calendar', 'Matrix', 'List']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await expect(page.getByRole('button', { name: view, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: /^View option/ }).first().click();
  await expect(page.getByTestId('detail-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save option' }).first().click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');
  expect((await webRequestLog(page, 'complete')).seats).toBe(first.seats);
  await page.goto(page.url().replace(/\/workspace.*$/, '/workspace/saved'));
  await expect(page.getByText('Saved snapshot; availability may change.').first()).toBeVisible();
  await expect(page.getByText(/booked|confirmed booking|ticketed/i)).toHaveCount(0);
  expect((await webRequestLog(page, 'complete')).seats).toBe(first.seats);
});

// ---- Save option on iOS (U-057): the Web's per-option save, on the phone's cards, through the same core store.
const SEARCH = 'Synthetic HKG to SEA October business and first';

test('Save option: one option, once; said; the opened snapshot is read only; nothing is fetched', async ({ page }) => {
  await openScenario(page, 'complete', 'ios', { lang: 'en' });
  await searchByText(page, SEARCH);
  const sent = await requestLog(page);
  const card = page.getByTestId('availability-list').getByTestId('availability-card').first();
  await card.getByRole('button', { name: 'Save option', exact: true }).click();
  const saved = card.getByRole('button', { name: 'Saved', exact: true });
  await expect(saved).toHaveAttribute('aria-pressed', 'true');
  // Still a button in the tab order: focus is never dropped, and a second tap does nothing.
  await expect(saved).toBeFocused();
  // aria-disabled: a tap still reaches it, and changes nothing.
  await saved.dispatchEvent('click');
  await expect(page.locator('.ag-results-save')).toContainText('Option saved on this device.');
  await tabs(page).getByRole('link', { name: 'Saved' }).click();
  await expect(page.getByTestId('favorite-card')).toHaveCount(1);
  await expect(page.getByText(/^1 of 100 saved/)).toBeVisible();
  await page.getByTestId('favorite-card').getByRole('link', { name: /^Open saved results: / }).click();
  const readOnly = page.getByTestId('saved-list').getByTestId('availability-card');
  await expect(readOnly).toHaveCount(1);
  await expect(readOnly.getByRole('button', { name: 'Save option' })).toHaveCount(0);
  await expect(readOnly.getByRole('checkbox')).toHaveCount(0);
  expect(await requestLog(page)).toMatchObject({ seats: sent.seats, anthropic: sent.anthropic });
});

test('Save option under a calendar day and a matrix cell, as in the list', async ({ page }) => {
  await openScenario(page, 'complete', 'ios', { lang: 'en' });
  await searchByText(page, SEARCH);
  await page.getByRole('radio', { name: 'Matrix', exact: true }).first().click();
  const cell = page.getByRole('gridcell', { name: /^HKG → SEA, Sun, Oct 18:/ });
  await cell.focus();
  await page.keyboard.press('Enter');
  const inCell = page.getByTestId('matrix-cell-list').getByRole('button', { name: 'Save option', exact: true }).first();
  await inCell.click();
  await expect(page.getByTestId('matrix-cell-list').getByRole('button', { name: 'Saved', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('radio', { name: 'Calendar', exact: true }).first().click();
  await page.getByTestId('calendar-view').locator('[data-date="2026-10-18"]').first().click();
  await expect(page.getByTestId('calendar-day-list').getByRole('button', { name: /^(Save option|Saved)$/ }).first()).toBeVisible();
});

test('Save option on a store that cannot be written: said as an alert; the button stays Save option; nothing saved', async ({ page }) => {
  await openScenario(page, 'storage-failure', 'ios', { lang: 'en' });
  await searchByText(page, SEARCH);
  const card = page.getByTestId('availability-list').getByTestId('availability-card').first();
  await card.getByRole('button', { name: 'Save option', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not save on this device; nothing already saved was changed' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Save option', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await tabs(page).getByRole('link', { name: 'Saved' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing saved yet' })).toBeVisible();
});

// Evidence (UIUX_EVIDENCE=1): a card's Save option, before and after, in both languages; at 320 and 200% in Chinese.
for (const lang of ['zh', 'en'] as const) {
  test(`evidence (${lang}): a card's Save option before and after saving`, async ({ page }) => {
    await openScenario(page, 'complete', 'ios', { lang });
    await searchByText(page, SEARCH);
    const card = page.getByTestId('availability-list').getByTestId('availability-card').first();
    await card.scrollIntoViewIfNeeded();
    await evidenceShot(page, `t22-ios-save-option-before-${lang}`);
    await card.getByRole('button', { name: lang === 'zh' ? '收藏选项' : 'Save option', exact: true }).click();
    await expect(card.getByRole('button', { name: lang === 'zh' ? '已收藏' : 'Saved', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await evidenceShot(page, `t22-ios-save-option-after-${lang}`);
    if (lang === 'zh') {
      await page.setViewportSize({ width: 320, height: 844 });
      await setTextScale(page, 2);
      await card.scrollIntoViewIfNeeded();
      await evidenceShot(page, 't22-ios-save-option-320-200-zh');
    }
  });
}

// The bookmark sits right beside the compare box on every card, and stays put when "Selected" is said (T22 review
// PROD-3); with options chosen, the card's corner never widens the screen (PROD-1, held in responsive.spec.ts).
for (const lang of ['en', 'zh'] as const) {
  test(`Save option (${lang}): the bookmark sits beside the compare box on every card, and does not move when one is chosen`, async ({ page }) => {
    await openScenario(page, 'complete', 'ios', { lang });
    await searchByText(page, SEARCH);
    const read = () =>
      page.locator('[data-testid="availability-list"] [data-testid="availability-card"]').evaluateAll((cards) =>
        cards.map((card) => {
          const save = card.querySelector('.ag-result-save')!.getBoundingClientRect();
          const box = card.querySelector('.ag-result-select')!.getBoundingClientRect();
          return { gap: Math.round(box.left - save.right), left: Math.round(save.left) };
        }),
      );
    const before = await read();
    expect(before.length).toBeGreaterThan(1);
    // Each Save says which option it is: its accessible description is its card's full name, so no two read alike
    // (review PROD-4).
    const cards = page.locator('[data-testid="availability-list"] [data-testid="availability-card"]');
    const names = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
    for (const [i, name] of names.entries()) await expect(cards.nth(i).locator('.ag-result-save')).toHaveAccessibleDescription(name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of before) expect(Math.abs(c.gap)).toBeLessThanOrEqual(1);
    expect(new Set(before.map((c) => c.left)).size).toBe(1);
    await page.getByTestId('availability-list').getByRole('checkbox').first().check();
    await expect(page.getByTestId('availability-card').first().locator('.ag-result-selected')).toBeVisible();
    expect(await read()).toEqual(before);
  });
}

// Two options saved from one search are told apart in Saved: which option, on the card and in its Open and Delete names
// (T22 review PROD-2), as the Web's Saved does.
test('Saved says which option a saved option is, so two are never alike', async ({ page }) => {
  await openScenario(page, 'complete', 'ios', { lang: 'en' });
  await searchByText(page, SEARCH);
  const cards = page.getByTestId('availability-list').getByTestId('availability-card');
  await cards.nth(0).getByRole('button', { name: 'Save option', exact: true }).click();
  await cards.nth(1).getByRole('button', { name: 'Save option', exact: true }).click();
  await expect(cards.nth(1).getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await tabs(page).getByRole('link', { name: 'Saved' }).click();
  const saved = page.getByTestId('favorite-card');
  await expect(saved).toHaveCount(2);
  const lines = await saved.locator('.ag-saved-card-option').allTextContents();
  expect(lines).toHaveLength(2);
  expect(lines[0]).not.toBe(lines[1]);
  for (const line of lines) expect(line).toMatch(/miles/);
  const opens = await saved.getByRole('link', { name: /^Open saved results: / }).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  expect(new Set(opens).size).toBe(2);
  const deletes = await saved.getByRole('button', { name: /^Delete saved results: / }).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  expect(new Set(deletes).size).toBe(2);
});
