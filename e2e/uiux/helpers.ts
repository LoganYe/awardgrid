/**
 * Helpers for the UI/UX v1 browser tests (playwright.uiux.config.ts). These drive the real app through an
 * explicit, test-only fixture host; they never talk to seats.aero, Anthropic or any other outside host.
 *
 *   openScenario(page, id, surface = "ios", options?)  open the host on a seeded scenario from scenarios.json
 *   requestLog(page)                                    what the app tried to send since that launch
 *   externalRequests(page)                              every non-loopback request the browser attempted (aborted)
 *   evidenceShot(page, name)                            a screenshot into docs/uiux-v1/evidence (UIUX_EVIDENCE=1)
 *
 * openScenario/requestLog signatures are fixed by plan 01 T01; later tasks may only extend them compatibly.
 * Network lockdown is installed per browser context by the `test` in ./test.ts, so it covers every page and
 * popup, and every test ends by asserting nothing left the machine.
 */
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import type { FixtureRequestLog } from "../../apps/ios/fixture-host/protocol";
import scenarios from "../../packages/core/test/fixtures/uiux/scenarios.json" with { type: "json" };

export type Surface = "ios" | "web";

export interface ScenarioOptions {
  /** Emulated system appearance. The iOS shell follows the system, so this is the real mechanism, not a flag. */
  theme?: "light" | "dark";
  /**
   * Language asked of the host. Recorded on #fixture-status (data-lang) only: the shell renders English until
   * i18n reaches it (T07/T11), and labelling English text as Chinese would mislead screen readers and axe.
   */
  lang?: "zh" | "en";
  /**
   * Keep the host's fixture file namespace from the previous launch (a relaunch). By default that namespace is
   * emptied. Only storage is kept; the scenario's keys and transports are re-applied as on a real launch.
   */
  preserveStorage?: boolean;
}

export interface RequestCounts {
  seats: number;
  anthropic: number;
  /** A subset of `seats`, never added to it. */
  trips: number;
  /** Mutations (writes and removals) through the app's file store since this launch, launch-time saves included. */
  writes: number;
}

const scenarioIds = new Set(scenarios.scenarios.map((item) => item.id));
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** seats.aero or anthropic.com, any subdomain, http or https. Kept for spec-level request listeners. */
export const realHostPattern = /^(https?|wss?):\/\/([^/@]*@)?([^/]*\.)?(seats\.aero|anthropic\.com)\.?(:\d+)?(\/|$)/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

const isHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

interface Lockdown {
  /** Every blocked request in this context, for the end-of-test check. */
  all: string[];
  /** Blocked since the last openScenario, for requestLog. */
  sinceLaunch: string[];
}

const lockdowns = new WeakMap<BrowserContext, Lockdown>();

/**
 * Abort and record every request from this context that is not to loopback: pages, popups, workers, fetch, XHR,
 * images and WebSockets alike. Installed once per context by ./test.ts. The config's dead proxy is the backstop
 * for anything routing cannot see.
 */
export async function lockDownNetwork(context: BrowserContext): Promise<void> {
  if (lockdowns.has(context)) return;
  const lockdown: Lockdown = { all: [], sinceLaunch: [] };
  lockdowns.set(context, lockdown);
  const external = (url: URL) => !LOOPBACK.has(url.hostname.toLowerCase());
  await context.route(external, async (route) => {
    lockdown.all.push(route.request().url());
    lockdown.sinceLaunch.push(route.request().url());
    await route.abort("blockedbyclient");
  });
  await context.routeWebSocket(external, (ws) => {
    lockdown.all.push(ws.url());
    lockdown.sinceLaunch.push(ws.url());
    void ws.close();
  });
}

function lockdownFor(page: Page): Lockdown {
  const lockdown = lockdowns.get(page.context());
  if (!lockdown) throw new Error("Network lockdown is not installed; import { test } from './test' in UI/UX specs.");
  return lockdown;
}

/** Every non-loopback request this test's browser context attempted. All of them were aborted. */
export function externalRequests(page: Page): string[] {
  return [...lockdownFor(page).all];
}

/** Return and forget the recorded external requests. Only for a test that provokes one on purpose. */
export function takeExternalRequests(page: Page): string[] {
  const lockdown = lockdownFor(page);
  const taken = [...lockdown.all];
  lockdown.all.length = 0;
  lockdown.sinceLaunch.length = 0;
  return taken;
}

export async function openScenario(page: Page, id: string, surface: Surface = "ios", options: ScenarioOptions = {}): Promise<void> {
  // This guard belongs in the test helper; the helper is excluded from production.
  if (!scenarioIds.has(id)) throw new Error(`Unknown synthetic scenario: ${id}`);
  if (surface !== "ios") {
    // The web surface needs its own isolated server and user namespaces (plan 04 T18). Refusing is better
    // than quietly opening the iOS host under a web test's name.
    throw new Error(`Surface "${surface}" is not wired yet; plan 04 T18 adds it.`);
  }
  lockdownFor(page).sinceLaunch.length = 0;
  await page.emulateMedia({ colorScheme: options.theme ?? "light" });
  const params = new URLSearchParams({ scenario: id });
  if (options.lang) params.set("lang", options.lang);
  if (options.preserveStorage) params.set("preserve", "1");
  await page.goto(`/?${params.toString()}`);
  await page.waitForFunction(() => document.getElementById("fixture-status")?.dataset.state !== "booting", null, {
    timeout: 15_000,
  });
  const state = await page.evaluate(() => ({
    state: document.getElementById("fixture-status")?.dataset.state,
    error: window.__uiuxFixture?.error ?? null,
  }));
  if (state.state !== "ready") throw new Error(`The fixture host did not start "${id}": ${state.error ?? state.state}`);
}

export async function requestLog(page: Page): Promise<RequestCounts> {
  const log: FixtureRequestLog | null = await page.evaluate(() => window.__uiuxFixture?.log ?? null);
  if (!log) throw new Error("The fixture host is not loaded on this page.");
  const leaked = lockdownFor(page).sinceLaunch;
  const leakedSeats = leaked.filter((url) => isHost(hostOf(url), "seats.aero"));
  const leakedAnthropic = leaked.filter((url) => isHost(hostOf(url), "anthropic.com"));
  const leakedTrips = leakedSeats.filter((url) => /\/partnerapi\/trips\//i.test(url));
  return {
    seats: log.seats + log.directSeats + leakedSeats.length,
    anthropic: log.anthropic + log.directAnthropic + leakedAnthropic.length,
    trips: log.trips + leakedTrips.length,
    writes: log.writes,
  };
}

export const EVIDENCE_DIR = path.resolve(import.meta.dirname, "..", "..", "docs", "uiux-v1", "evidence", "screens");

/**
 * Save a screenshot of the real app as evidence, only when UIUX_EVIDENCE=1 (so routine runs leave tracked files
 * alone). Never a copy of a reference image. Returns the path written, or null.
 */
export async function evidenceShot(page: Page, name: string): Promise<string | null> {
  if (process.env.UIUX_EVIDENCE !== "1") return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`Evidence name must be kebab-case: ${name}`);
  const file = path.join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
  return file;
}
