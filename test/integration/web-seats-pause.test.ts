/**
 * The owner's pause switch for the web app's Login with Seats.aero (SEATS_OAUTH_WEB=off, src/lib/seats-oauth/pause.ts),
 * end to end through the real token service (sites/auth/src/index.ts handle()) with seats.aero played by the local mock
 * (scripts/mock-seatsaero.ts on 127.0.0.1), as test/integration/web-seats-oauth.test.ts does for connecting:
 *
 *   on    alice connects through the Worker and searches; her results are cached
 *   off   her search, even one due a renewal, sends nothing to seats.aero or the token service; the purge removes her
 *         tokens and results; a sign-in she started before the pause comes back through the Worker and is not
 *         exchanged; nothing she can do reaches seats.aero
 *   on    again: she connects and searches as before
 *
 * Every request seats.aero (the mock) and the token service (the Worker) receive is counted. No request leaves the
 * machine.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Deps, type Env, REDIRECT_URI, SEATS_TOKEN_URL, WEB_CALLBACK, handle } from "../../sites/auth/src/index";
import { MOCK_OAUTH_CLIENT, type MockHandle, createMockServer } from "../../scripts/mock-seatsaero";
import { openTestDb } from "@/lib/db/client";
import { availabilityCache, cacheCoverage, routesCache, seatsConnections, seatsOauthStates } from "@/lib/db/schema";
import { seedUsers } from "@/lib/db/stores/testing";
import { findGridForUser } from "@/lib/server/find";
import { SeatsPausedError, beginConnect, consentUrl, createTokenBroker, finishConnect, isSeatsConnected, purgeForPause } from "@/lib/seats-oauth";
import { SEATS_AERO_BASE_URL } from "@awardgrid/core/seatsaero/client";
import { QueryObject } from "@awardgrid/core/query/schema";

const MASTER = Buffer.alloc(32, 5);
const T0 = new Date("2026-10-13T12:00:00Z");
let clock = T0.getTime();
const now = () => new Date(clock);
let mock: MockHandle;
let origin: string;
/** Every line the mock logs: one per request it answered. */
const mockLines: string[] = [];

beforeAll(async () => {
  mock = await createMockServer({ port: 0, now, log: (line) => mockLines.push(line), oauth: { redirectUri: REDIRECT_URI } });
  origin = `http://127.0.0.1:${mock.port}`;
});
afterAll(async () => {
  await mock.close();
});
afterEach(() => {
  delete process.env.SEATS_OAUTH_WEB;
});

const env: Env = {
  SEATS_CLIENT_ID: MOCK_OAUTH_CLIENT.clientId,
  SEATS_CLIENT_SECRET: MOCK_OAUTH_CLIENT.clientSecret,
  RATE_LIMITER: { limit: async () => ({ success: true }) },
};
const workerDeps: Deps = {
  fetch: ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url !== SEATS_TOKEN_URL) throw new Error(`the Worker called ${url}`);
    return fetch(`${origin}/oauth2/token`, init);
  }) as typeof fetch,
};
/** The web server's calls to the token service, counted. */
let tokenServiceCalls = 0;
const toWorker = (async (input: string | URL | Request, init?: RequestInit) => {
  tokenServiceCalls += 1;
  return handle(new Request(String(input), { ...init, headers: { ...(init?.headers as Record<string, string>), "cf-connecting-ip": "203.0.113.9" } }), env, workerDeps);
}) as typeof fetch;
const broker = createTokenBroker({ baseUrl: "https://awardgrid.dowhiz.com/oauth/seats", fetch: toWorker });
/** The web server's seats.aero calls, counted, go to the mock's Partner API. */
let seatsCalls = 0;
const seatsFetch = ((input: string | URL | Request, init?: RequestInit) => {
  seatsCalls += 1;
  return fetch(String(input).replace(SEATS_AERO_BASE_URL, mock.baseUrl), init);
}) as typeof fetch;
const config = { clientId: MOCK_OAUTH_CLIENT.clientId, consentUrl: "https://seats.aero/oauth2/consent", redirectUri: REDIRECT_URI, tokenServiceUrl: "https://awardgrid.dowhiz.com/oauth/seats" };

