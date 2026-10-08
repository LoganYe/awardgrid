/**
 * What the fixture host exposes to Playwright on `window.__uiuxFixture`. Types only, so the e2e helpers can
 * import it without pulling host code into the Node side.
 *
 * TEST-ONLY. Nothing under apps/ios/fixture-host is reachable from src/main.tsx, and the production build
 * fails if its markers appear in dist (apps/ios/scripts/check-fixture-free-bundle.mjs).
 */

/** Counts of what the app's injected ports saw. Paths only: no header, key or body is ever recorded. */
export interface FixtureRequestLog {
  /** Requests handed to the synthetic seats.aero transport, Get Trips included. */
  seats: number;
  /** The Get Trips subset of `seats` (each one is a paid call in production). Not counted twice. */
  trips: number;
  /** Requests handed to the Anthropic transport. The default fake refuses every one. */
  anthropic: number;
  /** Mutations (writes and removals) through the injected file store, launch-time saves included. */
  writes: number;
  /** `METHOD endpoint-path` per seats.aero request, for readable failures. */
  seatsPaths: string[];
  /**
   * Attempts to reach seats.aero / Anthropic through the WebView's own fetch, which the fetch guard refused
   * before anything was sent. Always a wiring bug; counted so a test can see it rather than it vanishing.
   */
  directSeats: number;
  directAnthropic: number;
  /**
   * T15, only with the scripted Anthropic (`ai=1`): per request, what context its question carried, read from the
   * request's own last user turn: whether a search went, which attached results (R1…), how many earlier questions
   * the history resent, and whether partial coverage was said. A shape, never the text, the key or a header.
   */
  anthropicContext: FixtureAnthropicContext[];
  /**
   * The App Store flavour (OAuth, `UIUX_STORE=1`): seats.aero's consent pages the sign-in sheet opened, and calls to
   * the token service (code exchanges, refreshes). Counts only: no code, state or token is recorded. Zero in the
   * key flavour.
   */
  oauth: { consent: number; token: number; refresh: number };
}

export interface FixtureAnthropicContext {
  search: boolean;
  attached: string[];
  earlier: number;
  partial: boolean;
}

export type FixtureHostState = "booting" | "ready" | "error";

export interface FixtureHostHandle {
  scenario: string | null;
  /** The language the test asked for. Recorded only: the shell renders English until i18n reaches it (T07/T11). */
  requestedLang: string | null;
  state: FixtureHostState;
  error: string | null;
  log: FixtureRequestLog;
  /**
   * Run the shown search again, from outside the page — as a search that finishes while the user is elsewhere in the
   * screen would arrive (T09: the matrix keeps its focus across a new snapshot). Absent until the app is ready.
   */
  rerunShown?: () => Promise<void>;
}

declare global {
  interface Window {
    __uiuxFixture?: FixtureHostHandle;
  }
}
