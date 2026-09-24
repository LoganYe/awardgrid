/**
 * TEST-ONLY entry for the UI/UX v1 fixture host (playwright.uiux.config.ts → vite.fixture.config.ts).
 *
 * It renders the real `App`, booted by the real `bootstrap()`, with every port passed in explicitly:
 * memory key stores holding fake keys, a namespaced browser file store, and synthetic transports. The WebView
 * fetch guard is installed first, as in src/main.tsx, so a request to the real hosts still rejects — and the
 * host counts any such attempt, so a wiring bug shows up in the request log instead of vanishing.
 *
 * Status is reported on #fixture-status (data-testid="fixture-ready"): "booting", then "ready" once the app's
 * services exist, or "error" with a reason. A missing, unknown or not-yet-seeded scenario is an error; the
 * app is not mounted and nothing falls back.
 *
 * No <StrictMode>: this page runs React's development build, where StrictMode runs effects twice (two boots,
 * two watch checks). A production build never does that, so leaving it out keeps request counts true.
 */
import { createRoot } from "react-dom/client";
import { App } from "../src/app/App";
import { MemoryKeyStore } from "../src/native/keychain";
import { installWebViewFetchGuard } from "../src/native/webview-fetch-guard";
import { SnapshotStore } from "../src/store/persistence";
import "../src/styles.css";
import { LocalFixtureFiles } from "./files";
import type { FixtureHostHandle, FixtureHostState } from "./protocol";
import { FoundationsGallery } from "./foundations";
import "./foundations.css";
import { environmentFor } from "./scenarios";
import { refusingAnthropicFetch, syntheticSeatsFetch } from "./transports";

const status = document.getElementById("fixture-status") as HTMLOutputElement;
const handle: FixtureHostHandle = {
  scenario: null,
  requestedLang: null,
  state: "booting",
  error: null,
  log: { seats: 0, trips: 0, anthropic: 0, writes: 0, seatsPaths: [], directSeats: 0, directAnthropic: 0 },
};
window.__uiuxFixture = handle;

installWebViewFetchGuard();
// Count what the guard refuses. The guard throws before any request exists, so neither the synthetic
// transports nor Playwright's routing would otherwise see an app bug that reaches for the global fetch.
const guarded = window.fetch;
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  try {
    return await guarded(input, init);
  } catch (error) {
    if (error instanceof Error && error.name === "NativeHttpRequiredError") {
      const host = (error as Error & { host?: string }).host ?? "";
      if (host === "seats.aero") handle.log.directSeats += 1;
      else handle.log.directAnthropic += 1;
    }
    throw error;
  }
}) as typeof fetch;

function report(state: FixtureHostState, error: string | null = null): void {
  handle.state = state;
  handle.error = error;
  status.dataset.state = state;
  status.textContent = error ?? state;
}

async function start(): Promise<void> {
  // A probe or e2e build flag would make App boot the Simulator probe ports instead of the ones passed here,
  // and every count below would silently be about the wrong transport. vite.fixture.config.ts already keeps
  // VITE_* variables out of this page; this is the check that it did.
  if (import.meta.env.VITE_AG_PROBES) throw new Error("VITE_AG_PROBES is set; the fixture host refuses to boot probe ports.");

  const params = new URLSearchParams(window.location.search);
  const env = environmentFor(params.get("scenario"));
  handle.scenario = env.scenario.id;
  status.dataset.scenario = env.scenario.id;
  // Recorded, not applied: marking English text as Chinese would mislabel it for screen readers and axe.
  handle.requestedLang = params.get("lang");
  if (handle.requestedLang) status.dataset.lang = handle.requestedLang;

  const keys = new MemoryKeyStore();
  if (env.seatsKey) await keys.set(env.seatsKey);
  const anthropicKeys = new MemoryKeyStore();
  if (env.anthropicKey) await anthropicKeys.set(env.anthropicKey);
  const files = new LocalFixtureFiles(handle.log, {
    preserve: params.get("preserve") === "1",
    seed: env.files,
    failWrites: env.failWrites,
  });

  const root = document.getElementById("root")!;
  // `foundations` is the base controls on their own page (T04), not the app.
  if (env.scenario.id === "foundations") {
    root.dataset.mounted = "1";
    createRoot(root).render(<FoundationsGallery />);
    window.requestAnimationFrame(() => report("ready"));
    return;
  }
  // If bootstrap fails, App shows its own "could not start" screen and never calls onReady; say so here too.
  const watchdog = window.setTimeout(() => {
    if (handle.state === "booting") report("error", `The app did not start: ${root.textContent?.slice(0, 200) ?? ""}`);
  }, 10_000);

  root.dataset.mounted = "1";
  createRoot(root).render(
    <App
      bootstrapOptions={{
        keys,
        anthropicKeys,
        snapshots: new SnapshotStore(files),
        now: () => env.now,
        fetchImpl: syntheticSeatsFetch(env.rows, env.routes, handle.log, env.searchMode),
        // The requested language reaches the translated screens; the host's own page stays English (U-007).
        locale: handle.requestedLang === "zh" ? "zh" : handle.requestedLang === "en" ? "en" : undefined,
        anthropicFetch: refusingAnthropicFetch(handle.log),
        // Both transports above are injected, so there is no native bridge to assert. Production never sets this.
        assertNative: () => {},
      }}
      onReady={() => {
        window.clearTimeout(watchdog);
        // One frame later, so the router has rendered the first screen before tests start reading it.
        window.requestAnimationFrame(() => report("ready"));
      }}
    />,
  );
}

start().catch((error: unknown) => report("error", error instanceof Error ? error.message : String(error)));
