/**
 * "Connect seats.aero" (./connect.ts), the token service's client (./broker.ts) and the native sign-in sheet's wrapper
 * (./seats-auth-plugin.ts): every request they make and every outcome they can end with, with seats.aero, the service
 * and the sheet all faked.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeFetch, jsonResponse, textResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { type BrokerResult, TOKEN_SERVICE_URL, createTokenBroker, meansRevoked } from "./broker";
import { CALLBACK_SCHEME, OAUTH_REDIRECT_URI, SEATS_CONSENT_URL, connectSeats, consentUrl, randomState, readCallback } from "./connect";
import { authorizeWithSeats } from "./seats-auth-plugin";

const STATE = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
const callback = (params: Record<string, string>) => `${CALLBACK_SCHEME}://oauth/seats?${new URLSearchParams(params)}`;

describe("the consent URL and the state", () => {
  it("asks seats.aero's consent page for a code, with the client ID, the registered redirect URI, the state and openid", () => {
    const url = new URL(consentUrl("client-123", STATE));
    expect(`${url.origin}${url.pathname}`).toBe(SEATS_CONSENT_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: "code", client_id: "client-123", redirect_uri: OAUTH_REDIRECT_URI, state: STATE, scope: "openid" });
    expect(OAUTH_REDIRECT_URI).toBe("https://awardgrid.dowhiz.com/oauth/seats/callback");
  });

  it("makes a state from 32 random bytes: 43 base64url characters, a new one each time", () => {
    const state = randomState();
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomState()).not.toBe(state);
    expect(randomState((b) => b.fill(255))).toBe("_".repeat(42) + "8");
  });
});

describe("reading the callback", () => {
  it("takes the code from com.dowhiz.awardgrid://oauth/seats when the state is this sign-in's", () => {
    expect(readCallback(callback({ code: "c-1", state: STATE }), STATE)).toEqual({ ok: true, code: "c-1" });
  });

  it("drops an answer for another sign-in, a refusal, and anything not on the app's callback", () => {
    expect(readCallback(callback({ code: "c-1", state: "other" }), STATE)).toEqual({ ok: false, reason: "mismatch" });
    expect(readCallback(callback({ error: "access_denied", state: STATE }), STATE)).toEqual({ ok: false, reason: "denied" });
    expect(readCallback(callback({ state: STATE }), STATE)).toEqual({ ok: false, reason: "failed" });
    expect(readCallback(`https://evil.example/oauth/seats?code=c&state=${STATE}`, STATE)).toEqual({ ok: false, reason: "failed" });
    expect(readCallback(`${CALLBACK_SCHEME}://other/seats?code=c&state=${STATE}`, STATE)).toEqual({ ok: false, reason: "failed" });
    expect(readCallback("not a url", STATE)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("the token service client", () => {
  it("posts {code, state} to /token and {refresh_token} to /refresh, as JSON, over the transport it is given", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push({ url: String(input), method: init?.method, type: new Headers(init?.headers).get("content-type"), body: JSON.parse(String(init?.body)), timeout: (init as { connectTimeout?: number }).connectTimeout });
      return jsonResponse({ access_token: "seats:ota:a", token_type: "Bearer", expires_in: 3599, refresh_token: "seats:otr:r" });
    }) as typeof fetch;
    const broker = createTokenBroker({ fetchImpl });
    expect(await broker.exchange("code-1", STATE)).toEqual({ ok: true, grant: { access: "seats:ota:a", refresh: "seats:otr:r", expiresIn: 3599 } });
    await broker.refresh("seats:otr:r");
    expect(bodies).toEqual([
      { url: `${TOKEN_SERVICE_URL}/token`, method: "POST", type: "application/json", body: { code: "code-1", state: STATE }, timeout: 15000 },
      { url: `${TOKEN_SERVICE_URL}/refresh`, method: "POST", type: "application/json", body: { refresh_token: "seats:otr:r" }, timeout: 15000 },
    ]);
  });

  it("reads a refusal, an outage and a failed request as values", async () => {
    const answer = (status: number, body: unknown) => createTokenBroker({ fetchImpl: fakeFetch(() => jsonResponse(body, status)) });
    expect(await answer(400, { error: "invalid_grant" }).refresh("seats:otr:r")).toEqual({ ok: false, reason: "rejected", status: 400, error: "invalid_grant" });
    expect(await answer(502, { error: "upstream_unavailable" }).refresh("seats:otr:r")).toEqual({ ok: false, reason: "unavailable", status: 502, error: "upstream_unavailable" });
    expect(await answer(429, { error: "rate_limited" }).refresh("seats:otr:r")).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await answer(400, { error: "invalid_request" }).refresh("seats:otr:r")).toMatchObject({ ok: false, reason: "unavailable" });
    // A refusal with no OAuth error code is not seats.aero's: a firewall's 403 page as an earlier service passed it on
    // ("rejected"), or a page that is not JSON at all.
    expect(await answer(403, { error: "rejected" }).refresh("seats:otr:r")).toEqual({ ok: false, reason: "unavailable", status: 403, error: "rejected" });
    const html = createTokenBroker({ fetchImpl: fakeFetch(() => textResponse("<!doctype html><title>Just a moment...</title>", 403)) });
    expect(await html.refresh("seats:otr:r")).toEqual({ ok: false, reason: "unavailable", status: 403, error: null });
    expect(await answer(502, { error: "upstream_blocked" }).refresh("seats:otr:r")).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await answer(401, { error: "invalid_client" }).refresh("seats:otr:r")).toMatchObject({ ok: false, reason: "rejected", error: "invalid_client" });
    // A 200 that is not tokens, or an exchange without a refresh token, is not a grant.
    expect(await answer(200, { access_token: "sk-x", expires_in: 3599 }).refresh("seats:otr:r")).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await answer(200, { access_token: "seats:ota:a", token_type: "Bearer", expires_in: 3599 }).exchange("c", STATE)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await answer(200, { access_token: "seats:ota:a", token_type: "Bearer", expires_in: 3599 }).refresh("seats:otr:r")).toEqual({ ok: true, grant: { access: "seats:ota:a", refresh: null, expiresIn: 3599 } });
    const offline = createTokenBroker({
      fetchImpl: (async () => {
        throw new TypeError("offline");
      }) as typeof fetch,
    });
    expect(await offline.exchange("c", STATE)).toEqual({ ok: false, reason: "network", status: 0, error: null });
  });

  it("only seats.aero's own refusal of the refresh token counts as a revocation", () => {
    const r = (status: number, error: string | null): BrokerResult => ({ ok: false, reason: "rejected", status, error });
    expect(meansRevoked(r(400, "invalid_grant"))).toBe(true);
    expect(meansRevoked(r(401, "invalid_grant"))).toBe(true);
    expect(meansRevoked(r(400, "access_denied"))).toBe(true);
    // A 401 or 403 alone is not: a firewall answers with one too.
    expect(meansRevoked(r(401, null))).toBe(false);
    expect(meansRevoked(r(403, "rejected"))).toBe(false);
    expect(meansRevoked(r(401, "invalid_client"))).toBe(false);
    expect(meansRevoked(r(403, "unauthorized_client"))).toBe(false);
    expect(meansRevoked({ ok: false, reason: "unavailable", status: 502, error: null })).toBe(false);
    expect(meansRevoked({ ok: false, reason: "network", status: 0, error: null })).toBe(false);
  });
});

describe("the native sign-in sheet's wrapper", () => {
  it("passes the URL to the plugin and the callback back; a closed sheet is canceled; no plugin is unavailable", async () => {
    const authorize = vi.fn(async ({ url }: { url: string }) => ({ url: `${url}#back` }));
    expect(await authorizeWithSeats("https://seats.aero/oauth2/consent?x=1", { isAvailable: () => true, plugin: { authorize } })).toEqual({ ok: true, url: "https://seats.aero/oauth2/consent?x=1#back" });
    const cancel = { authorize: async () => Promise.reject(Object.assign(new Error("closed"), { code: "canceled" })) };
    expect(await authorizeWithSeats("u", { isAvailable: () => true, plugin: cancel })).toEqual({ ok: false, reason: "canceled" });
    const broken = { authorize: async () => Promise.reject(new Error("boom")) };
    expect(await authorizeWithSeats("u", { isAvailable: () => true, plugin: broken })).toEqual({ ok: false, reason: "failed" });
    expect(await authorizeWithSeats("u", { isAvailable: () => false, plugin: { authorize } })).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("connectSeats", () => {
  const grant: BrokerResult = { ok: true, grant: { access: "seats:ota:a", refresh: "seats:otr:r", expiresIn: 3599 } };
  function deps(over: Partial<Parameters<typeof connectSeats>[0]> = {}) {
    const save = vi.fn(async () => {});
    const exchange = vi.fn(async () => grant);
    const opened: string[] = [];
    const d: Parameters<typeof connectSeats>[0] = {
      clientId: "client-123",
      state: () => STATE,
      authorize: async (url) => {
        opened.push(url);
        return { ok: true, url: callback({ code: "code-1", state: STATE }) };
      },
      broker: { exchange, refresh: vi.fn() },
      store: { save },
      ...over,
    };
    return { d, save, exchange, opened };
  }

  it("opens the consent page, checks the state, exchanges the code and saves the tokens", async () => {
    const { d, save, exchange, opened } = deps();
    expect(await connectSeats(d)).toEqual({ ok: true });
    expect(opened).toEqual([consentUrl("client-123", STATE)]);
    expect(exchange).toHaveBeenCalledWith("code-1", STATE);
    expect(save).toHaveBeenCalledWith({ access: "seats:ota:a", refresh: "seats:otr:r", expiresIn: 3599 });
  });

  it("ends without saving anything, saying why, at each step that can fail", async () => {
    const cases: Array<[Partial<Parameters<typeof connectSeats>[0]>, string]> = [
      [{ clientId: "" }, "not_configured"],
      [{ authorize: async () => ({ ok: false, reason: "canceled" }) }, "canceled"],
      [{ authorize: async () => ({ ok: false, reason: "unavailable" }) }, "unavailable"],
      [{ authorize: async () => ({ ok: true, url: callback({ error: "access_denied", state: STATE }) }) }, "denied"],
      [{ authorize: async () => ({ ok: true, url: callback({ code: "c", state: "someone-else" }) }) }, "mismatch"],
      [{ broker: { exchange: async () => ({ ok: false, reason: "rejected", status: 400, error: "invalid_grant" }), refresh: vi.fn() } }, "rejected"],
      [{ broker: { exchange: async () => ({ ok: false, reason: "network", status: 0, error: null }), refresh: vi.fn() } }, "network"],
      [{ broker: { exchange: async () => ({ ok: false, reason: "unavailable", status: 502, error: null }), refresh: vi.fn() } }, "service"],
      [{ broker: { exchange: async () => ({ ok: true, grant: { access: "seats:ota:a", refresh: null, expiresIn: 3599 } }), refresh: vi.fn() } }, "service"],
    ];
    for (const [over, reason] of cases) {
      const { d, save } = deps(over);
      expect(await connectSeats(d), reason).toEqual({ ok: false, reason });
      expect(save).not.toHaveBeenCalled();
    }
    const failingSave = deps({ store: { save: async () => Promise.reject(new Error("keychain says no")) } });
    expect(await connectSeats(failingSave.d)).toEqual({ ok: false, reason: "keychain" });
  });
});
