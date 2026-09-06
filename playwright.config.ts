/**
 * Playwright e2e + screenshot suite (Phase 6 §9). Everything is offline: the DEMO=1 mock
 * seats.aero server on :3999 and a production `next start` on :3400 over a throwaway SQLite
 * file seeded by scripts/seed-e2e.ts (fake users, fake keys, no network, no real data).
 *
 *   pnpm build && pnpm e2e            # full run
 *   pnpm e2e -g before                # "before" screenshots only
 *   pnpm e2e:update                   # refresh toHaveScreenshot baselines (reason in the commit)
 *
 * See e2e/README.md for the temp-DB / user design and the Linux-baseline plan.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";

const isCI = !!process.env.CI;
const root = import.meta.dirname;

export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3400);
export const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 3999);
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;
export const MOCK_BASE_URL = `http://127.0.0.1:${MOCK_PORT}/partnerapi/`;
/** Throwaway SQLite file; e2e/start-app.sh recreates it on every start. Override with E2E_DB_PATH. */
export const E2E_DB_PATH = process.env.E2E_DB_PATH ?? path.join(os.tmpdir(), "awardgrid-e2e", "e2e.db");
/** Test-only master key: 64 hex chars, deliberately trivial (it only ever protects fake keys). */
export const E2E_MASTER_KEY = "e".repeat(64);

const built = existsSync(path.join(root, ".next", "BUILD_ID"));

const DESKTOP = { viewport: { width: 1440, height: 900 } } as const;
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

/**
 * `toHaveScreenshot` baselines (e2e/visual.spec.ts) are generated on Linux CI and carry no
 * platform suffix, so on any other machine they would fail on font rasterisation alone — and on a
 * fresh clone they may not exist at all. Off by default, so a routine `pnpm e2e` never fails on
 * them; the `visual` CI job and anyone comparing deliberately set VISUAL=1:
 *
 *     VISUAL=1 pnpm e2e -g visual           # compare
 *     VISUAL=1 pnpm e2e:update -g visual    # rewrite the baselines (reason in the commit message)
 */
const ignoreSnapshots = process.env.VISUAL !== "1";

/** Environment for the production app process. Nothing here is a real secret. */
export const appEnv: Record<string, string> = {
  E2E_DB_PATH,
  E2E_APP_PORT: String(APP_PORT),
  DATABASE_PATH: E2E_DB_PATH,
  MASTER_KEY: E2E_MASTER_KEY,
  SEATS_AERO_BASE_URL: MOCK_BASE_URL,
  APP_URL,
  COOKIE_SECURE: "false",
  NODE_ENV: "production",
  // The ask lane must show its "not configured" state; an empty value beats any .env file (Next
  // never overrides a variable that is already defined in the process environment).
  ANTHROPIC_API_KEY: "",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_BOT_USERNAME: "",
  TZ: "UTC",
};

const webServer: NonNullable<PlaywrightTestConfig["webServer"]> = [
  {
    command: `DEMO=1 MOCK_SEATS_PORT=${MOCK_PORT} pnpm exec tsx scripts/mock-seatsaero.ts`,
    url: `http://127.0.0.1:${MOCK_PORT}/healthz`,
    timeout: 30_000,
    reuseExistingServer: !isCI,
    stdout: "ignore",
    stderr: "pipe",
  },
  {
    command: "bash e2e/start-app.sh",
    url: `${APP_URL}/login`,
    // webServers start BEFORE globalSetup, so start-app.sh is what actually builds when
    // .next/BUILD_ID is missing; give it room for `next build` in that case.
    timeout: built ? 180_000 : 600_000,
    reuseExistingServer: !isCI,
    env: appEnv,
    stdout: "pipe",
    stderr: "pipe",
  },
];

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One SQLite file and one app process: never run tests in parallel.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 90_000,
  reporter: [["list"], ["html", { outputFolder: "e2e-report", open: "never" }]],
  outputDir: "test-results",
  // No platform suffix: baselines are generated on Linux CI (e2e/README.md).
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}",
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
  use: {
    baseURL: APP_URL,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    deviceScaleFactor: 1,
  },
  projects: [
    { name: "desktop-light", ignoreSnapshots, use: { ...DESKTOP, colorScheme: "light" } },
    { name: "desktop-dark", ignoreSnapshots, use: { ...DESKTOP, colorScheme: "dark" } },
    { name: "mobile-light", ignoreSnapshots, use: { ...MOBILE, colorScheme: "light" } },
    { name: "mobile-dark", ignoreSnapshots, use: { ...MOBILE, colorScheme: "dark" } },
  ],
  webServer,
});
