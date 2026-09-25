/**
 * T21: the actual product at the sizes and text scales A35 names, for the eye (plan 04 T21: "screenshots come from
 * the actual product or an explicit fixture shell, never the design pictures"). Each is also held to the layout audit,
 * so a picture never stands in for a check. Written to docs/uiux-v1/evidence/screens/ only with UIUX_EVIDENCE=1.
 *
 * Environment: Chromium (Playwright's bundled build) on macOS, device scale 2 in the `ios` project; the fixture
 * clock 2026-10-18T08:30Z; synthetic rows only. Not pixel baselines: the Linux baselines stay CI's (U-055).
 */
import { WITH_WEB } from '../../playwright.uiux.config';
import { auditLayout } from './layout-audit';
import { evidenceShot, openScenario, setTextScale } from './helpers';
import { expect, test } from './test';

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: iOS results at 320 and 390, 200% text, Chinese`, async ({ page }) => {
    await openScenario(page, 'long-labels', 'ios', { lang: 'zh', theme });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await setTextScale(page, 2);
      await expect(page.getByText('75,000').first()).toBeVisible();
      expect(await auditLayout(page)).toEqual({ overflowX: 0, clipped: [], overlaps: [] });
      await evidenceShot(page, `t21-ios-results-${width}-200-${theme}`);
    }
  });

  test(`${theme}: Web workspace at 390 and 768, 200% text, Chinese`, async ({ page }) => {
    test.skip(!WITH_WEB, 'UIUX_WEB=0: the Web surface is not started in this run');
    await openScenario(page, 'long-labels', 'web', { lang: 'zh', theme });
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-run', 'finished');
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await setTextScale(page, 2);
      await expect(page.getByText('75,000').first()).toBeVisible();
      expect(await auditLayout(page)).toEqual({ overflowX: 0, clipped: [], overlaps: [] });
      if (width === 390) {
        // Seen in this evidence before the fix: "查看选/项" broken mid-word beside its neighbour, and a bar twice as tall as
        // its 13-px labels need. A button whose words fit the line keeps them on one; the bar keeps its 56.
        const lines = await page.locator('.ag-web-option-actions .ag-web-button').evaluateAll((els) =>
          els.map((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
          }),
        );
        expect(lines.length).toBeGreaterThan(0);
        expect(lines).toEqual(lines.map(() => 1));
        expect(await page.locator('.ag-ws-rail').evaluate((el) => el.getBoundingClientRect().height)).toBe(56);
      }
      await evidenceShot(page, `t21-web-workspace-${width}-200-${theme}`, { fullPage: width === 390 });
    }
  });
}
