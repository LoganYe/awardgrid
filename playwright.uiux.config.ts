/**
 * UI/UX v1 browser tests (docs/uiux-v1). Separate from playwright.config.ts on purpose:
 *
 *   - It drives the iOS shell through a test-only fixture host (apps/ios/fixture-host), served by Vite on
 *     127.0.0.1:4310 — never :3000 (production), :3400/:3999 (web e2e) or :4597/:4599 (Simulator probes).
 *   - It never builds or starts the Next app, so it cannot touch the repository's `.next`, which production
 *     serves (DECISIONS.md #67, docs/uiux-v1/DECISIONS.md U-003).
 *   - It writes nothing under docs/screenshots/v0.2. Evidence screenshots (helpers.ts evidenceShot) are written
 *     only with UIUX_EVIDENCE=1, into docs/uiux-v1/evidence/screens/.
 *
 *   pnpm exec playwright test --config=playwright.uiux.config.ts
 *
 * A browser test here is not native verification: it does not exercise CapacitorHttp, the Keychain,
 * the keyboard or VoiceOver. The Simulator and devices are reported separately.
 */
import { defineConfig } from "@playwright/test";

export const FIXTURE_PORT = Number(process.env.UIUX_FIXTURE_PORT ?? 4310);
export const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;

/** 390×844 at 2×, the reference artboard (docs/reference-geometry.json). */
const IOS = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } as const;

export default defineConfig({
  testDir: "e2e/uiux",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { outputFolder: "e2e-report/uiux", open: "never" }]],
  outputDir: "test-results/uiux",
  expect: { timeout: 10_000 },
  use: {
    baseURL: FIXTURE_URL,
    locale: "en-US",
    // Not UTC on purpose: a query date must not shift with the device's zone (docs/02 D06), and a
    // negative offset is where a midnight-UTC date turns into the previous day.
    timezoneId: "America/Los_Angeles",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Backstop under e2e/uiux/test.ts's routing: anything routing cannot see goes to a dead proxy, not the internet.
    proxy: { server: "http://127.0.0.1:9", bypass: "127.0.0.1,localhost" },
  },
  projects: [{ name: "ios", use: { ...IOS } }],
  webServer: {
    command: `pnpm --filter @awardgrid/ios exec vite --config vite.fixture.config.ts --host 127.0.0.1 --port ${FIXTURE_PORT} --strictPort`,
    url: `${FIXTURE_URL}/`,
    timeout: 60_000,
    // Never test whatever happens to be listening (a stale host, another checkout's): --strictPort fails loudly.
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
