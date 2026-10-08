/**
 * awardgrid-auth: the token service behind "Login with Seats.aero" in AwardGrid for iPhone (release plan step 18b).
 *
 * seats.aero's OAuth 2 flow needs a client secret, and the secret may never be on the device. So the iPhone app opens
 * seats.aero's own consent page in an ASWebAuthenticationSession, and this Worker does the three things that need a
 * server:
 *
 *   GET  /oauth/seats/callback  seats.aero redirects here (the registered HTTPS redirect URI). The code and state are
 *                               checked for shape and handed to the app's callback scheme with a 302, which the
 *                               authentication session catches. With no parameters it shows a short static page.
 *   POST /oauth/seats/token     {code, state}: exchanged at https://seats.aero/oauth2/token with the client ID and
 *                               secret added here, and the pinned redirect URI.
 *   POST /oauth/seats/refresh   {refresh_token}: the same endpoint, refresh_token grant. seats.aero asks that refreshes
 *                               happen on the server side only.
 *
 * It is stateless on purpose. It keeps nothing: no KV, D1, R2, Durable Object, cache or cookie; no request or response
 * body is logged (there is no console call in this file, and wrangler.jsonc turns observability and Logpush off). It
 * never calls seats.aero's user-info endpoint and never sees any seats.aero data: only tokens pass through, and only
 * in the response to the device that asked. The client ID and secret come from Worker secrets (SEATS_CLIENT_ID,
 * SEATS_CLIENT_SECRET, set with `wrangler secret put`), never from the request and never from the repository.
 *
 * Hardening, each enforced below and tested in ../test/worker.test.ts:
 *   - the redirect URI is pinned here, not taken from the request;
 *   - every value is checked for shape before it goes anywhere (refresh tokens must start "seats:otr:");
 *   - request bodies are JSON objects of at most 2 KB with exactly the expected fields;
 *   - a per-IP rate limit (the RATE_LIMITER binding; without it the Worker refuses to serve, so a deploy cannot
 *     quietly run unprotected);
 *   - no CORS headers: the app calls this over native HTTP, and a web page cannot read the answers;
 *   - responses are never cached and send no referrer, so a code in a URL does not travel on;
 *   - seats.aero's answer is reduced to the token fields, and its error text is never passed on (it could echo
 *     something it was sent).
 */

/** The Workers Rate Limiting binding (wrangler.jsonc `ratelimits`). Counters live in Cloudflare's memory, not storage. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** Worker secret: the OAuth client's ID. */
  SEATS_CLIENT_ID?: string;
  /** Worker secret: the OAuth client's secret. Never logged, never returned. */
  SEATS_CLIENT_SECRET?: string;
  RATE_LIMITER?: RateLimiter;
}

export interface Deps {
  /** The outbound fetch. Injected in tests; the Worker uses the runtime's. */
  fetch: typeof fetch;
}

/** The redirect URI registered with seats.aero. It must match the consent request byte for byte. */
export const REDIRECT_URI = "https://awardgrid.dowhiz.com/oauth/seats/callback";
/** Where the callback sends the browser: the app's own scheme, caught by ASWebAuthenticationSession. */
export const APP_CALLBACK = "com.dowhiz.awardgrid://oauth/seats";
/** seats.aero's token endpoint, the only address this Worker ever calls. */
export const SEATS_TOKEN_URL = "https://seats.aero/oauth2/token";
export const PATHS = { callback: "/oauth/seats/callback", token: "/oauth/seats/token", refresh: "/oauth/seats/refresh" } as const;

/** Largest request body accepted, in bytes. A token request is a few hundred. */
export const MAX_BODY_BYTES = 2048;
/** Largest upstream answer read, in bytes. */
const MAX_UPSTREAM_BYTES = 16 * 1024;
/** How long seats.aero gets to answer. */
export const UPSTREAM_TIMEOUT_MS = 10_000;

/** An authorization code: URL-safe characters only, bounded. seats.aero does not document its format. */
export const CODE_RE = /^[A-Za-z0-9._~+/=:-]{1,512}$/;
/** The app's state: 16 to 128 base64url characters (the app sends 43, from 32 random bytes). */
export const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
export const REFRESH_RE = /^seats:otr:[A-Za-z0-9._~+/=-]{1,500}$/;
export const ACCESS_RE = /^seats:ota:[A-Za-z0-9._~+/=-]{1,500}$/;
/** An OAuth error code (RFC 6749 §5.2 style). Anything else from upstream is reported as "rejected". */
const ERROR_CODE_RE = /^[a-z_]{1,64}$/;

const SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "strict-transport-security": "max-age=31536000",
};

function json(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", ...extra },
  });
}

const PAGE_HEADERS: Record<string, string> = {
  ...SECURITY_HEADERS,
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-frame-options": "DENY",
};

