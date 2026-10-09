/**
 * Login with Seats.aero in the web app, end to end through the real token service (sites/auth/src/index.ts handle()),
 * with seats.aero played by the local mock (scripts/mock-seatsaero.ts on 127.0.0.1): Connect → seats.aero's consent
 * → the Worker's callback, which sends a web state to the web app's address → the web app's finishConnect → the
 * exchange through the Worker → a search with the Bearer token → a refresh through the Worker after the hour → the
 * person revoking AwardGrid → the next refresh purges the account. The iPhone app's state, through the same Worker,
 * still goes to its scheme. No request leaves the machine.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_CALLBACK, type Deps, type Env, REDIRECT_URI, SEATS_TOKEN_URL, WEB_CALLBACK, handle } from "../../sites/auth/src/index";
import { MOCK_OAUTH_CLIENT, type MockHandle, createMockServer } from "../../scripts/mock-seatsaero";
import { openTestDb } from "@/lib/db/client";
import { availabilityCache } from "@/lib/db/schema";
import { seedUsers } from "@/lib/db/stores/testing";
import { findGridForUser } from "@/lib/server/find";
import { SeatsNotConnectedError, beginConnect, consentUrl, createTokenBroker, finishConnect, isSeatsConnected } from "@/lib/seats-oauth";
import { readConnection } from "@/lib/seats-oauth/store";
import { SEATS_AERO_BASE_URL } from "@awardgrid/core/seatsaero/client";
import { QueryObject } from "@awardgrid/core/query/schema";

const MASTER = Buffer.alloc(32, 4);
const T0 = new Date("2026-10-08T12:00:00Z");
let clock = T0.getTime();
const now = () => new Date(clock);
let mock: MockHandle;
let origin: string;

beforeAll(async () => {
  // The mock client is registered with the production redirect URI: the Worker pins it, as it does in production.
  mock = await createMockServer({ port: 0, now, log: () => {}, oauth: { redirectUri: REDIRECT_URI } });
  origin = `http://127.0.0.1:${mock.port}`;
});
afterAll(async () => {
  await mock.close();
});

const env: Env = {
  SEATS_CLIENT_ID: MOCK_OAUTH_CLIENT.clientId,
  SEATS_CLIENT_SECRET: MOCK_OAUTH_CLIENT.clientSecret,
  RATE_LIMITER: { limit: async () => ({ success: true }) },
};
/** The Worker's one outbound call, seats.aero's token endpoint, lands on the mock. */
const workerDeps: Deps = {
  fetch: ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url !== SEATS_TOKEN_URL) throw new Error(`the Worker called ${url}`);
    return fetch(`${origin}/oauth2/token`, init);
  }) as typeof fetch,
};
/** The web server's calls to the token service go to the Worker's handler. */
const toWorker = (async (input: string | URL | Request, init?: RequestInit) =>
  handle(new Request(String(input), { ...init, headers: { ...(init?.headers as Record<string, string>), "cf-connecting-ip": "203.0.113.9" } }), env, workerDeps)) as typeof fetch;
const broker = createTokenBroker({ baseUrl: "https://awardgrid.dowhiz.com/oauth/seats", fetch: toWorker });
/** The web server's seats.aero calls go to the mock's Partner API. */
const seatsFetch = ((input: string | URL | Request, init?: RequestInit) => fetch(String(input).replace(SEATS_AERO_BASE_URL, mock.baseUrl), init)) as typeof fetch;
const config = { clientId: MOCK_OAUTH_CLIENT.clientId, consentUrl: "https://seats.aero/oauth2/consent", redirectUri: REDIRECT_URI, tokenServiceUrl: "https://awardgrid.dowhiz.com/oauth/seats" };

const today = T0.toISOString().slice(0, 10);
const query = QueryObject.parse({ origins: ["HKG"], destinations: ["SEA"], date_from: today, date_to: today, cabins: ["J"], raw_text: "HKG to SEA", language: "en" });

/** What the browser does: open the consent URL (the mock answers at once), follow it to the Worker's callback. */
async function signIn(url: string): Promise<URL> {
  const consent = new URL(url);
  const atSeats = await fetch(`${origin}/oauth2/consent${consent.search}`, { redirect: "manual" });
  expect(atSeats.status).toBe(302);
  const toWorkerCallback = new URL(atSeats.headers.get("location")!);
  expect(`${toWorkerCallback.origin}${toWorkerCallback.pathname}`).toBe(REDIRECT_URI);
  const atWorker = await handle(new Request(toWorkerCallback, { headers: { "cf-connecting-ip": "203.0.113.9" } }), env, workerDeps);
  expect(atWorker.status).toBe(302);
  return new URL(atWorker.headers.get("location")!);
}

describe("the web app's Login with Seats.aero, through the real token service", () => {
  const db = openTestDb();
  seedUsers(db, ["alice"]);

  it("connects: a web state comes back to the web app's address, and the code is exchanged through the Worker", async () => {
    const state = beginConnect(db, "alice", { now: now() });
    const back = await signIn(consentUrl(config, state));
    expect(`${back.origin}${back.pathname}`).toBe(WEB_CALLBACK);
    expect(back.searchParams.get("state")).toBe(state);
    expect(await finishConnect(db, "alice", back.searchParams, { now, masterKey: MASTER, broker, config })).toBe("connected");
    expect(readConnection(db, "alice", MASTER)?.tokens.access).toMatch(/^seats:ota:mock/);
  });

  it("searches with the Bearer token the mock issued", async () => {
    const res = await findGridForUser(db, { id: "alice" }, query, { now, fetch: seatsFetch, masterKey: MASTER, tokenBroker: broker });
    expect(res.grid.meta.api_calls_used).toBeGreaterThan(0);
  });

  it("renews through the Worker once the hour is nearly up, and searches with the new token", async () => {
    const before = readConnection(db, "alice", MASTER)!.tokens.access;
    clock += 56 * 60_000;
    const res = await findGridForUser(db, { id: "alice" }, { ...query, cabins: ["F"] }, { now, fetch: seatsFetch, masterKey: MASTER, tokenBroker: broker });
    expect(res.grid.meta.api_calls_used).toBeGreaterThan(0);
    const after = readConnection(db, "alice", MASTER)!.tokens.access;
    expect(after).not.toBe(before);
  });

  it("after the person revokes AwardGrid, the next renewal purges the account and asks to connect again", async () => {
    expect(db.select().from(availabilityCache).all().length).toBeGreaterThan(0);
    mock.revokeOAuth();
    clock += 56 * 60_000;
    await expect(findGridForUser(db, { id: "alice" }, query, { now, fetch: seatsFetch, masterKey: MASTER, tokenBroker: broker })).rejects.toBeInstanceOf(SeatsNotConnectedError);
    expect(isSeatsConnected(db, "alice")).toBe(false);
    expect(db.select().from(availabilityCache).all()).toEqual([]);
  });

  it("the iPhone app's sign-in, through the same Worker, still goes to its scheme", async () => {
    const iosState = "s1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u";
    const back = await signIn(consentUrl(config, iosState));
    expect(back.protocol).toBe("com.dowhiz.awardgrid:");
    expect(`${back.protocol}//${back.host}${back.pathname}`).toBe(APP_CALLBACK);
  });
});
