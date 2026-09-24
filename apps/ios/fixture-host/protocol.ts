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
}

export type FixtureHostState = "booting" | "ready" | "error";

export interface FixtureHostHandle {
  scenario: string | null;
  /** The language the test asked for. Recorded only: the shell renders English until i18n reaches it (T07/T11). */
  requestedLang: string | null;
  state: FixtureHostState;
  error: string | null;
  log: FixtureRequestLog;
}

declare global {
  interface Window {
    __uiuxFixture?: FixtureHostHandle;
  }
}
