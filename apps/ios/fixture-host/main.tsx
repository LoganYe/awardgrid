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
 * Ask's permission (release D10): a launch that has an Anthropic key starts with it already given, as if on an earlier
 * launch, so the Ask specs test Ask; `consent=0` leaves it out, for the consent sheet's own spec. It is written in the
 * settings file's real format, by the real storage, into the seed, so it is not counted as the app's write. A relaunch
 * (`preserve=1`) seeds nothing: what the last launch left, a withdrawal included, is what it finds.
 *
 * No <StrictMode>: this page runs React's development build, where StrictMode runs effects twice (two boots,
 * two watch checks). A production build never does that, so leaving it out keeps request counts true.
 */
import { createRoot } from "react-dom/client";
import { App } from "../src/app/App";
import { SETTINGS_NAMESPACE } from "../src/app/settings-store";
import { ANTHROPIC_CONSENT_VERSION } from "../src/ask/consent-copy";
import type { FileStore } from "../src/store/persistence";
import { SlotFileStorage } from "../src/workspace/slot-storage";
import { MemoryKeyStore } from "../src/native/keychain";
import { MemoryTokenVault } from "../src/oauth/token-vault";
import { installWebViewFetchGuard } from "../src/native/webview-fetch-guard";
import { SnapshotStore } from "../src/store/persistence";
import "../src/styles.css";
import { LocalFixtureFiles } from "./files";
import type { FixtureHostHandle, FixtureHostState } from "./protocol";
import { FoundationsGallery } from "./foundations";
import "./foundations.css";
import { FIXTURE_ANTHROPIC_KEY, environmentFor } from "./scenarios";
import { FIXTURE_OAUTH_CLIENT_ID, fixtureOAuth, refusingAnthropicFetch, scriptedAnthropicFetch, syntheticSeatsFetch } from "./transports";

/**
 * The App Store flavour (UIUX_STORE=1, vite.fixture.config.ts): the OAuth flavour, as `npm run build:store` builds it.
 * The account is connected through seats.aero's own sign-in, played in the page by transports.ts fixtureOAuth: a
 * scenario with a seats.aero account starts connected (tokens from an earlier launch, in an in-memory vault), one
 * without starts with Connect seats.aero. `oauth=decline` or `oauth=cancel` make this launch's sign-in end that way.
 */
const OAUTH = import.meta.env.VITE_AG_CONNECT === "oauth";

const status = document.getElementById("fixture-status") as HTMLOutputElement;
const handle: FixtureHostHandle = {
  scenario: null,
  requestedLang: null,
  state: "booting",
  error: null,
  log: { seats: 0, trips: 0, anthropic: 0, writes: 0, seatsPaths: [], directSeats: 0, directAnthropic: 0, anthropicContext: [], oauth: { consent: 0, token: 0, refresh: 0 } },
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

/** The settings files a permission given on an earlier launch would have left, in the real two-slot format. */
async function consentGivenEarlier(at: Date): Promise<Record<string, string>> {
  const captured: Record<string, string> = {};
  const capture: FileStore = {
    read: async (path) => captured[path] ?? null,
    write: async (path, data) => {
      captured[path] = data;
    },
    remove: async (path) => {
      delete captured[path];
    },
  };
  await new SlotFileStorage(capture).writeAtomically(SETTINGS_NAMESPACE, {
    locale: null,
    theme: "system",
    aiConsent: { version: ANTHROPIC_CONSENT_VERSION, at: at.toISOString() },
  });
  return captured;
}

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
  const signInMode = params.get("oauth");
  const oauth = OAUTH ? fixtureOAuth(handle.log, () => env.now, signInMode === "decline" || signInMode === "cancel" ? signInMode : "allow") : null;
  const anthropicKeys = new MemoryKeyStore();
  // `ai=1` (T15): an Anthropic key, and a scripted Anthropic that answers instead of refusing, for any scenario. The
  // AI scenarios (T16) have both of their own.
  const scriptedAi = params.get("ai") === "1" || env.scenario.id.startsWith("ai-");
  if (env.anthropicKey || scriptedAi) await anthropicKeys.set(env.anthropicKey ?? FIXTURE_ANTHROPIC_KEY);
  const preserve = params.get("preserve") === "1";
  const consentSeed = (env.anthropicKey || scriptedAi) && !preserve && params.get("consent") !== "0" ? await consentGivenEarlier(env.now) : {};
  const files = new LocalFixtureFiles(handle.log, {
    preserve,
    seed: { ...env.files, ...consentSeed },
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
        // The OAuth flavour's key is its token store, which bootstrap builds over the vault below.
        ...(oauth
          ? {
              oauth: {
                vault: new MemoryTokenVault(env.seatsKey ? oauth.connected() : null),
                tokenFetch: oauth.tokenFetch,
                authorize: oauth.authorize,
                clientId: FIXTURE_OAUTH_CLIENT_ID,
                legacyKeys: null,
              },
            }
          : { keys }),
        anthropicKeys,
        snapshots: new SnapshotStore(files),
        now: () => env.now,
        fetchImpl: syntheticSeatsFetch(env.rows, env.routes, handle.log, env.searchMode, oauth ? oauth.accepts : null),
        // The requested language reaches the translated screens; the host's own page stays English (U-007).
        locale: handle.requestedLang === "zh" ? "zh" : handle.requestedLang === "en" ? "en" : undefined,
        anthropicFetch: scriptedAi ? scriptedAnthropicFetch(handle.log, env.aiProposal) : refusingAnthropicFetch(handle.log),
        // Both transports above are injected, so there is no native bridge to assert. Production never sets this.
        assertNative: () => {},
      }}
      onReady={(services) => {
        window.clearTimeout(watchdog);
        handle.rerunShown = async () => {
          await services.rerunShown();
        };
        // One frame later, so the router has rendered the first screen before tests start reading it.
        window.requestAnimationFrame(() => report("ready"));
      }}
    />,
  );
}

start().catch((error: unknown) => report("error", error instanceof Error ? error.message : String(error)));