/** A static page: no script, no style, no external resource, nothing from the request. */
function page(status: number, title: string, text: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body><h1>${title}</h1><p>${text}</p></body></html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

const LANDING = () =>
  page(200, "AwardGrid and seats.aero", "This address finishes connecting AwardGrid for iPhone to a seats.aero account. If you opened it yourself, there is nothing to do here: return to the AwardGrid app.");
const BAD_CALLBACK = () => page(400, "Connection not finished", "seats.aero did not send what AwardGrid needs to finish connecting. Return to the AwardGrid app and try again.");

/** The client's address as Cloudflare saw it. */
function clientKey(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/** The body, at most `max` bytes, or null when it is longer. Reads the stream, so a missing Content-Length cannot slip a large body in. */
async function readLimited(request: Request, max: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

type BodyResult = { ok: true; fields: Record<string, string> } | { ok: false; response: Response };

/** A JSON object of at most MAX_BODY_BYTES with exactly `names`, each a string. */
async function readFields(request: Request, names: readonly string[]): Promise<BodyResult> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") return { ok: false, response: json(415, { error: "unsupported_media_type" }) };
  let text: string | null;
  try {
    text = await readLimited(request, MAX_BODY_BYTES);
  } catch {
    return { ok: false, response: json(400, { error: "invalid_request" }) };
  }
  if (text === null) return { ok: false, response: json(413, { error: "body_too_large" }) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, response: json(400, { error: "invalid_request" }) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, response: json(400, { error: "invalid_request" }) };
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== names.length || !names.every((name) => typeof record[name] === "string")) {
    return { ok: false, response: json(400, { error: "invalid_request" }) };
  }
  return { ok: true, fields: record as Record<string, string> };
}

/** What the app gets back: the token fields, checked, and nothing else seats.aero sent. */
interface TokenAnswer {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
}

function tokenAnswer(body: unknown): TokenAnswer | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.access_token !== "string" || !ACCESS_RE.test(b.access_token)) return null;
  if (typeof b.token_type !== "string" || b.token_type.toLowerCase() !== "bearer") return null;
  if (typeof b.expires_in !== "number" || !Number.isInteger(b.expires_in) || b.expires_in <= 0 || b.expires_in > 86_400) return null;
  if (b.refresh_token !== undefined && (typeof b.refresh_token !== "string" || !REFRESH_RE.test(b.refresh_token))) return null;
  return { access_token: b.access_token, token_type: "Bearer", expires_in: b.expires_in, ...(b.refresh_token ? { refresh_token: b.refresh_token } : {}) };
}

/** Call seats.aero's token endpoint and reduce its answer to what the app may see. */
async function exchange(payload: Record<string, string>, needsRefreshToken: boolean, deps: Deps): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await deps.fetch(SEATS_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return json(502, { error: "upstream_unreachable" });
  }
  let body: unknown = null;
  try {
    const text = await upstream.text();
    body = text.length <= MAX_UPSTREAM_BYTES ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (upstream.status >= 200 && upstream.status < 300) {
    const answer = tokenAnswer(body);
    if (!answer || (needsRefreshToken && !answer.refresh_token)) return json(502, { error: "upstream_invalid" });
    return json(200, { ...answer });
  }
  if (upstream.status >= 400 && upstream.status < 500) {
    const code = typeof body === "object" && body !== null ? (body as Record<string, unknown>).error : undefined;
    const error = typeof code === "string" && ERROR_CODE_RE.test(code) ? code : "rejected";
    const status = [400, 401, 403, 429].includes(upstream.status) ? upstream.status : 400;
    return json(status, { error });
  }
  return json(502, { error: "upstream_unavailable" });
}

function credentials(env: Env): { client_id: string; client_secret: string } | null {
  const id = env.SEATS_CLIENT_ID?.trim();
  const secret = env.SEATS_CLIENT_SECRET?.trim();
  return id && secret ? { client_id: id, client_secret: secret } : null;
}

function callback(url: URL): Response {
  const params = url.searchParams;
  if ([...params.keys()].length === 0) return LANDING();
  const state = params.get("state") ?? "";
  if (!STATE_RE.test(state)) return BAD_CALLBACK();
  const error = params.get("error");
  if (error !== null) {
    // The person declined, or seats.aero refused the request: the app hears which, and nothing else.
    const code = ERROR_CODE_RE.test(error) ? error : "access_denied";
    return new Response(null, { status: 302, headers: { ...SECURITY_HEADERS, location: `${APP_CALLBACK}?${new URLSearchParams({ error: code, state })}` } });
  }
  const code = params.get("code") ?? "";
  if (!CODE_RE.test(code)) return BAD_CALLBACK();
  return new Response(null, { status: 302, headers: { ...SECURITY_HEADERS, location: `${APP_CALLBACK}?${new URLSearchParams({ code, state })}` } });
}

export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const route = Object.values(PATHS).find((p) => p === url.pathname);
  if (!route) return json(404, { error: "not_found" });

  const limiter = env.RATE_LIMITER;
  if (!limiter) return json(503, { error: "rate_limiter_missing" });
  const allowed = await limiter.limit({ key: clientKey(request) }).catch(() => ({ success: false }));
  if (!allowed.success) return json(429, { error: "rate_limited" }, { "retry-after": "60" });

  if (route === PATHS.callback) {
    if (request.method !== "GET" && request.method !== "HEAD") return json(405, { error: "method_not_allowed" }, { allow: "GET, HEAD" });
    return callback(url);
  }

  if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });
  const client = credentials(env);
  if (!client) return json(500, { error: "not_configured" });

  if (route === PATHS.token) {
    const read = await readFields(request, ["code", "state"]);
    if (!read.ok) return read.response;
    const { code, state } = read.fields as { code: string; state: string };
    if (!CODE_RE.test(code) || !STATE_RE.test(state)) return json(400, { error: "invalid_request" });
    return exchange({ ...client, grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, state, scope: "openid" }, true, deps);
  }

  const read = await readFields(request, ["refresh_token"]);
  if (!read.ok) return read.response;
  const { refresh_token } = read.fields as { refresh_token: string };
  if (!REFRESH_RE.test(refresh_token)) return json(400, { error: "invalid_request" });
  // seats.aero's refresh grant takes exactly these four fields (developers.seats.aero, "Token").
  return exchange({ ...client, grant_type: "refresh_token", refresh_token }, false, deps);
}

const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, { fetch: (input, init) => fetch(input, init) });
  },
};

export default worker;
