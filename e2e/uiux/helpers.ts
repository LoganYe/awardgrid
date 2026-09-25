/**
 * Helpers for the UI/UX v1 browser tests (playwright.uiux.config.ts). These drive the real app through an
 * explicit, test-only fixture host; they never talk to seats.aero, Anthropic or any other outside host.
 *
 *   openScenario(page, id, surface = "ios", options?)  open the host on a seeded scenario from scenarios.json
 *   requestLog(page)                                    what the app tried to send since that launch
 *   externalRequests(page)                              every non-loopback request the browser attempted (aborted)
 *   evidenceShot(page, name, {fullPage})                a screenshot into docs/uiux-v1/evidence (UIUX_EVIDENCE=1)
 *
 * openScenario/requestLog signatures are fixed by plan 01 T01; later tasks may only extend them compatibly.
 * Network lockdown is installed per browser context by the `test` in ./test.ts, so it covers every page and
 * popup, and every test ends by asserting nothing left the machine.
 */
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import type { FixtureRequestLog } from "../../apps/ios/fixture-host/protocol";
import scenarios from "../../packages/core/test/fixtures/uiux/scenarios.json" with { type: "json" };
import availability from "../../packages/core/test/fixtures/uiux/availability-rows.json" with { type: "json" };
import { UIUX_WEB_PASSWORD, WEB_SCENARIOS } from "../../scripts/uiux-web/accounts";
import { WEB_MOCK_URL, WEB_URL, WITH_WEB } from "../../playwright.uiux.config";

export type Surface = "ios" | "web";

export interface ScenarioOptions {
  /** Emulated system appearance. The iOS shell follows the system, so this is the real mechanism, not a flag. */
  theme?: "light" | "dark";
  /**
   * Language asked of the host, recorded on #fixture-status (data-lang) and passed to the app as its locale: the
   * translated screens (results and tab bar since T07, U-026) speak it; the others stay English until T11.
   */
  lang?: "zh" | "en";
  /**
   * Keep the host's fixture file namespace from the previous launch (a relaunch). By default that namespace is
   * emptied. Only storage is kept; the scenario's keys and transports are re-applied as on a real launch.
   */
  preserveStorage?: boolean;
  /**
   * T15: give the app an Anthropic key and the host's scripted Anthropic, which answers one synthetic text and records
   * each question's context shape (`anthropicContexts`). Without it, every Anthropic request is refused and counted.
   */
  ai?: boolean;
  /**
   * Release D10: with an Anthropic key the host starts with Ask's permission already given, so Ask specs test Ask.
   * `false` leaves it out, and the consent sheet comes first.
   */
  consent?: false;
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
  lockdownFor(page).sinceLaunch.length = 0;
  if (surface === "web") return openWebScenario(page, id, options);
  await page.emulateMedia({ colorScheme: options.theme ?? "light" });
  const params = new URLSearchParams({ scenario: id });
  if (options.lang) params.set("lang", options.lang);
  if (options.preserveStorage) params.set("preserve", "1");
  if (options.ai) params.set("ai", "1");
  if (options.consent === false) params.set("consent", "0");
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

/**
 * T18: the Web surface. The real Next app of this worktree (playwright.uiux.config.ts), signed in as the scenario's
 * own account through the app's login route, on the fixture's clock, then on the workspace with the scenario's search.
 * Without `preserveStorage` the browser's cookies and storage for the app are emptied first (a fresh device); with it,
 * what the last account left in the browser stays, which is what an isolation test must survive, never clear.
 */
async function openWebScenario(page: Page, id: string, options: ScenarioOptions): Promise<void> {
  if (!WITH_WEB) throw new Error("UIUX_WEB=0: the Web surface is not started in this run (playwright.uiux.config.ts).");
  if (!(WEB_SCENARIOS as readonly string[]).includes(id)) throw new Error(`Scenario "${id}" has no Web account (scripts/uiux-web/accounts.ts).`);
  const context = page.context();
  if (!clocked.has(page)) {
    // The server runs on the fixture's clock (e2e/uiux/web-clock.mjs); the browser starts from the same time.
    await page.clock.install({ time: new Date(WEB_NOW) });
    clocked.add(page);
  }
  if (!options.preserveStorage) {
    // A fresh device: the stand-in's request log starts again too.
    await page.request.post(`${WEB_MOCK_URL}/__reset`);
    await context.clearCookies();
    await page.goto(`${WEB_URL}/login`);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  }
  await page.emulateMedia({ colorScheme: options.theme ?? "light" });
  await context.addCookies([{ name: "ag_locale", value: options.lang ?? "en", url: WEB_URL }]);
  const login = await page.request.post(`${WEB_URL}/api/auth/login`, { data: { username: id, password: UIUX_WEB_PASSWORD }, headers: { Origin: WEB_URL } });
  if (!login.ok()) throw new Error(`The Web surface did not sign in "${id}": HTTP ${login.status()}`);
  // The session cookie's Expires is set on the server's shifted clock, but the browser judges it on real time: a month
  // after the fixture's "now" it would arrive already expired and be dropped. It is set again, from the response, as a
  // cookie for this browser session; the server still checks the session's own expiry on its clock (T18 review FIX-2).
  const session = login
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => /^ag_session=([^;]*)/.exec(header.value)?.[1])
    .find((value) => value !== undefined);
  if (!session) throw new Error(`The Web surface signed in "${id}" without a session cookie.`);
  await context.addCookies([{ name: "ag_session", value: session, url: WEB_URL, httpOnly: true, sameSite: "Lax" }]);
  // The synthetic search (availability-rows.json, as core's fixtureQuery reads it), as the Web's own ?q= codec.
  const q = Buffer.from(JSON.stringify(availability.query), "utf8").toString("base64url");
  await page.goto(`${WEB_URL}/workspace?q=${q}`);
}

