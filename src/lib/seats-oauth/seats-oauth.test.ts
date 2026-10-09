/**
 * Login with Seats.aero in the web app (src/lib/seats-oauth): the state, the encrypted token store, the token service
 * client, renewal (early, single-flight, across processes, revocation), connecting, short-term caching, and migration
 * 0005. In-memory SQLite, a fake token service and fake clocks: nothing reaches the network.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, openTestDb, type Db } from "@/lib/db/client";
import { availabilityCache, cacheCoverage, queryRuns, routesCache, savedQueries, seatsConnections, seatsOauthStates, userKeys, users } from "@/lib/db/schema";
import { seedUsers } from "@/lib/db/stores/testing";
import { SeatsNotConnectedError, renewSeatsAuthorization, seatsAuthorization, withSeatsAuthorization } from "./access";
import { type BrokerResult, type TokenBroker, createTokenBroker, meansRevoked } from "./broker";
import { OAUTH_REDIRECT_URI, SEATS_CONSENT_URL, TOKEN_SERVICE_URL, consentUrl, safeAddress, seatsOAuthConfigFromEnv } from "./config";
import { finishConnect } from "./connect";
import { SHORT_TERM_MAX_AGE_MS, purgeSeatsDataForUser, sweepSeatsData } from "./retention";
import { MAX_PENDING_STATES, STATE_TTL_MS, WEB_STATE_RE, beginConnect, consumeState, hashState, randomWebState } from "./state";
import { connectionStatus, isSeatsConnected, readConnection, reconnectNoticeDue, saveConnection, tokenAad, writeRefreshed } from "./store";
import { connectForTests } from "./testing";
import { SeatsAeroHttpError } from "@awardgrid/core/seatsaero/client";

const MASTER = Buffer.alloc(32, 9);
const T0 = new Date("2026-10-08T12:00:00.000Z");
const ACCESS = "seats:ota:alice-access-1";
const REFRESH = "seats:otr:alice-refresh-1";

function db(): Db {
  const d = openTestDb();
  seedUsers(d, ["alice", "bob"]);
  return d;
}

const NOT_USED = async (): Promise<BrokerResult> => {
  throw new Error("the token service was not expected to be called");
};

/** A token service whose refresh answers with `answers` in turn, recording what it was sent. */
function broker(...answers: BrokerResult[]): TokenBroker & { refreshed: string[]; exchanged: Array<[string, string]> } {
  const refreshed: string[] = [];
  const exchanged: Array<[string, string]> = [];
  return {
    refreshed,
    exchanged,
    async exchange(code, state) {
      exchanged.push([code, state]);
      return answers.shift() ?? { ok: false, reason: "unavailable", status: 502, error: null };
    },
    async refresh(token) {
      refreshed.push(token);
      return answers.shift() ?? { ok: false, reason: "unavailable", status: 502, error: null };
    },
  };
}

const fresh = (access: string, refresh: string | null = null, expiresIn = 3599): BrokerResult => ({ ok: true, grant: { access, refresh, expiresIn } });
const revoked: BrokerResult = { ok: false, reason: "rejected", status: 400, error: "invalid_grant" };

describe("config", () => {
  it("needs a client ID; everything else defaults to seats.aero and the token service", () => {
    expect(seatsOAuthConfigFromEnv({})).toBeNull();
    expect(seatsOAuthConfigFromEnv({ SEATS_OAUTH_CLIENT_ID: "  " })).toBeNull();
    expect(seatsOAuthConfigFromEnv({ SEATS_OAUTH_CLIENT_ID: "seats:cid:abc" })).toEqual({
      clientId: "seats:cid:abc",
      consentUrl: SEATS_CONSENT_URL,
      redirectUri: OAUTH_REDIRECT_URI,
      tokenServiceUrl: TOKEN_SERVICE_URL,
    });
  });

  it("takes an override only when it is https, or http on a loopback host", () => {
    expect(safeAddress("http://127.0.0.1:3999/oauth2/consent", "d")).toBe("http://127.0.0.1:3999/oauth2/consent");
    expect(safeAddress("https://example.test/x/", "d")).toBe("https://example.test/x");
    for (const bad of ["http://evil.example/x", "javascript:alert(1)", "https://user:pw@example.test/", "not a url", "https://example.test/#frag"]) {
      expect(safeAddress(bad, "d"), bad).toBe("d");
    }
  });

  it("builds seats.aero's consent URL with the registered redirect URI and scope openid", () => {
    const url = new URL(consentUrl({ clientId: "seats:cid:abc", consentUrl: SEATS_CONSENT_URL, redirectUri: OAUTH_REDIRECT_URI }, "web_state"));
    expect(`${url.origin}${url.pathname}`).toBe(SEATS_CONSENT_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: "code", client_id: "seats:cid:abc", redirect_uri: OAUTH_REDIRECT_URI, state: "web_state", scope: "openid" });
  });
});

