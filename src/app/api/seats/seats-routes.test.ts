/**
 * Route-handler tests for /api/seats/connect, /api/seats/oauth/callback, /api/seats/connection and /api/seats/notice
 * against an in-memory SQLite (getServerDb mocked). The token service is a stubbed global fetch: no request leaves.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { openTestDb, type Db } from "@/lib/db/client";
import { availabilityCache, seatsOauthStates, users } from "@/lib/db/schema";
import { seedUsers } from "@/lib/db/stores/testing";
import { resetMasterKeyCache } from "@/lib/keys";
import { isSeatsConnected, readConnection } from "@/lib/seats-oauth/store";
import { connectForTests } from "@/lib/seats-oauth/testing";

let db: Db;
vi.mock("@/lib/server/db", () => ({ getServerDb: () => db }));

const { POST: connect } = await import("./connect/route");
const { GET: callback } = await import("./oauth/callback/route");
const { DELETE: disconnect } = await import("./connection/route");
const { DELETE: dismiss } = await import("./notice/route");

const MASTER_HEX = "5a".repeat(32);
const MASTER = Buffer.from(MASTER_HEX, "hex");
const CLIENT_ID = "seats:cid:test-client";
const ACCESS = "seats:ota:route-test-access";
const REFRESH = "seats:otr:route-test-refresh";

let aliceToken: string;

function req(path: string, init: { method?: string; token?: string; json?: boolean; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (init.json !== false && init.method && init.method !== "GET") headers["content-type"] = "application/json";
  if (init.token) headers.cookie = `${SESSION_COOKIE}=${init.token}`;
  return new NextRequest(`http://localhost${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

/** The token service: answers /token with `status` and `body`, records what it was sent. */
function tokenService(status = 200, body: unknown = { access_token: ACCESS, token_type: "Bearer", expires_in: 3599, refresh_token: REFRESH }) {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "null")) });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

beforeEach(() => {
  db = openTestDb();
  seedUsers(db, ["alice", "bob"]);
  aliceToken = createSession(db, "alice").token;
  process.env.MASTER_KEY = MASTER_HEX;
  process.env.SEATS_OAUTH_CLIENT_ID = CLIENT_ID;
  resetMasterKeyCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network access is not allowed in tests");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MASTER_KEY;
  delete process.env.SEATS_OAUTH_CLIENT_ID;
  resetMasterKeyCache();
});

async function startConnect(): Promise<string> {
  const res = await connect(req("/api/seats/connect", { method: "POST", token: aliceToken, body: {} }));
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  return new URL(url).searchParams.get("state")!;
}

