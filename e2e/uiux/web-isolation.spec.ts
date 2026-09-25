/**
 * T18: Web ports and account isolation (plan 04 T18; acceptance A30).
 *
 * Two accounts on one browser: what the first saved, selected or asked stays theirs. The second never sees it, and
 * the test never empties the browser's storage to make that true.
 */
// The harness's own test (./test): its network lockdown is what openScenario requires (T01).
import availability from '../../packages/core/test/fixtures/uiux/availability-rows.json' with { type: 'json' };
import { WEB_URL } from '../../playwright.uiux.config';
import { evidenceShot, openScenario, webRequestLog } from './helpers';
import { expect, test } from './test';
test('switching users does not reveal prior saved snapshots', async ({ page }) => {
  await openScenario(page, 'web-user-a', 'web', { lang: 'zh' });
  await page.getByRole('button', { name: '收藏选项', exact: true }).first().click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await openScenario(page, 'web-user-b', 'web', { lang: 'zh', preserveStorage: true });
  await page.getByRole('link', { name: '收藏', exact: true }).click();
  await expect(page.getByTestId('favorite-card')).toHaveCount(0);
});


/** The browser's storage keys, parsed: [store, account, name]. */
const storedKeys = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    Object.keys(localStorage).flatMap((key) => {
      try {
        const parsed = JSON.parse(key) as unknown;
        return Array.isArray(parsed) ? [parsed as string[]] : [];
      } catch {
        return [];
      }
    }),
  );

test('each account searches with its own key; its saved options stay its own; its workspace and conversation leave the browser at logout (A30)', async ({ page }) => {
  await openScenario(page, 'web-user-a', 'web', { lang: 'en' });
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
  const aRows = await page.getByTestId('availability-list').locator('[data-row-key]').evaluateAll((els) => els.map((el) => el.getAttribute('data-row-key')));
  await page.getByRole('button', { name: 'Save option' }).first().click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true }).first()).toBeDisabled();
  // Nothing went out under B's key while A searched (A's own may be served from A's cache on the server).
  expect((await webRequestLog(page, 'web-user-b')).seats).toBe(0);
  // A has a workspace and a saved option on this browser, and (say) a conversation.
  expect((await storedKeys(page)).map((k) => k[0])).toEqual(expect.arrayContaining(['awardgrid-workspace-v1', 'awardgrid-favorites-v1']));
  await page.evaluate(() => sessionStorage.setItem('awardgrid.ask.history', '[{"q":"A private question"}]'));

  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  // Results and conversation left the browser; A's saved option stayed, under A's key.
  const afterLogout = await storedKeys(page);
  expect(afterLogout.filter((k) => k[0] === 'awardgrid-workspace-v1')).toEqual([]);
  expect(afterLogout.filter((k) => k[0] === 'awardgrid-favorites-v1')).toHaveLength(1);
  expect(await page.evaluate(() => sessionStorage.getItem('awardgrid.ask.history'))).toBeNull();

  // B on the same browser: its own search, its own rows, and none of A's saved options.
  await openScenario(page, 'web-user-b', 'web', { lang: 'en', preserveStorage: true });
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
  // The same search, B's own rows: the server's cache and the stand-in's answer are per account (a shared cache would
  // have served A's rows for this very scope).
  const bRows = await page.getByTestId('availability-list').locator('[data-row-key]').evaluateAll((els) => els.map((el) => el.getAttribute('data-row-key')));
  expect(bRows).not.toEqual(aRows);
  await page.getByRole('link', { name: 'Saved', exact: true }).click();
  await expect(page.getByTestId('favorite-card')).toHaveCount(0);
  await expect(page.getByText('Nothing saved yet.')).toBeVisible();

  // A again: A's saved option is still A's.
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await openScenario(page, 'web-user-a', 'web', { lang: 'en', preserveStorage: true });
  await page.getByRole('link', { name: 'Saved', exact: true }).click();
  await expect(page.getByTestId('favorite-card')).toHaveCount(1);
});

