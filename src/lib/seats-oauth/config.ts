/**
 * Login with Seats.aero for the web app: where the consent page, the token service and the redirect URI are, and the
 * client ID (developers.seats.aero, "Consent").
 *
 * The web app uses AwardGrid's one OAuth client, the one the iPhone app uses, and the one redirect URI registered for
 * it: the token service's callback (sites/auth, the Worker awardgrid-auth), which sends a web state (./state.ts) on to
 * this app's /api/seats/oauth/callback. The client secret is the Worker's alone; this server never holds it.
 *
 *   SEATS_OAUTH_CLIENT_ID          the client ID (not a secret). Unset: Connect says it is not set up on this server.
 *   SEATS_OAUTH_CONSENT_URL        default https://seats.aero/oauth2/consent
 *   SEATS_OAUTH_REDIRECT_URI       default https://awardgrid.dowhiz.com/oauth/seats/callback (the Worker pins the same)
 *   SEATS_OAUTH_TOKEN_SERVICE_URL  default https://awardgrid.dowhiz.com/oauth/seats (its /token and /refresh)
 *
 * The three addresses are for development and the e2e suite, against the local mock (scripts/mock-seatsaero.ts):
 * each must be https, or http on a loopback host; anything else is ignored and the default stands.
 */

export const SEATS_CONSENT_URL = "https://seats.aero/oauth2/consent";
/** Registered with seats.aero for AwardGrid's client; the token service pins the same value. */
export const OAUTH_REDIRECT_URI = "https://awardgrid.dowhiz.com/oauth/seats/callback";
/** The token service's base address; its paths are /token and /refresh (sites/auth/src/index.ts PATHS). */
export const TOKEN_SERVICE_URL = "https://awardgrid.dowhiz.com/oauth/seats";
/** This app's callback path: the token service sends a web state's code here (sites/auth WEB_CALLBACK). */
export const WEB_CALLBACK_PATH = "/api/seats/oauth/callback";
/** The only scope AwardGrid asks for. */
export const OAUTH_SCOPE = "openid";

export interface SeatsOAuthConfig {
  clientId: string;
  consentUrl: string;
  redirectUri: string;
  tokenServiceUrl: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** `value` when it is an https address, or http on a loopback host (development, e2e); otherwise `fallback`. */
export function safeAddress(value: string | undefined, fallback: string): string {
  const raw = value?.trim();
  if (!raw) return fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fallback;
  }
  if (url.username || url.password || url.hash) return fallback;
  if (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname))) return raw.replace(/\/+$/, "");
  return fallback;
}

/** The configuration, or null when no client ID is set (Connect is then unavailable on this server). */
export function seatsOAuthConfigFromEnv(env: Record<string, string | undefined> = process.env): SeatsOAuthConfig | null {
  const clientId = env.SEATS_OAUTH_CLIENT_ID?.trim();
  if (!clientId || !/^[\x21-\x7e]{1,200}$/.test(clientId)) return null;
  return {
    clientId,
    consentUrl: safeAddress(env.SEATS_OAUTH_CONSENT_URL, SEATS_CONSENT_URL),
    redirectUri: safeAddress(env.SEATS_OAUTH_REDIRECT_URI, OAUTH_REDIRECT_URI),
    tokenServiceUrl: safeAddress(env.SEATS_OAUTH_TOKEN_SERVICE_URL, TOKEN_SERVICE_URL),
  };
}

/**
 * The token service's address on its own: a refresh needs no client ID here (the service adds it), so an account
 * already connected keeps working on a server where SEATS_OAUTH_CLIENT_ID is not set.
 */
export function tokenServiceUrlFromEnv(env: Record<string, string | undefined> = process.env): string {
  return safeAddress(env.SEATS_OAUTH_TOKEN_SERVICE_URL, TOKEN_SERVICE_URL);
}

/** seats.aero's consent page for this sign-in: response_type=code, the client, the redirect URI, the state, scope=openid. */
export function consentUrl(config: Pick<SeatsOAuthConfig, "clientId" | "consentUrl" | "redirectUri">, state: string): string {
  const params = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri, state, scope: OAUTH_SCOPE });
  return `${config.consentUrl}?${params}`;
}
