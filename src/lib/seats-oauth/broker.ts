/**
 * The web server's side of the token service (sites/auth, the Worker awardgrid-auth): the code exchange and the
 * refresh, the same two calls the iPhone app makes (apps/ios/src/oauth/broker.ts, whose rules this follows).
 *
 * The service adds AwardGrid's client ID and secret; this server sends only the code and state, or the refresh token,
 * and reads back the token fields. Nothing here is logged, and an error carries no token.
 */

export const ACCESS_RE = /^seats:ota:[A-Za-z0-9._~+/=-]{1,500}$/;
export const REFRESH_RE = /^seats:otr:[A-Za-z0-9._~+/=-]{1,500}$/;

export function isAccessToken(value: unknown): value is string {
  return typeof value === "string" && ACCESS_RE.test(value);
}

export function isRefreshToken(value: unknown): value is string {
  return typeof value === "string" && REFRESH_RE.test(value);
}

export interface TokenGrant {
  access: string;
  /** Absent when seats.aero kept the old refresh token (no rotation). */
  refresh: string | null;
  /** Seconds the access token is valid for. */
  expiresIn: number;
}

/**
 * How a call to the token service ended.
 *   - "rejected": seats.aero refused the code or the refresh token with an OAuth error code (`error`). For a refresh,
 *     "invalid_grant" means the person revoked AwardGrid in seats.aero, or the account ended.
 *   - "unavailable": the service or seats.aero could not answer (5xx, a rate limit, an answer that is not tokens), or
 *     something in between refused the call without an OAuth error code (a firewall's 403 page).
 *   - "network": no answer arrived (offline, timed out).
 */
export type BrokerResult = { ok: true; grant: TokenGrant } | { ok: false; reason: "rejected" | "unavailable" | "network"; status: number; error: string | null };

export interface TokenBroker {
  exchange(code: string, state: string): Promise<BrokerResult>;
  refresh(refreshToken: string): Promise<BrokerResult>;
}

/** The service waits up to 10 s for seats.aero; this leaves room for that and the trip there. */
export const TOKEN_SERVICE_TIMEOUT_MS = 15_000;

/**
 * The service's own error codes on a 400/401/403 that are not seats.aero refusing anything: a request it would not
 * send, a missing secret, and "rejected", an earlier version's word for a refusal that carried no OAuth error code.
 */
const NOT_A_REFUSAL = new Set(["invalid_request", "not_configured", "rejected"]);

function grantFrom(body: unknown): TokenGrant | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isAccessToken(b.access_token)) return null;
  if (typeof b.expires_in !== "number" || !Number.isInteger(b.expires_in) || b.expires_in <= 0) return null;
  if (b.refresh_token !== undefined && !isRefreshToken(b.refresh_token)) return null;
  return { access: b.access_token, refresh: typeof b.refresh_token === "string" ? b.refresh_token : null, expiresIn: b.expires_in };
}

export interface TokenBrokerOptions {
  /** The token service's base address (config.ts tokenServiceUrl). */
  baseUrl: string;
  /** Injected in tests; the server uses the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createTokenBroker(opts: TokenBrokerOptions): TokenBroker {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const call = async (path: "token" | "refresh", body: Record<string, string>, needsRefresh: boolean): Promise<BrokerResult> => {
    const fetchImpl = opts.fetch ?? globalThis.fetch;
    let res: Response;
    try {
      res = await fetchImpl(`${base}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        // The service never redirects; a redirect is something in between, not an answer.
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? TOKEN_SERVICE_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      return { ok: false, reason: "network", status: 0, error: null };
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      parsed = null;
    }
    if (res.status === 200) {
      const grant = grantFrom(parsed);
      if (grant && (!needsRefresh || grant.refresh)) return { ok: true, grant };
      return { ok: false, reason: "unavailable", status: res.status, error: null };
    }
    const code = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>).error : undefined;
    const error = typeof code === "string" && /^[a-z_]{1,64}$/.test(code) ? code : null;
    const rejected = (res.status === 400 || res.status === 401 || res.status === 403) && error !== null && !NOT_A_REFUSAL.has(error);
    return { ok: false, reason: rejected ? "rejected" : "unavailable", status: res.status, error };
  };
  return {
    exchange: (code, state) => call("token", { code, state }, true),
    refresh: (refreshToken) => call("refresh", { refresh_token: refreshToken }, false),
  };
}

/**
 * Whether a failed refresh means the connection is gone (the person revoked AwardGrid, or the account ended), rather
 * than a passing failure. Only seats.aero's own OAuth answer about the grant says so: "invalid_grant" (or
 * "access_denied"). A 401 or 403 alone is not enough: a firewall in front of seats.aero answers with one too, and
 * taking that for a revocation would remove the tokens and purge every result. A misconfigured service
 * ("invalid_client") is AwardGrid's fault, not a revocation either.
 */
export function meansRevoked(result: BrokerResult): boolean {
  return !result.ok && result.reason === "rejected" && (result.error === "invalid_grant" || result.error === "access_denied");
}
