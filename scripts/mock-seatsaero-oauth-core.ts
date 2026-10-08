/**
 * TEST-ONLY: the Login with Seats.aero mock's grants (the consent page, the token endpoint and the access tokens it
 * accepts), after developers.seats.aero's "Consent" and "Token" pages. Pure TypeScript with no Node import, so the
 * same rules serve both scripts/mock-seatsaero.ts (the HTTP mock, behind the token service in
 * scripts/mock-seatsaero-oauth.test.ts) and the UI/UX fixture host's App Store flavour (apps/ios/fixture-host/
 * transports.ts fixtureOAuth), which runs in a browser page and opens no socket.
 *
 * Codes are single-use; a wrong client is invalid_client; an unknown, used or revoked code or refresh token is
 * invalid_grant; `revoke()` revokes every grant, as when a person removes the app in seats.aero. Test values only.
 */
type Json = Record<string, unknown>;

export interface MockOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** The redirect URI registered for the client; the consent and token requests must name it exactly. */
  redirectUri: string;
  /** Seconds an access token lives (seats.aero: 3599). */
  accessTtlSeconds: number;
  /** Answer the consent page as if the person declined. */
  decline: boolean;
}

/** The mock client: test values only, never a real seats.aero client. */
export const MOCK_OAUTH_CLIENT: MockOAuthConfig = {
  clientId: "mock-client-id",
  clientSecret: "mock-client-secret",
  redirectUri: "https://awardgrid.dowhiz.com/oauth/seats/callback",
  accessTtlSeconds: 3599,
  decline: false,
};

/** The OAuth mock's grants, in memory only. */
export function createOAuthMock(config: MockOAuthConfig, now: () => Date) {
  let counter = 0;
  const next = () => `${(counter += 1).toString(36)}${Math.floor(now().getTime() / 1000).toString(36)}`;
  const codes = new Map<string, { redirectUri: string; state: string; used: boolean }>();
  const refreshTokens = new Set<string>();
  const accessTokens = new Map<string, { refresh: string; expiresAt: number }>();
  const issue = (refresh: string) => {
    const access = `seats:ota:mock${next()}`;
    accessTokens.set(access, { refresh, expiresAt: now().getTime() + config.accessTtlSeconds * 1000 });
    return { access_token: access, token_type: "Bearer", expires_in: config.accessTtlSeconds, refresh_token: refresh, scope: "openid" };
  };
  return {
    /** GET /oauth2/consent: where to send the browser, or why not (400). */
    consent(params: URLSearchParams): { status: 302; location: string } | { status: 400; body: Json } {
      const redirectUri = params.get("redirect_uri") ?? "";
      const state = params.get("state") ?? "";
      if (params.get("response_type") !== "code" || params.get("scope") !== "openid" || !state || params.get("client_id") !== config.clientId || redirectUri !== config.redirectUri) {
        return { status: 400, body: { error: "invalid_request" } };
      }
      if (config.decline) return { status: 302, location: `${redirectUri}?${new URLSearchParams({ error: "access_denied", state })}` };
      const code = `mockcode${next()}`;
      codes.set(code, { redirectUri, state, used: false });
      return { status: 302, location: `${redirectUri}?${new URLSearchParams({ code, state })}` };
    },
    /** POST /oauth2/token. */
    token(body: unknown): { status: number; body: Json } {
      const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
      if (b.client_id !== config.clientId || b.client_secret !== config.clientSecret) return { status: 401, body: { error: "invalid_client" } };
      if (b.grant_type === "authorization_code") {
        const grant = typeof b.code === "string" ? codes.get(b.code) : undefined;
        if (!grant || grant.used || b.redirect_uri !== grant.redirectUri || b.state !== grant.state || b.scope !== "openid") return { status: 400, body: { error: "invalid_grant" } };
        grant.used = true;
        const refresh = `seats:otr:mock${next()}`;
        refreshTokens.add(refresh);
        return { status: 200, body: issue(refresh) };
      }
      if (b.grant_type === "refresh_token") {
        if (typeof b.refresh_token !== "string" || !refreshTokens.has(b.refresh_token)) return { status: 400, body: { error: "invalid_grant" } };
        return { status: 200, body: issue(b.refresh_token) };
      }
      return { status: 400, body: { error: "unsupported_grant_type" } };
    },
    /** Whether a Bearer access token is one this mock issued, unexpired and unrevoked. */
    accepts(access: string): boolean {
      const held = accessTokens.get(access);
      return held !== undefined && refreshTokens.has(held.refresh) && held.expiresAt > now().getTime();
    },
    revoke() {
      refreshTokens.clear();
      accessTokens.clear();
    },
  };
}