describe("state", () => {
  it("is web_ and 43 base64url characters, the shape the token service sends to the web app", () => {
    const state = randomWebState();
    expect(state).toMatch(WEB_STATE_RE);
    expect(state).toHaveLength(47);
    expect(randomWebState()).not.toBe(state);
  });

  it("is accepted once, for the account that started it, within its lifetime; only its hash is stored", () => {
    const d = db();
    const state = beginConnect(d, "alice", { now: T0 });
    expect(JSON.stringify(d.select().from(seatsOauthStates).all())).not.toContain(state);
    expect(d.select().from(seatsOauthStates).get()?.stateHash).toBe(hashState(state));
    expect(consumeState(d, "bob", state, { now: T0 })).toBe("unknown");
    expect(consumeState(d, "alice", state, { now: T0 })).toBe("ok");
    expect(consumeState(d, "alice", state, { now: T0 })).toBe("unknown");
    const late = beginConnect(d, "alice", { now: T0 });
    expect(consumeState(d, "alice", late, { now: new Date(T0.getTime() + STATE_TTL_MS + 1) })).toBe("expired");
    expect(consumeState(d, "alice", "web_short", { now: T0 })).toBe("unknown");
  });

  it("keeps at most a few sign-ins under way per account, and drops expired ones", () => {
    const d = db();
    const states = Array.from({ length: MAX_PENDING_STATES + 2 }, (_, i) => beginConnect(d, "alice", { now: new Date(T0.getTime() + i * 1000) }));
    expect(d.select().from(seatsOauthStates).all()).toHaveLength(MAX_PENDING_STATES);
    expect(consumeState(d, "alice", states[0]!, { now: T0 })).toBe("unknown");
    expect(consumeState(d, "alice", states.at(-1)!, { now: T0 })).toBe("ok");
    beginConnect(d, "bob", { now: new Date(T0.getTime() + STATE_TTL_MS + 60_000) });
    expect(d.select().from(seatsOauthStates).all().map((r) => r.userId)).toEqual(["bob"]);
  });
});