/**
 * T18 review REG-1: a search still in flight at logout. The request reaches the server; its answer is held until the
 * account has signed out, then released. Nothing of that account's may come back onto the browser.
 */
async function holdFind(page: import('@playwright/test').Page) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let answered!: () => void;
  const done = new Promise<void>((resolve) => (answered = resolve));
  await page.route(`${WEB_URL}/api/find`, async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
    answered();
  });
  return { release, done };
}

const workspaceKeys = async (page: import('@playwright/test').Page) => (await storedKeys(page)).filter((k) => k[0] === 'awardgrid-workspace-v1');

test('an answer that lands after Log out leaves nothing of the account on the browser (A30)', async ({ page }) => {
  const find = await holdFind(page);
  await openScenario(page, 'web-user-a', 'web', { lang: 'en' });
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'running');
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await workspaceKeys(page)).toEqual([]);
  find.release();
  await find.done;
  // The answer is in the page now; give its handling time to write, if it were going to.
  await page.waitForTimeout(1500);
  expect(await workspaceKeys(page)).toEqual([]);
});

test('an answer that lands after logging out everywhere leaves nothing either (A30)', async ({ page }) => {
  const find = await holdFind(page);
  await openScenario(page, 'web-user-a', 'web', { lang: 'en' });
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'running');
  // Away from the workspace (its store's search still pending), to Settings, and out everywhere.
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByTestId('logout-all').click();
  await page.getByTestId('logout-all-confirm').getByRole('button', { name: 'Log out everywhere', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  find.release();
  await find.done;
  await page.waitForTimeout(1500);
  expect(await workspaceKeys(page)).toEqual([]);
});

test('the header quota follows a workspace search at once, as the server counts it', async ({ page }) => {
  // An account no other test here searches with: its first search is cold, so it spends a call.
  await openScenario(page, 'complete', 'web', { lang: 'en' });
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
  const usage = (await (await page.request.get(`${WEB_URL}/api/usage`)).json()) as { seats_aero: { used: number } };
  expect(usage.seats_aero.used).toBeGreaterThan(0);
  await expect(page.getByTestId('quota-indicator')).toHaveAttribute('aria-label', new RegExp(`calls today: ${usage.seats_aero.used} of `));
});

test('the server never sends a key to the browser; the legacy /api/find answer keeps its fields (A30)', async ({ page }) => {
  await openScenario(page, 'web-user-a', 'web', { lang: 'en' });
  const q = Buffer.from(JSON.stringify(availability.query), 'utf8').toString('base64url');
  const html = await (await page.request.get(`${WEB_URL}/workspace?q=${q}`)).text();
  expect(html).not.toContain('uiux-web-user-a');
  expect(html).not.toMatch(/e{64}/);
  const find = await page.request.post(`${WEB_URL}/api/find`, { data: { query: availability.query }, headers: { Origin: WEB_URL } });
  expect(find.ok()).toBe(true);
  const body = (await find.json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(expect.arrayContaining(['grid', 'warnings', 'notices', 'quota', 'dynamic_rows_available', 'programs_failed', 'programs_by_pair', 'programs_checked', 'rows', 'coverage']));
  expect(JSON.stringify(body)).not.toContain('uiux-web-user-a');
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: the Web workspace and Saved in Chinese at 390`, async ({ page }) => {
    await openScenario(page, 'web-user-a', 'web', { theme, lang: 'zh' });
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
    await page.getByRole('button', { name: '收藏选项', exact: true }).first().click();
    await evidenceShot(page, `t18-web-workspace-${theme}`, { fullPage: true });
    await page.getByRole('link', { name: '收藏', exact: true }).click();
    await expect(page.getByTestId('favorite-card')).toHaveCount(1);
    await evidenceShot(page, `t18-web-saved-${theme}`, { fullPage: true });
  });
}
