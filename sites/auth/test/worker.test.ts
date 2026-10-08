/**
 * awardgrid-auth (../src/index.ts), with seats.aero faked: no request leaves this process. What the Worker forwards,
 * what it hands back, and every hardening rule in its header comment and in ../wrangler.jsonc.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import worker, { APP_CALLBACK, type Deps, type Env, MAX_BODY_BYTES, PATHS, REDIRECT_URI, SEATS_TOKEN_URL, handle } from "../src/index";

const ORIGIN = "https://awardgrid.dowhiz.com";
const STATE = "Ab3_dEf-Gh1jK2lM3nO4pQ5rS6tU7vW8xY9zA0bC1dE";
const CODE = "c0de.With-Allowed~chars";
const REFRESH = "seats:otr:31cDtrDo16l2Sw";
const SECRET = "client-secret-value-never-returned";
const CLIENT = "client-id-value";

function limiter(success = true) {
  return { limit: vi.fn(async (_: { key: string }) => ({ success })) };
}

function env(overrides: Partial<Env> = {}): Env {
  return { SEATS_CLIENT_ID: CLIENT, SEATS_CLIENT_SECRET: SECRET, RATE_LIMITER: limiter(), ...overrides };
}

/** A fake seats.aero token endpoint: records every call and answers with `status` and `body`. */
function upstream(status = 200, body: unknown = { access_token: "seats:ota:31cDaqd4jLYjeoz", token_type: "Bearer", expires_in: 3599, refresh_token: "seats:otr:new1", scope: "openid", id_token: "x.y.z" }) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const deps: Deps = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  };
  return { deps, calls };
}