describe("store", () => {
  it("encrypts both tokens, sealed to the account: a row copied to another account does not open", () => {
    const d = db();
    saveConnection(d, "alice", { access: ACCESS, refresh: REFRESH, expiresIn: 3600 }, { masterKey: MASTER, now: T0 });
    const row = d.select().from(seatsConnections).get()!;
    expect(JSON.stringify(row)).not.toContain("seats:ot");
    expect(row.expiresAt).toBe(new Date(T0.getTime() + 3600_000).toISOString());
    expect(readConnection(d, "alice", MASTER)).toEqual({ tokens: { access: ACCESS, refresh: REFRESH, expiresAt: T0.getTime() + 3600_000 }, generation: 1 });
    expect(readConnection(d, "alice", Buffer.alloc(32, 1))).toBeNull();
    d.insert(seatsConnections).values({ ...row, userId: "bob" }).run();
    expect(isSeatsConnected(d, "bob")).toBe(true);
    expect(readConnection(d, "bob", MASTER)).toBeNull();
    expect(tokenAad("alice")).not.toBe(tokenAad("bob"));
  });

  it("refuses anything but seats.aero's token shapes", () => {
    const d = db();
    expect(() => saveConnection(d, "alice", { access: "sk-live-x", refresh: REFRESH, expiresIn: 60 }, { masterKey: MASTER })).toThrow(RangeError);
    expect(() => saveConnection(d, "alice", { access: ACCESS, refresh: "seats:ota:x", expiresIn: 60 }, { masterKey: MASTER })).toThrow(RangeError);
    expect(isSeatsConnected(d, "alice")).toBe(false);
  });

  it("moves the generation on every write; a refresh writes only over the generation it read", () => {
    const d = db();
    expect(saveConnection(d, "alice", { access: ACCESS, refresh: REFRESH, expiresIn: 60 }, { masterKey: MASTER, now: T0 })).toBe(1);
    const tokens = { access: "seats:ota:new", refresh: REFRESH, expiresAt: T0.getTime() + 3600_000 };
    expect(writeRefreshed(d, "alice", 1, tokens, { masterKey: MASTER, now: T0 })).toBe(true);
    expect(writeRefreshed(d, "alice", 1, { ...tokens, access: "seats:ota:stale" }, { masterKey: MASTER, now: T0 })).toBe(false);
    expect(readConnection(d, "alice", MASTER)).toMatchObject({ tokens: { access: "seats:ota:new" }, generation: 2 });
    // Connecting again moves it too, and clears the one-time notice.
    d.update(users).set({ seatsReconnectNotice: true }).where(eq(users.id, "alice")).run();
    expect(saveConnection(d, "alice", { access: ACCESS, refresh: REFRESH, expiresIn: 60 }, { masterKey: MASTER, now: T0 })).toBe(3);
    expect(d.select().from(users).where(eq(users.id, "alice")).get()?.seatsReconnectNotice).toBe(false);
    expect(connectionStatus(d, "alice")).toEqual({ connected: true, connectedAt: T0.toISOString() });
  });

  it("says the one-time notice only while the account is not connected", () => {
    const d = db();
    d.update(users).set({ seatsReconnectNotice: true }).where(eq(users.id, "alice")).run();
    expect(reconnectNoticeDue(d, "alice")).toBe(true);
    expect(reconnectNoticeDue(d, "bob")).toBe(false);
    connectForTests(d, "alice", { masterKey: MASTER });
    expect(reconnectNoticeDue(d, "alice")).toBe(false);
  });
});

describe("token service client", () => {
  function service(status: number, body: unknown) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }) as typeof fetch;
    return { calls, client: createTokenBroker({ baseUrl: "https://awardgrid.dowhiz.com/oauth/seats/", fetch: fetchImpl }) };
  }

  it("sends the code and state, or the refresh token, and nothing else", async () => {
    const s = service(200, { access_token: ACCESS, token_type: "Bearer", expires_in: 3599, refresh_token: REFRESH });
    expect(await s.client.exchange("code1", "web_x")).toEqual({ ok: true, grant: { access: ACCESS, refresh: REFRESH, expiresIn: 3599 } });
    expect(s.calls[0]!.url).toBe("https://awardgrid.dowhiz.com/oauth/seats/token");
    expect(JSON.parse(String(s.calls[0]!.init?.body))).toEqual({ code: "code1", state: "web_x" });
    await s.client.refresh(REFRESH);
    expect(s.calls[1]!.url).toBe("https://awardgrid.dowhiz.com/oauth/seats/refresh");
    expect(JSON.parse(String(s.calls[1]!.init?.body))).toEqual({ refresh_token: REFRESH });
    expect(s.calls[1]!.init?.redirect).toBe("manual");
  });

  it("reads a refusal only from seats.aero's own OAuth answer; anything else is a passing failure", async () => {
    expect(meansRevoked(await service(400, { error: "invalid_grant" }).client.refresh(REFRESH))).toBe(true);
    for (const [status, body] of [
      [502, { error: "upstream_blocked" }],
      [401, { error: "invalid_client" }],
      [400, { error: "invalid_request" }],
      [403, "<html>Just a moment</html>"],
      [200, { access_token: "sk-nope", expires_in: 10 }],
    ] as const) {
      const result = await service(status, body).client.refresh(REFRESH);
      expect(result.ok, `${status}`).toBe(false);
      expect(meansRevoked(result), `${status} ${JSON.stringify(body)}`).toBe(false);
    }
    const failing = createTokenBroker({
      baseUrl: TOKEN_SERVICE_URL,
      fetch: (async () => {
        throw new TypeError("offline");
      }) as typeof fetch,
    });
    expect(await failing.refresh(REFRESH)).toEqual({ ok: false, reason: "network", status: 0, error: null });
  });
});