const today = T0.toISOString().slice(0, 10);
const query = QueryObject.parse({ origins: ["HKG"], destinations: ["SEA"], date_from: today, date_to: today, cabins: ["J"], raw_text: "HKG to SEA", language: "en" });

/** What the browser does: open the consent URL (the mock answers at once), follow it through the Worker's callback. */
async function signIn(url: string): Promise<URL> {
  const consent = new URL(url);
  const atSeats = await fetch(`${origin}/oauth2/consent${consent.search}`, { redirect: "manual" });
  expect(atSeats.status).toBe(302);
  const atWorker = await handle(new Request(new URL(atSeats.headers.get("location")!), { headers: { "cf-connecting-ip": "203.0.113.9" } }), env, workerDeps);
  expect(atWorker.status).toBe(302);
  return new URL(atWorker.headers.get("location")!);
}

/** Requests that reached seats.aero's token endpoint or Partner API (the consent page is the browser's own visit). */
function seatsServerHits(): number {
  return mockLines.filter((line) => line.includes("/partnerapi/") || line.includes("/oauth2/token")).length;
}

describe("SEATS_OAUTH_WEB=off, through the real token service and the seats.aero mock", () => {
  const db = openTestDb();
  seedUsers(db, ["alice"]);
  const findOpts = { now, fetch: seatsFetch, masterKey: MASTER, tokenBroker: broker };

  it("on: alice connects and searches; her results are cached", async () => {
    const state = beginConnect(db, "alice", { now: now() });
    const back = await signIn(consentUrl(config, state));
    expect(`${back.origin}${back.pathname}`).toBe(WEB_CALLBACK);
    expect(await finishConnect(db, "alice", back.searchParams, { now, masterKey: MASTER, broker, config })).toBe("connected");
    const res = await findGridForUser(db, { id: "alice" }, query, findOpts);
    expect(res.grid.meta.api_calls_used).toBeGreaterThan(0);
    expect(db.select().from(availabilityCache).all().length).toBeGreaterThan(0);
  });

  it("off: nothing reaches seats.aero or the token service, the purge empties the server, a sign-in coming back is not exchanged", async () => {
    // A sign-in alice started before the pause.
    const pending = beginConnect(db, "alice", { now: now() });
    const before = { seats: seatsCalls, token: tokenServiceCalls, hits: seatsServerHits() };
    process.env.SEATS_OAUTH_WEB = "off";

    await expect(findGridForUser(db, { id: "alice" }, query, findOpts)).rejects.toBeInstanceOf(SeatsPausedError);
    // Even with the access token about to run out, nothing is renewed.
    clock += 56 * 60_000;
    await expect(findGridForUser(db, { id: "alice" }, { ...query, cabins: ["F"] }, findOpts)).rejects.toBeInstanceOf(SeatsPausedError);

    const purged = purgeForPause(db, now());
    expect(purged).toMatchObject({ connections: 1, states: 1 });
    expect(purged.rows).toBeGreaterThan(0);
    for (const table of [seatsConnections, seatsOauthStates, availabilityCache, cacheCoverage, routesCache]) expect(db.select().from(table).all()).toEqual([]);

    // The pending sign-in comes back through the Worker to the web app's address, and is not exchanged.
    const back = await signIn(consentUrl(config, pending));
    expect(`${back.origin}${back.pathname}`).toBe(WEB_CALLBACK);
    expect(await finishConnect(db, "alice", back.searchParams, { now, masterKey: MASTER, broker, config })).toBe("paused");
    expect(isSeatsConnected(db, "alice")).toBe(false);

    expect({ seats: seatsCalls, token: tokenServiceCalls, hits: seatsServerHits() }).toEqual(before);
  });

  it("on again: alice connects and searches as before", async () => {
    const state = beginConnect(db, "alice", { now: now() });
    const back = await signIn(consentUrl(config, state));
    expect(await finishConnect(db, "alice", back.searchParams, { now, masterKey: MASTER, broker, config })).toBe("connected");
    const res = await findGridForUser(db, { id: "alice" }, query, findOpts);
    expect(res.grid.meta.api_calls_used).toBeGreaterThan(0);
  });
});
