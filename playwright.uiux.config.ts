/**
 * UI/UX v1 browser tests (docs/uiux-v1). Separate from playwright.config.ts on purpose:
 *
 *   - It drives the iOS shell through a test-only fixture host (apps/ios/fixture-host), served by Vite on
 *     127.0.0.1:4310 — never :3000 (production), :3400/:3999 (web e2e) or :4597/:4599 (Simulator probes).
 *   - Since T18 it also serves the Web surface: this worktree's Next app on 127.0.0.1:4330 (e2e/uiux/start-web.sh,
 *     which refuses to run outside a linked git worktree, so production's `.next` is never touched; U-003, U-053),
 *     a throwaway SQLite file, and the fixture's seats.aero on :4331 (scripts/uiux-web/mock-seatsaero.ts).
 *     UIUX_WEB=0 leaves both out, and the Web specs (e2e/uiux/web-*.spec.ts) with them, for iOS-only runs (the
 *     main checkout); the run says so, and A30 is then not verified by it. UIUX_WEB_NOW moves the Web surface's clock
 *     (server and browser together) off the fixture's "now"; used only to check the harness itself.
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
/** T18: the Web surface (the real Next app, this worktree's build) and its stand-in seats.aero. */
export const WEB_PORT = Number(process.env.UIUX_WEB_PORT ?? 4330);
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
export const WEB_MOCK_PORT = Number(process.env.UIUX_WEB_MOCK_PORT ?? 4331);
export const WEB_MOCK_URL = `http://127.0.0.1:${WEB_MOCK_PORT}`;
export const WITH_WEB = process.env.UIUX_WEB !== "0";
// Said, not silent (U-006): an iOS-only run leaves the Web surface's specs out.
if (!WITH_WEB && !process.env.UIUX_WEB_NOTED) {
  process.env.UIUX_WEB_NOTED = "1";
  console.log("UIUX_WEB=0: the Web surface is not started and e2e/uiux/web-*.spec.ts are not run (A30 is not verified by this run).");
}

/** 390×844 at 2×, the reference artboard (docs/reference-geometry.json). */
const IOS = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } as const;
/** T19: the Web workspace's reference artboard, 1440×900 (docs/04 S10). */
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false } as const;

export default defineConfig({
  testDir: "e2e/uiux",
  testIgnore: WITH_WEB ? undefined : ["**/web-*.spec.ts"],
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
  projects: [
    // A project's testIgnore replaces the config's: the UIUX_WEB=0 exclusion is repeated here (T19 review REG-1).
    { name: "ios", use: { ...IOS }, testIgnore: WITH_WEB ? ["**/web-layout*.spec.ts"] : ["**/web-*.spec.ts"] },
    // T19: the Web professional workspace at desktop sizes with a fine pointer, no touch (spec §17: hit areas follow
    // the pointer, not the width; the coarse-pointer desktop is checked inside the specs with its own context).
    ...(WITH_WEB ? [{ name: "web-desktop", use: { ...DESKTOP }, testMatch: ["**/web-layout*.spec.ts"] }] : []),
  ],
  webServer: [
    {
      command: `pnpm --filter @awardgrid/ios exec vite --config vite.fixture.config.ts --host 127.0.0.1 --port ${FIXTURE_PORT} --strictPort`,
      url: `${FIXTURE_URL}/`,
      timeout: 60_000,
      // Never test whatever happens to be listening (a stale host, another checkout's): --strictPort fails loudly.
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
    },
    ...(WITH_WEB
      ? [
          {
            command: `pnpm exec tsx scripts/uiux-web/mock-seatsaero.ts`,
            url: `${WEB_MOCK_URL}/healthz`,
            timeout: 60_000,
            reuseExistingServer: false,
            env: { UIUX_WEB_MOCK_PORT: String(WEB_MOCK_PORT) },
            stdout: "ignore" as const,
            stderr: "pipe" as const,
          },
          {
            command: `bash e2e/uiux/start-web.sh`,
            url: `${WEB_URL}/login`,
            // A build may run first when the sources are newer than .next.
            timeout: 600_000,
            reuseExistingServer: false,
            env: { UIUX_WEB_PORT: String(WEB_PORT), UIUX_WEB_MOCK_PORT: String(WEB_MOCK_PORT) },
            stdout: "ignore" as const,
            stderr: "pipe" as const,
          },
        ]
      : []),
  ],
});