describe("seatsAuthorization: renewal", () => {
  it("hands out the stored token as a Bearer value while it has time left, calling nobody", async () => {
    const d = db();
    connectForTests(d, "alice", { masterKey: MASTER, access: ACCESS, now: T0, expiresIn: 3600 });
    expect(await seatsAuthorization(d, "alice", { masterKey: MASTER, now: () => T0, broker: { exchange: NOT_USED, refresh: NOT_USED } })).toBe(`Bearer ${ACCESS}`);
  });

  it("throws SeatsNotConnectedError before reading MASTER_KEY when nothing is connected", async () => {
    await expect(seatsAuthorization(db(), "alice", { now: () => T0 })).rejects.toBeInstanceOf(SeatsNotConnectedError);
  });

  it("renews early, once for any number of callers at once, and keeps a refresh token seats.aero did not rotate", async () => {
    const d = db();
    connectForTests(d, "alice", { masterKey: MASTER, access: ACCESS, refresh: REFRESH, now: T0, expiresIn: 200 });
    const service = broker(fresh("seats:ota:alice-access-2"));
    const opts = { masterKey: MASTER, now: () => T0, broker: service };
    const all = await Promise.all([seatsAuthorization(d, "alice", opts), seatsAuthorization(d, "alice", opts), seatsAuthorization(d, "alice", opts)]);
    expect(all).toEqual(Array(3).fill("Bearer seats:ota:alice-access-2"));
    expect(service.refreshed).toEqual([REFRESH]);
    expect(readConnection(d, "alice", MASTER)?.tokens).toEqual({ access: "seats:ota:alice-access-2", refresh: REFRESH, expiresAt: T0.getTime() + 3599_000 });
  });

  it("a passing failure keeps the connection: the token while it lasts, then 'renewal unavailable'", async () => {
    const d = db();
    connectForTests(d, "alice", { masterKey: MASTER, access: ACCESS, now: T0, expiresIn: 120 });
    const down = broker();
    expect(await seatsAuthorization(d, "alice", { masterKey: MASTER, now: () => T0, broker: down })).toBe(`Bearer ${ACCESS}`);
    await expect(seatsAuthorization(d, "alice", { masterKey: MASTER, now: () => new Date(T0.getTime() + 121_000), broker: down })).rejects.toMatchObject({
      name: "SeatsRenewalUnavailableError",
    });
    expect(isSeatsConnected(d, "alice")).toBe(true);
  });

  it("a revoked grant removes the tokens and purges the account's seats.aero data, and only that account's", async () => {
    const d = db();
    connectForTests(d, "alice", { masterKey: MASTER, now: T0, expiresIn: 60 });
    connectForTests(d, "bob", { masterKey: MASTER, now: T0 });
    seedSeatsData(d, "alice", T0);
    seedSeatsData(d, "bob", T0);
    await expect(seatsAuthorization(d, "alice", { masterKey: MASTER, now: () => T0, broker: broker(revoked) })).rejects.toBeInstanceOf(SeatsNotConnectedError);
    expect(isSeatsConnected(d, "alice")).toBe(false);
    expect(heldBy(d, "alice")).toEqual({ rows: 0, coverage: 0, routes: 0, runs: 0 });
    expect(heldBy(d, "bob")).toEqual({ rows: 1, coverage: 1, routes: 1, runs: 1 });
  });

  it("an invalid_grant after another process renewed (and rotated) is not a revocation: what is on file wins", async () => {
    const d = db();
    connectForTests(d, "alice", { masterKey: MASTER, access: ACCESS, refresh: REFRESH, now: T0, expiresIn: 60 });
    // While this process's refresh is out, another process renews and rotates the refresh token.
    const racing: TokenBroker = {
      exchange: NOT_USED,
      async refresh() {
        const stored = readConnection(d, "alice", MASTER)!;
        writeRefreshed(d, "alice", stored.generation, { access: "seats:ota:from-worker", refresh: "seats:otr:rotated", expiresAt: T0.getTime() + 3600_000 }, { masterKey: MASTER, now: T0 });
        return revoked;
      },
    };
    expect(await seatsAuthorization(d, "alice", { masterKey: MASTER, now: () => T0, broker: racing })).toBe("Bearer seats:ota:from-worker");
    expect(readConnection(d, "alice", MASTER)?.tokens.refresh).toBe("seats:otr:rotated");
  });

  it("a renewal still out when the person disconnects writes nothing back", async () => {
    const d = db();
    connectForTests(d, "alice", { masterKey: MASTER, now: T0, expiresIn: 60 });
    const disconnecting: TokenBroker = {
      exchange: NOT_USED,
      async refresh() {
        d.delete(seatsConnections).where(eq(seatsConnections.userId, "alice")).run();
        return fresh("seats:ota:too-late");
      },
    };
    await expect(seatsAuthorization(d, "alice", { masterKey: MASTER, now: () => T0, broker: disconnecting })).rejects.toBeInstanceOf(SeatsNotConnectedError);
    expect(isSeatsConnected(d, "alice")).toBe(false);
  });

  it("renewSeatsAuthorization: a token someone else already replaced comes back without a second renewal", async () => {
    const d = db();
    connectForTests(d, "alice", { masterKey: MASTER, access: "seats:ota:already-new", now: T0 });
    expect(await renewSeatsAuthorization(d, "alice", `Bearer ${ACCESS}`, { masterKey: MASTER, now: () => T0, broker: { exchange: NOT_USED, refresh: NOT_USED } })).toEqual({
      key: "Bearer seats:ota:already-new",
    });
  });

  it("withSeatsAuthorization retries once after a refusal, and only after a refusal", async () => {
    const d = db();
    connectForTests(d, "alice", { masterKey: MASTER, access: ACCESS, now: T0 });
    const sent: string[] = [];
    const service = broker(fresh("seats:ota:second"));
    const result = await withSeatsAuthorization(d, "alice", { masterKey: MASTER, now: () => T0, broker: service }, async (auth) => {
      sent.push(auth);
      if (auth === `Bearer ${ACCESS}`) throw new SeatsAeroHttpError(401, "");
      return "ok";
    });
    expect([result, sent]).toEqual(["ok", [`Bearer ${ACCESS}`, "Bearer seats:ota:second"]]);
    const other: string[] = [];
    await expect(
      withSeatsAuthorization(d, "alice", { masterKey: MASTER, now: () => T0, broker: { exchange: NOT_USED, refresh: NOT_USED } }, async (auth) => {
        other.push(auth);
        throw new SeatsAeroHttpError(500, "");
      }),
    ).rejects.toBeInstanceOf(SeatsAeroHttpError);
    expect(other).toHaveLength(1);
  });
});