const clocked = new WeakSet<Page>();
/** The Web surface's clock: the fixture's "now", unless UIUX_WEB_NOW moves it (start-web.sh reads the same). */
const WEB_NOW = process.env.UIUX_WEB_NOW || scenarios.now;

/**
 * T20: the Web surface's throwaway database, as start-web.sh names it, and the worker heartbeat file the server reads
 * beside it (src/lib/scheduler/heartbeat.ts). Tests write the heartbeat to stand in for a worker; they never touch a
 * real database.
 */
export function webDatabasePath(): string {
  return path.resolve(process.env.UIUX_WEB_DB ?? path.join(process.env.TMPDIR ?? "/tmp", "awardgrid-uiux-web", `${new URL(WEB_URL).port}.db`));
}
export function webHeartbeatFile(): string {
  return `${webDatabasePath()}.worker-heartbeat.json`;
}

/** T18: what the Web surface's seats.aero stand-in received, for one scenario's account (by its fake key). */
export async function webRequestLog(page: Page, scenario: string): Promise<{ seats: number; trips: number; seatsPaths: string[] }> {
  const response = await page.request.get(`${WEB_MOCK_URL}/__log`);
  const all = (await response.json()) as Record<string, { seats: number; trips: number; seatsPaths: string[] }>;
  return all[scenario] ?? { seats: 0, trips: 0, seatsPaths: [] };
}

/**
 * T21: scale the Quiet Precision type and the containers that follow it (`--ag-text-scale`), on either surface. A test
 * of how the layout answers larger text; it is not the system's Dynamic Type, which only a device shows.
 */
export async function setTextScale(page: Page, scale: number): Promise<void> {
  await page.evaluate((value) => document.documentElement.style.setProperty("--ag-text-scale", String(value)), scale);
}

