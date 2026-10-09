/**
 * "Connect seats.aero" in the web app, start to finish (the iPhone app's apps/ios/src/oauth/connect.ts, with the
 * browser in place of the sign-in sheet and this server in place of the Keychain):
 *
 *   1. POST /api/seats/connect: a fresh web state for the signed-in account (./state.ts) and seats.aero's consent URL
 *      (./config.ts), which the page opens.
 *   2. seats.aero asks the person to sign in and approve AwardGrid, then redirects to the registered redirect URI, the
 *      token service's callback, which sends a web state's code and state on to GET /api/seats/oauth/callback.
 *   3. `finishConnect`: the state must be one this account started, unexpired, and is used up; an `error` (the person
 *      declined) ends here; the code is exchanged through the token service (./broker.ts); the tokens are encrypted
 *      into seats_connections (./store.ts). Nothing reaches the browser but the outcome's name.
 *
 * Every outcome is a value the settings page can say. Nothing is logged; no token or code is ever shown.
 */
import type { DbConn } from "@/lib/auth/clock";
import { getMasterKey } from "@/lib/keys";
import { type TokenBroker, createTokenBroker } from "./broker";
import { type SeatsOAuthConfig, seatsOAuthConfigFromEnv } from "./config";
import { purgeSeatsDataForUser } from "./retention";
import { WEB_STATE_RE, consumeState } from "./state";
import { isSeatsConnected, saveConnection } from "./store";

/** An authorization code: URL-safe characters only, bounded (the token service's CODE_RE). */
export const CODE_RE = /^[A-Za-z0-9._~+/=:-]{1,512}$/;

/**
 * How connecting ended (the `seats` parameter the settings page reads).
 *   - connected: the account is connected.
 *   - denied: the person declined on seats.aero's page (or seats.aero refused the request).
 *   - mismatch: the answer was not for a sign-in this account started (another account's, a forged or used one).
 *   - expired: the sign-in took longer than the state lives.
 *   - rejected: seats.aero refused the code.
 *   - unavailable: the token service or seats.aero could not finish it now.
 *   - not_configured: this server has no seats.aero client ID.
 *   - failed: anything else (a malformed answer, MASTER_KEY missing, the tokens not stored).
 */
export const CONNECT_OUTCOMES = ["connected", "denied", "mismatch", "expired", "rejected", "unavailable", "not_configured", "failed"] as const;
export type ConnectOutcome = (typeof CONNECT_OUTCOMES)[number];

export function isConnectOutcome(value: unknown): value is ConnectOutcome {
  return typeof value === "string" && (CONNECT_OUTCOMES as readonly string[]).includes(value);
}

export interface FinishConnectOptions {
  now?: () => Date;
  masterKey?: Buffer;
  /** The token service client; production builds one from the configuration. */
  broker?: TokenBroker;
  /** The configuration; production reads the environment. */
  config?: SeatsOAuthConfig | null;
}

/** Steps 3 above, for the account signed in on the callback request. */
export async function finishConnect(db: DbConn, userId: string, params: URLSearchParams, opts: FinishConnectOptions = {}): Promise<ConnectOutcome> {
  const now = opts.now ?? (() => new Date());
  const config = opts.config === undefined ? seatsOAuthConfigFromEnv() : opts.config;
  const state = params.get("state") ?? "";
  if (!WEB_STATE_RE.test(state)) return "mismatch";
  // Used up before anything else, whatever happens next: a state is good for one answer.
  const check = consumeState(db, userId, state, { now: now() });
  if (check !== "ok") return check === "expired" ? "expired" : "mismatch";
  if (params.has("error")) return "denied";
  const code = params.get("code") ?? "";
  if (!CODE_RE.test(code)) return "failed";
  if (!config) return "not_configured";

  let masterKey: Buffer;
  try {
    masterKey = opts.masterKey ?? getMasterKey();
  } catch {
    return "failed";
  }
  const broker = opts.broker ?? createTokenBroker({ baseUrl: config.tokenServiceUrl });
  const exchanged = await broker.exchange(code, state);
  if (!exchanged.ok) return exchanged.reason === "rejected" ? "rejected" : "unavailable";
  const { access, refresh, expiresIn } = exchanged.grant;
  if (!refresh) return "unavailable";
  try {
    // Connecting again over a connection (perhaps another seats.aero account): what the old one fetched goes first.
    if (isSeatsConnected(db, userId)) purgeSeatsDataForUser(db, userId, now());
    saveConnection(db, userId, { access, refresh, expiresIn }, { masterKey, now: now() });
  } catch {
    return "failed";
  }
  return "connected";
}
