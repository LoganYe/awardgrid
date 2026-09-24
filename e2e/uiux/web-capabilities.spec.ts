/**
 * T20: the Web's watch capabilities and its shared consumers (plan 04 T20; A33, A34).
 *
 * The /queries page says what this server can really do, from real signals: a worker's heartbeat beside the database
 * (written here to stand in for one), the server's Telegram token, the account's link. How the last run went is its
 * own line. Settings no longer says alerts reach Telegram on a server with no bot. And ordinary search on the grid
 * never lets the language model read the text unless the person asks, as its own action.
 */
// The harness's own test (./test): its network lockdown is what openScenario requires (T01).
import { rmSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { WEB_URL } from "../../playwright.uiux.config";
import scenarios from "../../packages/core/test/fixtures/uiux/scenarios.json" with { type: "json" };
import { evidenceShot, openScenario, webDatabasePath, webHeartbeatFile } from "./helpers";
import { expect, test } from "./test";

const NOW = Date.parse(process.env.UIUX_WEB_NOW || scenarios.now);
const beat = (minutesAgo: number, ok = true) =>
  writeFileSync(webHeartbeatFile(), JSON.stringify({ version: 1, tickAt: new Date(NOW - minutesAgo * 60_000).toISOString(), ok, transport: "mock" }));

test.afterEach(() => {
  rmSync(webHeartbeatFile(), { force: true });
});

test.describe('/queries says what this server can do (A33)', () => {
  test('no worker has ticked: nothing is confirmed, and whether checks run is unknown', async ({ page }) => {
    rmSync(webHeartbeatFile(), { force: true });
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await page.goto(`${WEB_URL}/queries`);
    const block = page.getByTestId('watch-capability');
    await expect(block).toHaveAttribute('data-capability', 'watch.unavailable');
    await expect(block).toHaveAttribute('data-health', 'unknown');
    await expect(block).toContainText('No active checking capability has been confirmed.');
    await expect(block).toContainText('No scheduled run is recorded on this server, so whether checks run is not known.');
  });

  test('a worker that ticked a minute ago, on the mock transport: scheduled, push not enabled, last run said', async ({ page }) => {
    beat(1);
    await openScenario(page, 'complete', 'web', { lang: 'zh' });
    await page.goto(`${WEB_URL}/queries`);
    const block = page.getByTestId('watch-capability');
    await expect(block).toHaveAttribute('data-capability', 'watch.scheduled_only');
    await expect(block).toHaveAttribute('data-health', 'ok');
    await expect(block).toContainText('已配置定期检查，未启用消息发送。');
    await expect(block).toContainText('调度最近一次运行：');
  });

  test('configured is never "ran": a heartbeat an hour old reads as stopped, a failed tick as failed', async ({ page }) => {
    beat(60);
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    await page.goto(`${WEB_URL}/queries`);
    await expect(page.getByTestId('watch-capability')).toHaveAttribute('data-health', 'stale');
    await expect(page.getByTestId('watch-capability')).toContainText('has not run since. Scheduled checks may have stopped.');
    beat(1, false);
    await page.reload();
    await expect(page.getByTestId('watch-capability')).toHaveAttribute('data-health', 'failed');
    await expect(page.getByTestId('watch-capability')).toContainText("The scheduler's last run");
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: evidence of /queries in Chinese at 390`, async ({ page }) => {
      beat(1);
      await openScenario(page, 'complete', 'web', { lang: 'zh', theme });
      await page.goto(`${WEB_URL}/queries`);
      await expect(page.getByTestId('watch-capability')).toBeVisible();
      await evidenceShot(page, `t20-web-queries-${theme}`);
    });
  }
});

test.describe('settings: alerts are said to reach Telegram only where they do (A33)', () => {
  test('a linked account on a server with no bot is told its alerts are only logged', async ({ page }) => {
    const db = new Database(webDatabasePath());
    try {
      db.prepare('update users set telegram_chat_id = ? where username = ?').run('1000001', 'complete');
      await openScenario(page, 'complete', 'web', { lang: 'en' });
      await page.goto(`${WEB_URL}/settings`);
      await expect(page.locator('[data-telegram-mock-explain]')).toBeVisible();
      await expect(page.getByText('Alerts go to your Telegram chat.')).toHaveCount(0);
    } finally {
      db.prepare('update users set telegram_chat_id = null where username = ?').run('complete');
      db.close();
    }
  });
});

test.describe('the grid: the language model reads a text only when asked (product rule: no AI in ordinary search)', () => {
  const offer = { error: 'parse', missing: ['origins', 'destinations'], message: 'Could not read the places.', llm_offer: true };

  test('an incomplete text says what is missing; the AI offer is a separate action, with its note, and only then is use_llm sent', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    const bodies: Array<Record<string, unknown>> = [];
    await page.route(`${WEB_URL}/api/parse`, async (route) => {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify(offer) });
    });
    await page.goto(`${WEB_URL}/grid`);
    const bar = page.getByRole('textbox').first();
    await bar.fill('somewhere warm over the holidays');
    await bar.press('Enter');
    await expect(page.getByTestId('parse-failure')).toBeVisible();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.use_llm).toBeUndefined();
    await expect(page.getByText("This sends the text above to Anthropic, on this server's key. Nothing is sent until you choose it.")).toBeVisible();
    await page.getByTestId('parse-with-ai').click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toMatchObject({ text: 'somewhere warm over the holidays', use_llm: true });
  });

  test('review AI-1: once the bar says something else, the offer is withdrawn; nothing deleted is ever sent', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'en' });
    const bodies: Array<Record<string, unknown>> = [];
    await page.route(`${WEB_URL}/api/parse`, async (route) => {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify(offer) });
    });
    await page.goto(`${WEB_URL}/grid`);
    const bar = page.getByRole('textbox').first();
    await bar.fill('Jane Doe, ref ABC123, somewhere warm');
    await bar.press('Enter');
    await expect(page.getByTestId('parse-with-ai')).toBeVisible();
    await bar.fill('somewhere warm');
    await expect(page.getByTestId('parse-with-ai')).toHaveCount(0);
    // Back to the very text that failed: the offer is about it again.
    await bar.fill('Jane Doe, ref ABC123, somewhere warm');
    await expect(page.getByTestId('parse-with-ai')).toBeVisible();
    await bar.fill('somewhere warm');
    await bar.press('Enter');
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies.every((b) => b.use_llm === undefined)).toBe(true);
    await page.getByTestId('parse-with-ai').click();
    await expect.poll(() => bodies.length).toBe(3);
    expect(bodies[2]).toMatchObject({ text: 'somewhere warm', use_llm: true });
  });

  test('without the offer (no server key), there is no AI action at all', async ({ page }) => {
    await openScenario(page, 'complete', 'web', { lang: 'zh' });
    await page.goto(`${WEB_URL}/grid`);
    const bar = page.getByRole('textbox').first();
    await bar.fill('somewhere warm over the holidays');
    await bar.press('Enter');
    await expect(page.getByTestId('parse-failure')).toBeVisible();
    await expect(page.getByTestId('parse-with-ai')).toHaveCount(0);
  });
});
