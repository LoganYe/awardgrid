/**
 * "Connect seats.aero" (release plan step 18b): seats.aero's own sign-in and consent, start to finish.
 *
 *   1. A fresh state (32 random bytes, base64url) and the consent URL: response_type=code, the client ID, the
 *      registered redirect URI, the state and scope=openid (developers.seats.aero, "Consent").
 *   2. The sign-in sheet (./seats-auth-plugin.ts) opens it; seats.aero redirects to the token service's callback,
 *      which hands the code and state to com.dowhiz.awardgrid://oauth/seats, where the sheet catches them.
 *   3. The callback is read: its state must be the one sent (anything else is not this sign-in and is dropped), and an
 *      `error` (the person declined) ends here.
 *   4. The token service exchanges the code (./broker.ts) and the tokens go to the Keychain (./token-store.ts).
 *
 * Every outcome is a value the connect page can say. Nothing is logged; no token or code is ever shown.
 */
import type { TokenBroker } from "./broker";
import type { AuthorizeResult } from "./seats-auth-plugin";
import type { TokenKeyStore } from "./token-store";

export const SEATS_CONSENT_URL = "https://seats.aero/oauth2/consent";
/** Registered with seats.aero for AwardGrid's client; the token service pins the same value. */
export const OAUTH_REDIRECT_URI = "https://awardgrid.dowhiz.com/oauth/seats/callback";
/** The app's scheme, which the sign-in sheet listens for (SeatsAuthPlugin.swift callbackURLScheme). */
export const CALLBACK_SCHEME = "com.dowhiz.awardgrid";

export function consentUrl(clientId: string, state: string): string {
  const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: OAUTH_REDIRECT_URI, state, scope: "openid" });
  return `${SEATS_CONSENT_URL}?${params}`;
}

/** 32 random bytes as base64url: 43 characters, what the token service accepts as a state. */
export function randomState(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type CallbackResult = { ok: true; code: string } | { ok: false; reason: "denied" | "mismatch" | "failed" };

/** Read what the sheet caught. Only com.dowhiz.awardgrid://oauth/seats with this sign-in's state counts. */
export function readCallback(raw: string, expectedState: string): CallbackResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (url.protocol !== `${CALLBACK_SCHEME}:` || url.host !== "oauth" || url.pathname !== "/seats") return { ok: false, reason: "failed" };
  if (url.searchParams.get("state") !== expectedState) return { ok: false, reason: "mismatch" };
  if (url.searchParams.has("error")) return { ok: false, reason: "denied" };
  const code = url.searchParams.get("code");
  return code ? { ok: true, code } : { ok: false, reason: "failed" };
}

/**
 * How connecting ended.
 *   - not_configured: this build has no client ID (a development build; the App Store build refuses to be made so).
 *   - unavailable: no sign-in sheet here (a browser, the UI/UX host).
 *   - canceled: the person closed the sheet. denied: they declined on seats.aero's page.
 *   - mismatch: the answer was not for this sign-in. failed: the sheet or the answer went wrong.
 *   - rejected: seats.aero refused the code. network / service: the token service could not be reached, or answered
 *     with something other than tokens.
 *   - keychain: the tokens could not be saved on this device.
 */
export type ConnectOutcome =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "unavailable" | "canceled" | "denied" | "mismatch" | "failed" | "rejected" | "network" | "service" | "keychain" };

export interface ConnectDeps {
  clientId: string;
  authorize: (url: string) => Promise<AuthorizeResult>;
  broker: TokenBroker;
  store: Pick<TokenKeyStore, "save">;
  state?: () => string;
}

export async function connectSeats(deps: ConnectDeps): Promise<ConnectOutcome> {
  if (!deps.clientId) return { ok: false, reason: "not_configured" };
  const state = (deps.state ?? randomState)();
  const opened = await deps.authorize(consentUrl(deps.clientId, state));
  if (!opened.ok) return { ok: false, reason: opened.reason };
  const callback = readCallback(opened.url, state);
  if (!callback.ok) return { ok: false, reason: callback.reason };
  const exchanged = await deps.broker.exchange(callback.code, state);
  if (!exchanged.ok) return { ok: false, reason: exchanged.reason === "rejected" ? "rejected" : exchanged.reason === "network" ? "network" : "service" };
  const { access, refresh, expiresIn } = exchanged.grant;
  if (!refresh) return { ok: false, reason: "service" };
  try {
    await deps.store.save({ access, refresh, expiresIn });
  } catch {
    return { ok: false, reason: "keychain" };
  }
  return { ok: true };
}