function post(pathname: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(pathAndQuery: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${pathAndQuery}`, { ...init, headers: { "cf-connecting-ip": "203.0.113.7", ...(init.headers as Record<string, string> | undefined) } });
}

const sentBody = (call: { init: RequestInit | undefined }) => JSON.parse(String(call.init?.body)) as Record<string, unknown>;

describe("GET /oauth/seats/callback", () => {
  it("hands a well-formed code and state to the app's scheme with a 302, sending no referrer and caching nothing", async () => {
    const res = await handle(get(`${PATHS.callback}?code=${CODE}&state=${STATE}`), env(), upstream().deps);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP_CALLBACK}?${new URLSearchParams({ code: CODE, state: STATE })}`);
    expect(new URL(res.headers.get("location")!).searchParams.get("code")).toBe(CODE);
    expect(res.headers.get("location")).toMatch(/^com\.dowhiz\.awardgrid:\/\/oauth\/seats\?/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("with no parameters shows a static page: no script, no style, nothing from the request", async () => {
    const res = await handle(get(PATHS.callback), env(), upstream().deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    const html = await res.text();
    expect(html).toContain("AwardGrid");
    expect(html).not.toMatch(/<script|<style|<link|https?:\/\//i);
  });

  it("refuses a state or code of the wrong shape, and never echoes it", async () => {
    for (const query of [`code=${CODE}`, `state=${STATE}`, `code=${CODE}&state=short`, `code=<script>&state=${STATE}`, `code=${"a".repeat(513)}&state=${STATE}`, `code=${CODE}&state=${STATE}!`]) {
      const res = await handle(get(`${PATHS.callback}?${query}`), env(), upstream().deps);
      expect(res.status, query).toBe(400);
      expect(await res.text()).not.toContain("<script>");
    }
  });

  it("passes a refusal on as its OAuth error code only, so the app can say the person declined", async () => {
    const res = await handle(get(`${PATHS.callback}?error=access_denied&error_description=${encodeURIComponent("anything at all")}&state=${STATE}`), env(), upstream().deps);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP_CALLBACK}?error=access_denied&state=${STATE}`);
    const odd = await handle(get(`${PATHS.callback}?error=${encodeURIComponent("Not A Code")}&state=${STATE}`), env(), upstream().deps);
    expect(odd.headers.get("location")).toBe(`${APP_CALLBACK}?error=access_denied&state=${STATE}`);
  });

  it("takes GET and HEAD only, and makes no upstream call", async () => {
    const fake = upstream();
    expect((await handle(get(`${PATHS.callback}?code=${CODE}&state=${STATE}`, { method: "HEAD" }), env(), fake.deps)).status).toBe(302);
    const posted = await handle(post(PATHS.callback, {}), env(), fake.deps);
    expect(posted.status).toBe(405);
    expect(posted.headers.get("allow")).toBe("GET, HEAD");
    expect(fake.calls).toEqual([]);
  });
});

describe("POST /oauth/seats/token", () => {
  it("adds the client ID and secret and the pinned redirect URI, and calls seats.aero's token endpoint once", async () => {
    const fake = upstream();
    const res = await handle(post(PATHS.token, { code: CODE, state: STATE }), env(), fake.deps);
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.url).toBe(SEATS_TOKEN_URL);
    expect(fake.calls[0]!.init?.method).toBe("POST");
    expect(new Headers(fake.calls[0]!.init?.headers).get("content-type")).toBe("application/json");
    expect(sentBody(fake.calls[0]!)).toEqual({
      client_id: CLIENT,
      client_secret: SECRET,
      grant_type: "authorization_code",
      code: CODE,
      redirect_uri: REDIRECT_URI,
      state: STATE,
      scope: "openid",
    });
  });

  it("hands back the token fields only: no id_token, no scope, and never the secret", async () => {
    const res = await handle(post(PATHS.token, { code: CODE, state: STATE }), env(), upstream().deps);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ access_token: "seats:ota:31cDaqd4jLYjeoz", token_type: "Bearer", expires_in: 3599, refresh_token: "seats:otr:new1" });
    expect(text).not.toContain(SECRET);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses a redirect URI, client ID or any other field the app tries to send: the Worker sets those", async () => {
    const fake = upstream();
    for (const body of [
      { code: CODE, state: STATE, redirect_uri: "https://evil.example/cb" },
      { code: CODE, state: STATE, client_id: "other" },
      { code: CODE },
      { code: CODE, state: 5 },
      [CODE, STATE],
      "null",
    ]) {
      const res = await handle(post(PATHS.token, body), env(), fake.deps);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(fake.calls).toEqual([]);
  });

  it("checks the code and state for shape before anything is sent", async () => {
    const fake = upstream();
    expect((await handle(post(PATHS.token, { code: "has space", state: STATE }), env(), fake.deps)).status).toBe(400);
    expect((await handle(post(PATHS.token, { code: CODE, state: "tiny" }), env(), fake.deps)).status).toBe(400);
    expect(fake.calls).toEqual([]);
  });

  it("answers 502 when seats.aero's success is not a usable token (wrong prefix, no refresh token)", async () => {
    for (const body of [
      { access_token: "sk-something", token_type: "Bearer", expires_in: 3599, refresh_token: REFRESH },
      { access_token: "seats:ota:a", token_type: "Bearer", expires_in: 3599 },
      { access_token: "seats:ota:a", token_type: "Bearer", expires_in: -1, refresh_token: REFRESH },
      "not json",
    ]) {
      const res = await handle(post(PATHS.token, { code: CODE, state: STATE }), env(), upstream(200, body).deps);
      expect(res.status, JSON.stringify(body)).toBe(502);
      expect(await res.json()).toEqual({ error: "upstream_invalid" });
    }
  });
});

describe("POST /oauth/seats/refresh", () => {
  it("sends exactly the four fields of seats.aero's refresh grant", async () => {
    const fake = upstream(200, { access_token: "seats:ota:fresh", token_type: "Bearer", expires_in: 3599 });
    const res = await handle(post(PATHS.refresh, { refresh_token: REFRESH }), env(), fake.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: "seats:ota:fresh", token_type: "Bearer", expires_in: 3599 });
    expect(fake.calls.map((c) => c.url)).toEqual([SEATS_TOKEN_URL]);
    expect(sentBody(fake.calls[0]!)).toEqual({ client_id: CLIENT, client_secret: SECRET, grant_type: "refresh_token", refresh_token: REFRESH });
  });

  it("passes a rotated refresh token on", async () => {
    const res = await handle(post(PATHS.refresh, { refresh_token: REFRESH }), env(), upstream().deps);
    expect(((await res.json()) as { refresh_token?: string }).refresh_token).toBe("seats:otr:new1");
  });

  it("refuses anything that is not a seats.aero refresh token (seats:otr:)", async () => {
    const fake = upstream();
    for (const token of ["seats:ota:access-not-refresh", "otr:abc", "seats:otr:", `seats:otr:${"a".repeat(501)}`, "seats:otr:a b"]) {
      expect((await handle(post(PATHS.refresh, { refresh_token: token }), env(), fake.deps)).status, token).toBe(400);
    }
    expect(fake.calls).toEqual([]);
  });

  it("passes seats.aero's OAuth error code on (a revoked grant), never its description", async () => {
    const res = await handle(post(PATHS.refresh, { refresh_token: REFRESH }), env(), upstream(400, { error: "invalid_grant", error_description: `client ${SECRET} revoked` }).deps);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "invalid_grant" });
    expect(text).not.toContain(SECRET);
    const odd = await handle(post(PATHS.refresh, { refresh_token: REFRESH }), env(), upstream(401, { error: "Weird Thing" }).deps);
    expect([odd.status, await odd.json()]).toEqual([401, { error: "rejected" }]);
    const teapot = await handle(post(PATHS.refresh, { refresh_token: REFRESH }), env(), upstream(418, "").deps);
    expect([teapot.status, await teapot.json()]).toEqual([400, { error: "rejected" }]);
  });

  it("says seats.aero is unavailable on a 5xx or a failed request, without detail", async () => {
    const down = await handle(post(PATHS.refresh, { refresh_token: REFRESH }), env(), upstream(503, { error: "maintenance" }).deps);
    expect([down.status, await down.json()]).toEqual([502, { error: "upstream_unavailable" }]);
    const failing: Deps = {
      fetch: (async () => {
        throw new TypeError("network down");
      }) as typeof fetch,
    };
    const unreachable = await handle(post(PATHS.refresh, { refresh_token: REFRESH }), env(), failing);
    expect([unreachable.status, await unreachable.json()]).toEqual([502, { error: "upstream_unreachable" }]);
  });

  it("gives seats.aero a bounded time and follows no redirect", async () => {
    const fake = upstream();
    await handle(post(PATHS.refresh, { refresh_token: REFRESH }), env(), fake.deps);
    expect(fake.calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    expect(fake.calls[0]!.init?.redirect).toBe("manual");
  });
});

describe("request limits", () => {
  it("refuses a body over 2 KB, whether or not it declares its length", async () => {
    const big = JSON.stringify({ refresh_token: `seats:otr:${"a".repeat(MAX_BODY_BYTES)}` });
    const declared = await handle(post(PATHS.refresh, big), env(), upstream().deps);
    expect(declared.status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i++) controller.enqueue(new TextEncoder().encode("x".repeat(600)));
        controller.close();
      },
    });
    const chunked = new Request(`${ORIGIN}${PATHS.refresh}`, { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    expect((await handle(chunked, env(), upstream().deps)).status).toBe(413);
    const lying = await handle(post(PATHS.refresh, { refresh_token: REFRESH }, { "content-length": "abc" }), env(), upstream().deps);
    expect(lying.status).toBe(413);
  });

  it("takes JSON only", async () => {
    const res = await handle(post(PATHS.refresh, `refresh_token=${REFRESH}`, { "content-type": "application/x-www-form-urlencoded" }), env(), upstream().deps);
    expect(res.status).toBe(415);
    const text = await handle(post(PATHS.refresh, JSON.stringify({ refresh_token: REFRESH }), { "content-type": "text/plain" }), env(), upstream().deps);
    expect(text.status).toBe(415);
    const charset = await handle(post(PATHS.refresh, { refresh_token: REFRESH }, { "content-type": "application/json; charset=utf-8" }), env(), upstream().deps);
    expect(charset.status).toBe(200);
  });

  it("rate-limits by client address, before anything else happens", async () => {
    const counting = limiter(true);
    await handle(post(PATHS.refresh, { refresh_token: REFRESH }), env({ RATE_LIMITER: counting }), upstream().deps);
    expect(counting.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
    const fake = upstream();
    const limited = await handle(post(PATHS.refresh, { refresh_token: REFRESH }), env({ RATE_LIMITER: limiter(false) }), fake.deps);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(fake.calls).toEqual([]);
    const callback = await handle(get(`${PATHS.callback}?code=${CODE}&state=${STATE}`), env({ RATE_LIMITER: limiter(false) }), fake.deps);
    expect(callback.status).toBe(429);
  });

  it("serves nothing without its rate limiter, or without its secrets", async () => {
    const fake = upstream();
    expect((await handle(post(PATHS.refresh, { refresh_token: REFRESH }), env({ RATE_LIMITER: undefined }), fake.deps)).status).toBe(503);
    const unconfigured = await handle(post(PATHS.refresh, { refresh_token: REFRESH }), env({ SEATS_CLIENT_SECRET: "" }), fake.deps);
    expect([unconfigured.status, await unconfigured.json()]).toEqual([500, { error: "not_configured" }]);
    expect((await handle(post(PATHS.token, { code: CODE, state: STATE }), env({ SEATS_CLIENT_ID: undefined }), fake.deps)).status).toBe(500);
    expect(fake.calls).toEqual([]);
  });

  it("knows three paths and nothing else; a GET on a token path is refused; no CORS preflight is answered", async () => {
    const fake = upstream();
    for (const p of ["/", "/oauth/seats", "/oauth/seats/userinfo", "/oauth2/token", "/oauth/seats/token/"]) {
      expect((await handle(get(p), env(), fake.deps)).status, p).toBe(404);
    }
    const asGet = await handle(get(PATHS.token), env(), fake.deps);
    expect([asGet.status, asGet.headers.get("allow")]).toEqual([405, "POST"]);
    const preflight = await handle(get(PATHS.token, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } }), env(), fake.deps);
    expect(preflight.status).toBe(405);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
    expect(fake.calls).toEqual([]);
  });

  it("the default export is the same handler", async () => {
    const res = await worker.fetch(get(PATHS.callback), env());
    expect(res.status).toBe(200);
  });
});

describe("what the Worker is allowed to be (source and wrangler.jsonc)", () => {
  const here = import.meta.dirname;
  const source = readFileSync(path.join(here, "..", "src", "index.ts"), "utf8");
  const config = JSON.parse(
    readFileSync(path.join(here, "..", "wrangler.jsonc"), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n"),
  ) as Record<string, unknown>;

  it("logs nothing and calls one address: seats.aero's token endpoint (no user-info call)", () => {
    expect(source).not.toMatch(/console\./);
    const urls = [...source.matchAll(/https:\/\/[^\s"'`)]+/g)].map((m) => m[0]);
    expect(new Set(urls)).toEqual(new Set([REDIRECT_URI, SEATS_TOKEN_URL]));
    expect(new Set(source.match(/oauth2\/[a-z]+/g))).toEqual(new Set(["oauth2/token"]));
    expect(source).not.toMatch(/userinfo/i);
  });

  it("is awardgrid-auth on the OAuth paths only, with no second address", () => {
    expect(config.name).toBe("awardgrid-auth");
    expect(config.main).toBe("src/index.ts");
    expect(config.routes).toEqual([{ pattern: "awardgrid.dowhiz.com/oauth/*", zone_name: "dowhiz.com" }]);
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
  });

  it("keeps nothing: no storage binding, no vars, observability and Logpush off, a rate limiter bound", () => {
    for (const binding of ["kv_namespaces", "d1_databases", "r2_buckets", "durable_objects", "queues", "vars", "analytics_engine_datasets", "tail_consumers", "hyperdrive"]) {
      expect(config, binding).not.toHaveProperty(binding);
    }
    expect(config.observability).toEqual({ enabled: false, logs: { enabled: false } });
    expect(config.logpush).toBe(false);
    expect(config.ratelimits).toEqual([{ name: "RATE_LIMITER", namespace_id: expect.any(String), simple: { limit: 20, period: 60 } }]);
  });

  it("holds no secret value: the client ID and secret are Worker secrets, typed by the owner", () => {
    const raw = readFileSync(path.join(here, "..", "wrangler.jsonc"), "utf8");
    expect(raw).not.toMatch(/"SEATS_CLIENT_(ID|SECRET)"\s*:/);
    expect(source).not.toMatch(/client_secret:\s*["']/);
  });

  it("the deployed static site's config does not route /oauth/ (the Worker is not attached to anything deployed)", () => {
    const landing = readFileSync(path.join(here, "..", "..", "landing", "wrangler.jsonc"), "utf8");
    expect(landing).not.toMatch(/oauth/i);
  });
});