/** T15: the context shape of each question the scripted Anthropic answered, in order (see FixtureRequestLog). */
export async function anthropicContexts(page: Page): Promise<FixtureRequestLog["anthropicContext"]> {
  return page.evaluate(() => window.__uiuxFixture?.log.anthropicContext ?? []);
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
 * Run a typed search the way a person would (UI/UX v1 T07): from the empty Search screen, or through the query editor
 * when results are shown. Resolves once the search has settled — a new revision finished or failed, or the attempt
 * was refused before it ran (no key, unreadable text) — and the Search screen is no longer busy.
 */
export async function searchByText(page: Page, text: string): Promise<void> {
  const root = page.locator(".ag-results[data-run]");
  await root.waitFor();
  const before = Number(await root.getAttribute("data-revision"));
  if (await page.getByTestId("query-summary").isVisible()) await page.getByTestId("query-summary").getByRole("link").click();
  await page.locator("#q").fill(text);
  // Run, or 查询 on a Chinese screen (T11).
  await page.getByTestId("text-search-run").click();
  await page.waitForFunction(
    (rev) => {
      const refused = document.querySelector("#q-error, .ag-results [role='alert']");
      const el = document.querySelector<HTMLElement>(".ag-results[data-run]");
      if (!el) return Boolean(refused);
      const settled = el.dataset.busy === "false" && el.dataset.run !== "running";
      return settled && (Number(el.dataset.revision) > rev || Boolean(refused));
    },
    before,
    { timeout: 15_000 },
  );
}

/**
 * Save a screenshot of the real app as evidence, only when UIUX_EVIDENCE=1 (so routine runs leave tracked files
 * alone). Never a copy of a reference image. Returns the path written, or null.
 */
export async function evidenceShot(page: Page, name: string, options: { fullPage?: boolean } = {}): Promise<string | null> {
  if (process.env.UIUX_EVIDENCE !== "1") return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`Evidence name must be kebab-case: ${name}`);
  const file = path.join(EVIDENCE_DIR, `${name}.png`);
  // A full-page capture measures the page first: wait until its height has held for two readings 250 ms apart, so a
  // screen that is still filling in (a Keychain read, a store load) is not cut at the height it had a moment ago.
  // Polled from here, not inside waitForFunction, whose predicate cannot usefully return a Promise. The tab chrome
  // scrolls an inner area (.app-main), not the page: its overflow is added to the page's height.
  if (options.fullPage) {
    const height = () =>
      page.evaluate(() => {
        const inner = document.querySelector<HTMLElement>(".app-main");
        const extra = inner ? Math.max(0, inner.scrollHeight - inner.clientHeight) : 0;
        return document.documentElement.scrollHeight + extra;
      });
    let last = await height();
    for (let tries = 0; ; tries++) {
      await page.waitForTimeout(250);
      const now = await height();
      if (now === last) break;
      if (tries >= 20) throw new Error(`evidenceShot(${name}): the page height kept changing (${last} → ${now})`);
      last = now;
    }
  }
  const viewport = page.viewportSize();
  const inner = options.fullPage ? await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".app-main");
    return el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0;
  }) : 0;
  // Grow the viewport by what the inner area hides, capture, and put it back.
  if (viewport && inner > 0) await page.setViewportSize({ width: viewport.width, height: viewport.height + inner });
  await page.screenshot({ path: file, animations: "disabled", fullPage: options.fullPage ?? false });
  if (viewport && inner > 0) await page.setViewportSize(viewport);
  return file;
}

/**
 * A stand-in for the software keyboard: the visual viewport loses `height` at the bottom, as in WKWebView, where the
 * layout viewport does not change. Not a device keyboard: that is left for the Simulator and device runs.
 */
export async function fakeKeyboard(page: Page) {
  await page.addInitScript(() => {
    const target = new EventTarget();
    let covered = 0;
    let panned = 0;
    const fields: Record<string, () => number> = {
      height: () => window.innerHeight - covered,
      width: () => window.innerWidth,
      offsetTop: () => panned,
      offsetLeft: () => 0,
      pageTop: () => window.scrollY,
      pageLeft: () => window.scrollX,
      scale: () => 1,
    };
    const view = new Proxy(target, {
      get(t, key) {
        if (typeof key === "string" && key in fields) return fields[key]!();
        const value = Reflect.get(t, key);
        return typeof value === "function" ? value.bind(t) : value;
      },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => view });
    (window as unknown as { __keyboard: (h: number, pan?: number) => void }).__keyboard = (h: number, pan = 0) => {
      covered = h;
      panned = pan;
      target.dispatchEvent(new Event("resize"));
    };
  });
}
/** Open (or close, with 0) the stand-in keyboard; `pan` is how far WebKit has panned the visible part up to a field. */
export const keyboard = (page: Page, height: number, pan = 0) =>
  page.evaluate(([h, p]) => (window as unknown as { __keyboard: (h: number, pan?: number) => void }).__keyboard(h!, p), [height, pan] as const);