describe("finishConnect", () => {
  const config = { clientId: "seats:cid:test", consentUrl: SEATS_CONSENT_URL, redirectUri: OAUTH_REDIRECT_URI, tokenServiceUrl: TOKEN_SERVICE_URL };
  const params = (p: Record<string, string>) => new URLSearchParams(p);

  it("exchanges the code of a state this account started and stores the tokens, encrypted", async () => {
    const d = db();
    const state = beginConnect(d, "alice", { now: T0 });
    const service = broker(fresh(ACCESS, REFRESH));
    expect(await finishConnect(d, "alice", params({ code: "abc.DEF-123", state }), { now: () => T0, masterKey: MASTER, broker: service, config })).toBe("connected");
    expect(service.exchanged).toEqual([["abc.DEF-123", state]]);
    expect(readConnection(d, "alice", MASTER)?.tokens).toMatchObject({ access: ACCESS, refresh: REFRESH });
    // The state is used up.
    expect(await finishConnect(d, "alice", params({ code: "abc", state }), { now: () => T0, masterKey: MASTER, broker: broker(), config })).toBe("mismatch");
  });

  it("refuses a code that comes with another account's, a forged or an expired state, before exchanging anything", async () => {
    const d = db();
    const service = broker(fresh(ACCESS, REFRESH));
    const bobs = beginConnect(d, "bob", { now: T0 });
    expect(await finishConnect(d, "alice", params({ code: "c", state: bobs }), { now: () => T0, masterKey: MASTER, broker: service, config })).toBe("mismatch");
    expect(await finishConnect(d, "alice", params({ code: "c", state: randomWebState() }), { now: () => T0, masterKey: MASTER, broker: service, config })).toBe("mismatch");
    expect(await finishConnect(d, "alice", params({ code: "c" }), { now: () => T0, masterKey: MASTER, broker: service, config })).toBe("mismatch");
    const old = beginConnect(d, "alice", { now: T0 });
    expect(await finishConnect(d, "alice", params({ code: "c", state: old }), { now: () => new Date(T0.getTime() + STATE_TTL_MS + 1), masterKey: MASTER, broker: service, config })).toBe("expired");
    expect(service.exchanged).toEqual([]);
    expect(isSeatsConnected(d, "alice")).toBe(false);
    // Bob's sign-in is still his to finish.
    expect(await finishConnect(d, "bob", params({ code: "c", state: bobs }), { now: () => T0, masterKey: MASTER, broker: service, config })).toBe("connected");
  });

  it("says how a sign-in ended: declined, refused, unavailable, a malformed code, no client ID", async () => {
    const d = db();
    const run = async (p: Record<string, string>, service: TokenBroker, cfg: typeof config | null = config) =>
      finishConnect(d, "alice", params({ ...p, state: beginConnect(d, "alice", { now: T0 }) }), { now: () => T0, masterKey: MASTER, broker: service, config: cfg });
    expect(await run({ error: "access_denied" }, broker())).toBe("denied");
    expect(await run({ code: "c" }, broker({ ok: false, reason: "rejected", status: 400, error: "invalid_grant" }))).toBe("rejected");
    expect(await run({ code: "c" }, broker({ ok: false, reason: "network", status: 0, error: null }))).toBe("unavailable");
    expect(await run({ code: "c" }, broker(fresh(ACCESS)))).toBe("unavailable"); // no refresh token
    expect(await run({ code: "<script>" }, broker())).toBe("failed");
    expect(await run({ code: "c" }, broker(), null)).toBe("not_configured");
    expect(isSeatsConnected(d, "alice")).toBe(false);
  });

  it("connecting again over a connection purges what the old one fetched", async () => {
    const d = db();
    connectForTests(d, "alice", { masterKey: MASTER, now: T0 });
    seedSeatsData(d, "alice", T0);
    const state = beginConnect(d, "alice", { now: T0 });
    expect(await finishConnect(d, "alice", params({ code: "c", state }), { now: () => T0, masterKey: MASTER, broker: broker(fresh(ACCESS, REFRESH)), config })).toBe("connected");
    expect(heldBy(d, "alice")).toEqual({ rows: 0, coverage: 0, routes: 0, runs: 0 });
  });
});

