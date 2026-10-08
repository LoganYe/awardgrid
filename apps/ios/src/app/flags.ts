/**
 * The build's flavour, fixed when Vite builds the bundle (the same constant pattern as VITE_AG_PROBES in App.tsx):
 * each flag is a literal comparison on `import.meta.env`, so in a build where it does not hold, the code behind it is
 * dropped from the bundle, not merely hidden.
 *
 *   - **STORE** (`VITE_AG_STORE=1`, `npm run build:store`): the App Store build. Ask (AI assistance) is compiled out:
 *     its routes, every way into it, and the copy that mentions it or Anthropic. AppServices.ask is still built at
 *     launch, never opened, so both flavours ship the same npm modules and one licenses list (release plan D3).
 *     `npm run build:store` also sets VITE_AG_CONNECT=oauth: the App Store build connects a seats.aero account only
 *     through seats.aero's own sign-in, with no paste field (and so needs VITE_AG_SEATS_CLIENT_ID).
 *     scripts/check-store-bundle.mjs checks the result: no Ask, no paid plan, and none of the paste field's words. The
 *     default `build` (dev, probes, the UI/UX e2e) keeps Ask and the key flavour.
 *   - **CONNECT** (`VITE_AG_CONNECT`): how a seats.aero account is connected. "key" (the default, for development,
 *     the probes, the UI/UX e2e and internal test builds; never the App Store build): its API key is pasted on the
 *     connect page. "0": no connection at all — the connect page and every link to it are compiled out
 *     (the fallback in plan D12; not shipped). "oauth": seats.aero's own sign-in ("Login with Seats.aero", release
 *     plan step 18b; the App Store build): the connect page has a "Connect seats.aero" button and no paste field, the tokens are kept by
 *     ../oauth/token-store.ts and refreshed through the token service (sites/auth), and seats.aero's results are kept
 *     on the device for 24 hours at most (../retention/short-term.ts), as the OAuth Addendum's Short-Term Caching
 *     allows. OAUTH below is its literal test, so the OAuth-only code is dropped from the other flavours.
 *   - **SEATS_CLIENT_ID** (`VITE_AG_SEATS_CLIENT_ID`): the OAuth client's ID, which is not a secret (the secret is the
 *     token service's). Empty by default; vite.config.ts refuses an App Store build of the OAuth flavour without it.
 *
 * vite.config.ts refuses any other value of either flavour variable, so a typo cannot quietly build the wrong flavour.
 */
export type ConnectMode = "key" | "oauth" | "0";

export const CONNECT_MODES: readonly ConnectMode[] = ["key", "oauth", "0"];

export const STORE: boolean = import.meta.env.VITE_AG_STORE === "1";

export const CONNECT: ConnectMode = (import.meta.env.VITE_AG_CONNECT || "key") as ConnectMode;

/** Whether this build has a way to connect a seats.aero account at all (CONNECT is not "0"). */
export const CAN_CONNECT: boolean = import.meta.env.VITE_AG_CONNECT !== "0";

/** Whether the account is connected through seats.aero's own sign-in (CONNECT is "oauth"). */
export const OAUTH: boolean = import.meta.env.VITE_AG_CONNECT === "oauth";

/** The OAuth client's ID (not a secret). Empty unless the build sets VITE_AG_SEATS_CLIENT_ID. */
export const SEATS_CLIENT_ID: string = (import.meta.env.VITE_AG_SEATS_CLIENT_ID ?? "").trim();