describe("POST /api/seats/connect", () => {
  it("answers seats.aero's consent URL with a fresh web state for this account, and stores only its hash", async () => {
    const res = await connect(req("/api/seats/connect", { method: "POST", token: aliceToken, body: {} }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const url = new URL(((await res.json()) as { url: string }).url);
    expect(`${url.origin}${url.pathname}`).toBe("https://seats.aero/oauth2/consent");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("https://awardgrid.dowhiz.com/oauth/seats/callback");
    expect(url.searchParams.get("scope")).toBe("openid");
    expect(url.searchParams.get("state")).toMatch(/^web_[A-Za-z0-9_-]{43}$/);
    const rows = db.select().from(seatsOauthStates).all();
    expect(rows.map((r) => r.userId)).toEqual(["alice"]);
    expect(JSON.stringify(rows)).not.toContain(url.searchParams.get("state")!);
  });

  it("401 without a session, 400 without a JSON body, 503 not_configured without a client ID", async () => {
    expect((await connect(req("/api/seats/connect", { method: "POST", body: {} }))).status).toBe(401);
    expect((await connect(req("/api/seats/connect", { method: "POST", token: aliceToken, json: false }))).status).toBe(400);
    delete process.env.SEATS_OAUTH_CLIENT_ID;
    const res = await connect(req("/api/seats/connect", { method: "POST", token: aliceToken, body: {} }));
    expect([res.status, await res.json()]).toEqual([503, { error: "not_configured" }]);
    expect(db.select().from(seatsOauthStates).all()).toEqual([]);
  });
});

describe("GET /api/seats/oauth/callback", () => {
  it("exchanges the code through the token service, stores the tokens encrypted and lands on Settings", async () => {
    const state = await startConnect();
    const calls = tokenService();
    const res = await callback(req(`/api/seats/oauth/callback?code=the-code&state=${state}`, { token: aliceToken }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/settings?seats=connected#seats");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(calls).toEqual([{ url: "https://awardgrid.dowhiz.com/oauth/seats/token", body: { code: "the-code", state } }]);
    expect(readConnection(db, "alice", MASTER)?.tokens).toMatchObject({ access: ACCESS, refresh: REFRESH });
    expect(await res.text()).toBe("");
  });

  it("a code for another account's sign-in, or a replayed one, is never exchanged", async () => {
    const state = await startConnect();
    const calls = tokenService();
    const bobToken = createSession(db, "bob").token;
    const asBob = await callback(req(`/api/seats/oauth/callback?code=c&state=${state}`, { token: bobToken }));
    expect(asBob.headers.get("location")).toBe("/settings?seats=mismatch#seats");
    expect(isSeatsConnected(db, "bob")).toBe(false);
    const first = await callback(req(`/api/seats/oauth/callback?code=c&state=${state}`, { token: aliceToken }));
    expect(first.headers.get("location")).toBe("/settings?seats=connected#seats");
    const replay = await callback(req(`/api/seats/oauth/callback?code=c&state=${state}`, { token: aliceToken }));
    expect(replay.headers.get("location")).toBe("/settings?seats=mismatch#seats");
    expect(calls).toHaveLength(1);
  });

  it("says a refusal on seats.aero's page as denied, and a refused code as rejected", async () => {
    tokenService(400, { error: "invalid_grant" });
    const denied = await callback(req(`/api/seats/oauth/callback?error=access_denied&state=${await startConnect()}`, { token: aliceToken }));
    expect(denied.headers.get("location")).toBe("/settings?seats=denied#seats");
    const rejected = await callback(req(`/api/seats/oauth/callback?code=c&state=${await startConnect()}`, { token: aliceToken }));
    expect(rejected.headers.get("location")).toBe("/settings?seats=rejected#seats");
    expect(isSeatsConnected(db, "alice")).toBe(false);
  });

  it("without a session the code cannot be tied to an account: to the login page, nothing exchanged", async () => {
    const state = await startConnect();
    const calls = tokenService();
    const res = await callback(req(`/api/seats/oauth/callback?code=c&state=${state}`));
    expect([res.status, res.headers.get("location")]).toEqual([303, "/login"]);
    expect(calls).toEqual([]);
  });
});

describe("DELETE /api/seats/connection", () => {
  it("deletes the tokens and the sign-ins under way, and purges the account's seats.aero results (only its own)", async () => {
    connectForTests(db, "alice", { masterKey: MASTER });
    connectForTests(db, "bob", { masterKey: MASTER });
    await startConnect();
    for (const userId of ["alice", "bob"]) {
      db.insert(availabilityCache)
        .values({ userId, program: "alaska", origin: "HKG", dest: "SEA", date: "2026-10-20", cabin: "J", miles: 1, computedLastSeen: "2026-10-08T00:00:00Z", sourceId: "s", fetchedAt: new Date().toISOString() })
        .run();
    }
    const res = await disconnect(req("/api/seats/connection", { method: "DELETE", token: aliceToken }));
    expect(res.status).toBe(204);
    expect(isSeatsConnected(db, "alice")).toBe(false);
    expect(isSeatsConnected(db, "bob")).toBe(true);
    expect(db.select().from(seatsOauthStates).all()).toEqual([]);
    expect(db.select().from(availabilityCache).all().map((r) => r.userId)).toEqual(["bob"]);
    expect((await disconnect(req("/api/seats/connection", { method: "DELETE", token: aliceToken }))).status).toBe(204);
    expect((await disconnect(req("/api/seats/connection", { method: "DELETE" }))).status).toBe(401);
  });
});

describe("DELETE /api/seats/notice", () => {
  it("clears the one-time notice for the caller only", async () => {
    db.update(users).set({ seatsReconnectNotice: true }).run();
    expect((await dismiss(req("/api/seats/notice", { method: "DELETE", token: aliceToken }))).status).toBe(204);
    const flags = db.select({ id: users.id, notice: users.seatsReconnectNotice }).from(users).all();
    expect(flags).toEqual([
      { id: "alice", notice: false },
      { id: "bob", notice: true },
    ]);
    expect((await dismiss(req("/api/seats/notice", { method: "DELETE" }))).status).toBe(401);
    expect(db.select().from(users).where(eq(users.id, "bob")).get()?.seatsReconnectNotice).toBe(true);
  });
});