describe("short-term caching (server)", () => {
  it("the sweep deletes what was fetched more than 24 hours ago, for every account, and keeps the rest", () => {
    const d = db();
    seedSeatsData(d, "alice", T0);
    seedSeatsData(d, "bob", new Date(T0.getTime() + 2 * 60 * 60_000));
    const report = sweepSeatsData(d, new Date(T0.getTime() + SHORT_TERM_MAX_AGE_MS + 60_000));
    expect(report).toEqual({ rows: 1, coverage: 1, routes: 1, runs: 1 });
    expect(heldBy(d, "alice")).toEqual({ rows: 0, coverage: 0, routes: 0, runs: 0 });
    expect(heldBy(d, "bob")).toEqual({ rows: 1, coverage: 1, routes: 1, runs: 1 });
    const run = d.select().from(queryRuns).where(eq(queryRuns.id, "run-alice")).get()!;
    expect(run).toMatchObject({ cellsJson: "[]", cellsHash: "", newCells: 3 });
    expect(run.cellsPurgedAt).not.toBeNull();
    // Nothing more to do a second time.
    expect(sweepSeatsData(d, new Date(T0.getTime() + SHORT_TERM_MAX_AGE_MS + 120_000))).toEqual({ rows: 0, coverage: 0, routes: 0, runs: 0 });
  });

  it("Disconnect's purge takes everything of one account, whatever its age", () => {
    const d = db();
    seedSeatsData(d, "alice", T0);
    seedSeatsData(d, "bob", T0);
    expect(purgeSeatsDataForUser(d, "alice", T0)).toEqual({ rows: 1, coverage: 1, routes: 1, runs: 1 });
    expect(heldBy(d, "bob")).toEqual({ rows: 1, coverage: 1, routes: 1, runs: 1 });
  });
});

