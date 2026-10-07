/**
 * The mock's Login with Seats.aero (scripts/mock-seatsaero.ts, /oauth2/consent and /oauth2/token), on its own and
 * behind the token service (sites/auth/src/index.ts): consent → the service's callback → the app's scheme → the
 * exchange through the service → a Partner API call with the Bearer token → a refresh → a revocation. Everything runs
 * on 127.0.0.1 with test values; no request leaves the machine.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchResponse } from "@awardgrid/core/seatsaero/types";
import { APP_CALLBACK, type Deps, type Env, PATHS, REDIRECT_URI, SEATS_TOKEN_URL, handle } from "../sites/auth/src/index";
import { MOCK_OAUTH_CLIENT, type MockHandle, createMockServer } from "./mock-seatsaero";

const NOW = new Date("2026-10-06T15:00:00Z");
let clock = NOW.getTime();
let mock: MockHandle;
let origin: string;
const STATE = "s1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u";

beforeAll(async () => {
  mock = await createMockServer({ port: 0, now: () => new Date(clock), log: () => {} });
  origin = `http://127.0.0.1:${mock.port}`;
});
afterAll(async () => {
  await mock.close();
});

function consent(params: Record<string, string>) {
  return fetch(`${origin}/oauth2/consent?${new URLSearchParams(params)}`, { redirect: "manual" });
}
const goodConsent = { response_type: "code", client_id: MOCK_OAUTH_CLIENT.clientId, redirect_uri: MOCK_OAUTH_CLIENT.redirectUri, state: STATE, scope: "openid" };

function token(body: unknown) {
  return fetch(`${origin}/oauth2/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
const client = { client_id: MOCK_OAUTH_CLIENT.clientId, client_secret: MOCK_OAUTH_CLIENT.clientSecret };

async function codeFromConsent(): Promise<string> {
  const res = await consent(goodConsent);
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("location")!);
  expect(location.searchParams.get("state")).toBe(STATE);
  return location.searchParams.get("code")!;
}

function search(auth: string) {
  return fetch(`${mock.baseUrl}search?origin_airport=HKG&destination_airport=SEA&cabins=business&take=10`, { headers: { "Partner-Authorization": auth } });
}

describe("the mock's consent page", () => {
  it("redirects to the registered URI with a code and the same state", async () => {
    const res = await consent(goodConsent);
    const location = new URL(res.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(MOCK_OAUTH_CLIENT.redirectUri);
    expect(location.searchParams.get("code")).toMatch(/^mockcode/);
  });

  it("refuses what seats.aero refuses: another response type or scope, no state, an unknown client or redirect URI", async () => {
    for (const bad of [
      { ...goodConsent, response_type: "token" },
      { ...goodConsent, scope: "openid profile" },
      { ...goodConsent, state: "" },
      { ...goodConsent, client_id: "someone-else" },
      { ...goodConsent, redirect_uri: "https://example.com/cb" },
    ]) {
      expect((await consent(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("can be told to decline, which redirects with access_denied", async () => {
    const declining = await createMockServer({ port: 0, now: () => NOW, log: () => {}, oauth: { decline: true } });
    try {
      const res = await fetch(`http://127.0.0.1:${declining.port}/oauth2/consent?${new URLSearchParams(goodConsent)}`, { redirect: "manual" });
      const location = new URL(res.headers.get("location")!);
      expect([location.searchParams.get("error"), location.searchParams.get("state"), location.searchParams.get("code")]).toEqual(["access_denied", STATE, null]);
    } finally {
      await declining.close();
    }
  });
});

describe("the mock's token endpoint", () => {
  it("exchanges a code once, for seats.aero-shaped tokens, and refreshes with the refresh token", async () => {
    const code = await codeFromConsent();
    const exchanged = await token({ ...client, grant_type: "authorization_code", code, redirect_uri: MOCK_OAUTH_CLIENT.redirectUri, state: STATE, scope: "openid" });
    expect(exchanged.status).toBe(200);
    const tokens = (await exchanged.json()) as Record<string, unknown>;
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3599, scope: "openid" });
    expect(tokens.access_token).toMatch(/^seats:ota:/);
    expect(tokens.refresh_token).toMatch(/^seats:otr:/);
    const again = await token({ ...client, grant_type: "authorization_code", code, redirect_uri: MOCK_OAUTH_CLIENT.redirectUri, state: STATE, scope: "openid" });
    expect([again.status, await again.json()]).toEqual([400, { error: "invalid_grant" }]);
    const refreshed = await token({ ...client, grant_type: "refresh_token", refresh_token: tokens.refresh_token });
    expect(refreshed.status).toBe(200);
    expect(((await refreshed.json()) as Record<string, unknown>).access_token).not.toBe(tokens.access_token);
  });

  it("refuses a wrong client (401 invalid_client), a mismatched state or redirect URI, and an unknown refresh token", async () => {
    const code = await codeFromConsent();
    expect((await token({ ...client, client_secret: "wrong", grant_type: "authorization_code", code, redirect_uri: MOCK_OAUTH_CLIENT.redirectUri, state: STATE, scope: "openid" })).status).toBe(401);
    expect((await token({ ...client, grant_type: "authorization_code", code, redirect_uri: MOCK_OAUTH_CLIENT.redirectUri, state: "other-state-value-00000", scope: "openid" })).status).toBe(400);
    expect((await token({ ...client, grant_type: "refresh_token", refresh_token: "seats:otr:never-issued" })).status).toBe(400);
    expect((await token({ ...client, grant_type: "password" })).status).toBe(400);
  });

  it("accepts on the Partner API only an access token it issued and that has not expired; other values stay keys", async () => {
    const code = await codeFromConsent();
    const tokens = (await (await token({ ...client, grant_type: "authorization_code", code, redirect_uri: MOCK_OAUTH_CLIENT.redirectUri, state: STATE, scope: "openid" })).json()) as Record<string, string>;
    const ok = await search(`Bearer ${tokens.access_token}`);
    expect(ok.status).toBe(200);
    expect(SearchResponse.safeParse(await ok.json()).success).toBe(true);
    expect((await search("Bearer seats:ota:forged")).status).toBe(401);
    expect((await search("pro_dev_alice_FAKE_SEATS_KEY_a1c3")).status).toBe(200);
    clock += 3600 * 1000;
    try {
      expect((await search(`Bearer ${tokens.access_token}`)).status).toBe(401);
    } finally {
      clock = NOW.getTime();
    }
  });
});

describe("the whole chain: the mock behind the token service", () => {
  /** The Worker's outbound fetch, pointed at the mock's token endpoint instead of seats.aero's. */
  const toMock: Deps = {
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(SEATS_TOKEN_URL);
      return fetch(`${origin}/oauth2/token`, init);
    }) as typeof fetch,
  };
  const env: Env = { SEATS_CLIENT_ID: MOCK_OAUTH_CLIENT.clientId, SEATS_CLIENT_SECRET: MOCK_OAUTH_CLIENT.clientSecret, RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const worker = (path: string, init?: RequestInit) => handle(new Request(`https://awardgrid.dowhiz.com${path}`, init), env, toMock);
  const post = (path: string, body: unknown) => worker(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("consent, callback, exchange, search, refresh, and a revocation the refresh reports as invalid_grant", async () => {
    // 1. seats.aero's consent page sends the browser to the token service's callback (the registered URI)…
    const consented = await consent(goodConsent);
    const toCallback = new URL(consented.headers.get("location")!);
    expect(`${toCallback.origin}${toCallback.pathname}`).toBe(REDIRECT_URI);
    // 2. …which hands the code and state to the app's scheme.
    const callback = await worker(`${toCallback.pathname}${toCallback.search}`);
    expect(callback.status).toBe(302);
    const toApp = new URL(callback.headers.get("location")!);
    expect(`${toApp.protocol}//${toApp.host}${toApp.pathname}`).toBe(APP_CALLBACK);
    expect(toApp.searchParams.get("state")).toBe(STATE);
    // 3. The app exchanges the code through the service, which adds the client and the pinned redirect URI.
    const exchanged = await post(PATHS.token, { code: toApp.searchParams.get("code"), state: STATE });
    expect(exchanged.status).toBe(200);
    const tokens = (await exchanged.json()) as Record<string, string>;
    expect(Object.keys(tokens).sort()).toEqual(["access_token", "expires_in", "refresh_token", "token_type"]);
    // 4. The device searches seats.aero (here, the mock) directly with the Bearer token.
    expect((await search(`Bearer ${tokens.access_token}`)).status).toBe(200);
    // 5. A refresh through the service gives a new access token.
    const refreshed = await post(PATHS.refresh, { refresh_token: tokens.refresh_token });
    expect(refreshed.status).toBe(200);
    const fresh = (await refreshed.json()) as Record<string, string>;
    expect((await search(`Bearer ${fresh.access_token}`)).status).toBe(200);
    // 6. The person removes AwardGrid in seats.aero: the token stops working, and the refresh says invalid_grant.
    mock.revokeOAuth();
    expect((await search(`Bearer ${fresh.access_token}`)).status).toBe(401);
    const revoked = await post(PATHS.refresh, { refresh_token: tokens.refresh_token });
    expect([revoked.status, await revoked.json()]).toEqual([400, { error: "invalid_grant" }]);
  });
});