describe("migration 0005", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("deletes every pasted seats.aero key, keeps the optional ones, and flags those accounts for the notice", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "awardgrid-0005-"));
    dirs.push(root);
    const before = path.join(root, "drizzle-before");
    mkdirSync(path.join(before, "meta"), { recursive: true });
    const repoDrizzle = path.resolve(process.cwd(), "drizzle");
    const journal = JSON.parse(readFileSync(path.join(repoDrizzle, "meta", "_journal.json"), "utf8"));
    const earlier = journal.entries.filter((e: { idx: number }) => e.idx <= 4);
    expect(earlier.at(-1).tag).toBe("0004_coverage_evidence");
    for (const e of earlier) copyFileSync(path.join(repoDrizzle, `${e.tag}.sql`), path.join(before, `${e.tag}.sql`));
    writeFileSync(path.join(before, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: earlier }));

    const file = path.join(root, "db.sqlite");
    const old = openDb({ path: file, migrationsFolder: before });
    for (const id of ["keyed", "duffel_only", "none"]) old.run(sql`INSERT INTO users (id, username, password_hash, created_at) VALUES (${id}, ${id}, 'h', '2026-10-01T00:00:00.000Z')`);
    const key = (user: string, provider: string) =>
      old.run(sql`INSERT INTO user_keys (user_id, provider, ciphertext, iv, tag, last4, created_at) VALUES (${user}, ${provider}, 'c', 'i', 't', '1234', '2026-10-01T00:00:00.000Z')`);
    key("keyed", "seats_aero");
    key("keyed", "duffel");
    key("duffel_only", "duffel");
    (old as Db & { $client: { close(): void } }).$client.close();

    const upgraded = openDb({ path: file });
    expect(upgraded.select({ user: userKeys.userId, provider: userKeys.provider }).from(userKeys).orderBy(userKeys.userId).all()).toEqual([
      { user: "duffel_only", provider: "duffel" },
      { user: "keyed", provider: "duffel" },
    ]);
    expect(upgraded.select({ id: users.id, notice: users.seatsReconnectNotice }).from(users).orderBy(users.id).all()).toEqual([
      { id: "duffel_only", notice: false },
      { id: "keyed", notice: true },
      { id: "none", notice: false },
    ]);
    expect(upgraded.select().from(seatsConnections).all()).toEqual([]);
    (upgraded as Db & { $client: { close(): void } }).$client.close();
  });
});

// ---------------------------------------------------------------------------

/** One row of every kind of seats.aero data the server keeps, for `userId`, fetched at `at`. */
function seedSeatsData(d: Db, userId: string, at: Date): void {
  const iso = at.toISOString();
  d.insert(availabilityCache)
    .values({ userId, program: "alaska", origin: "HKG", dest: "SEA", date: "2026-10-20", cabin: "J", miles: 70000, computedLastSeen: iso, sourceId: `src-${userId}`, fetchedAt: iso })
    .run();
  d.insert(cacheCoverage).values({ userId, origin: "HKG", dest: "SEA", date: "2026-10-20", cabin: "J", programsKey: "*", fetchedAt: iso }).run();
  d.insert(routesCache).values({ userId, source: "alaska", routesJson: "[]", fetchedAt: iso }).run();
  d.insert(savedQueries).values({ id: `sq-${userId}`, userId, name: "n", queryJson: "{}", createdAt: iso }).run();
  d.insert(queryRuns)
    .values({ id: `run-${userId}`, savedQueryId: `sq-${userId}`, ranAt: iso, cellsHash: "h", cellsJson: '[{"key":"alaska|HKG|SEA|2026-10-20|J","miles":70000}]', newCells: 3 })
    .run();
}

function heldBy(d: Db, userId: string): { rows: number; coverage: number; routes: number; runs: number } {
  return {
    rows: d.select().from(availabilityCache).where(eq(availabilityCache.userId, userId)).all().length,
    coverage: d.select().from(cacheCoverage).where(eq(cacheCoverage.userId, userId)).all().length,
    routes: d.select().from(routesCache).where(eq(routesCache.userId, userId)).all().length,
    runs: d
      .select()
      .from(queryRuns)
      .where(eq(queryRuns.savedQueryId, `sq-${userId}`))
      .all()
      .filter((r) => r.cellsPurgedAt === null).length,
  };
}
