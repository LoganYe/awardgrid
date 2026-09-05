/**
 * Route-handler tests for /api/keys, /api/keys/[provider], /api/settings and
 * /api/auth/logout-all against an in-memory SQLite (openTestDb) via the getServerDb() mock.
 * No network: globalThis.fetch is stubbed for every seats.aero validation; no env keys: a
 * throwaway MASTER_KEY is set per test.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { openTestDb, type Db } from "@/lib/db/client";
import { apiUsage, userKeys, users } from "@/lib/db/schema";
import { getDecryptedKey, getMasterKey, resetMasterKeyCache } from "@/lib/keys";
import { getTodayUsage } from "@/lib/server/usage";

let db: Db;
vi.mock("@/lib/server/db", () => ({ getServerDb: () => db }));

const { GET: listKeysRoute, PUT: putKey } = await import("./route");
const { DELETE: deleteKey } = await import("./[provider]/route");
const { PUT: putSettings } = await import("../settings/route");
const { POST: logoutAll } = await import("../auth/logout-all/route");

const TEST_MASTER_KEY = "b".repeat(64);
const PLAINTEXT = "pro_live_SUPERSECRETKEYVALUE_zx9q";

interface Seeded {
  id: string;
  token: string;
}

function seedUser(id: string): Seeded {
  db.insert(users).values({ id, username: id, passwordHash: "x", createdAt: "2026-09-06T00:00:00.000Z" }).run();
  const { token } = createSession(db, id);
  return { id, token };
}

function req(path: string, init: { method?: string; body?: unknown; token?: string } = {}): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) headers.cookie = `${SESSION_COOKIE}=${init.token}`;
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

function stubFetch(status: number, body: unknown = { data: [], count: 0, hasMore: false, cursor: 0 }) {
  const calls: { url: string; headers: Headers }[] = [];
  const fake = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fake);
  return { fake, calls };
}

function params(provider: string): { params: Promise<{ provider: string }> } {
  return { params: Promise.resolve({ provider }) };
}

beforeEach(() => {
  db = openTestDb();
  process.env.MASTER_KEY = TEST_MASTER_KEY;
  resetMasterKeyCache();
  // Any un-stubbed fetch is a test bug: fail loudly instead of touching the network.
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("network access is not allowed in tests");
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.MASTER_KEY;
  resetMasterKeyCache();
});

describe("PUT /api/keys", () => {
  it("validates a seats.aero key with one call, stores it encrypted, returns the mask and charges 1 quota call", async () => {
    const alice = seedUser("alice");
    const { calls } = stubFetch(200);
    const res = await putKey(req("/api/keys", { method: "PUT", body: { provider: "seats_aero", key: ` ${PLAINTEXT} ` }, token: alice.token }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ provider: "seats_aero", last4: "zx9q", masked: "••••zx9q", createdAt: expect.any(String) });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("seats.aero/partnerapi/search");
    expect(calls[0]!.headers.get("partner-authorization")).toBe(PLAINTEXT);

    expect(getDecryptedKey(db, alice.id, "seats_aero", getMasterKey())).toBe(PLAINTEXT);
    const row = db.select().from(userKeys).get()!;
    expect(row.ciphertext).not.toContain(PLAINTEXT);
    expect(row.last4).toBe("zx9q");

    expect(getTodayUsage(db, alice.id).used).toBe(1);
    const usageRows = db.select().from(apiUsage).all();
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]).toMatchObject({ userId: alice.id, provider: "seats_aero", calls: 1 });
  });

  it("rejects a key seats.aero answers 401 to: invalid_key, nothing stored, no quota charged", async () => {
    const alice = seedUser("alice");
    stubFetch(401, "nope");
    const res = await putKey(req("/api/keys", { method: "PUT", body: { provider: "seats_aero", key: PLAINTEXT }, token: alice.token }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_key" });
    expect(db.select().from(userKeys).all()).toHaveLength(0);
    expect(getTodayUsage(db, alice.id).used).toBe(0);
  });

  it("maps a transport failure to 502 seatsaero_unavailable and stores nothing", async () => {
    const alice = seedUser("alice");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const res = await putKey(req("/api/keys", { method: "PUT", body: { provider: "seats_aero", key: PLAINTEXT }, token: alice.token }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "seatsaero_unavailable" });
    expect(db.select().from(userKeys).all()).toHaveLength(0);
    expect(getTodayUsage(db, alice.id).used).toBe(0);
  });

  it("refuses the probe with 429 quota when the user is at the soft limit — no request, nothing stored", async () => {
    const alice = seedUser("alice");
    const day = new Date().toISOString().slice(0, 10);
    db.insert(apiUsage).values({ userId: alice.id, provider: "seats_aero", day, calls: 950 }).run();
    const { calls } = stubFetch(200);
    const res = await putKey(req("/api/keys", { method: "PUT", body: { provider: "seats_aero", key: PLAINTEXT }, token: alice.token }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "quota", resetAt: expect.stringMatching(/T00:00:00\.000Z$/) });
    expect(calls).toHaveLength(0);
    expect(db.select().from(userKeys).all()).toHaveLength(0);
    expect(getTodayUsage(db, alice.id).used).toBe(950);
  });

  it("charges a client-side timeout (the request left the process) but not a connection failure", async () => {
    const alice = seedUser("alice");
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }),
    );
    vi.useFakeTimers();
    try {
      const pending = putKey(req("/api/keys", { method: "PUT", body: { provider: "seats_aero", key: PLAINTEXT }, token: alice.token }));
      await vi.advanceTimersByTimeAsync(20_000);
      const res = await pending;
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "seatsaero_unavailable" });
    } finally {
      vi.useRealTimers();
    }
    expect(db.select().from(userKeys).all()).toHaveLength(0);
    expect(getTodayUsage(db, alice.id).used).toBe(1);
  });

  it("stores duffel/ignav keys without any network call and replaces an existing key", async () => {
    const alice = seedUser("alice");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const first = await putKey(req("/api/keys", { method: "PUT", body: { provider: "duffel", key: "duffel_live_first_ABCD" }, token: alice.token }));
    expect(first.status).toBe(200);
    const second = await putKey(req("/api/keys", { method: "PUT", body: { provider: "duffel", key: "duffel_live_second_WXYZ" }, token: alice.token }));
    expect(second.status).toBe(200);
    expect(((await second.json()) as { masked: string }).masked).toBe("••••WXYZ");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getDecryptedKey(db, alice.id, "duffel", getMasterKey())).toBe("duffel_live_second_WXYZ");
    expect(db.select().from(userKeys).all()).toHaveLength(1);
    expect(getTodayUsage(db, alice.id).used).toBe(0);
  });

  it("returns 401 without a session, invalid_body for bad shapes, key_empty / key_too_long for bad keys", async () => {
    const alice = seedUser("alice");
    const anon = await putKey(req("/api/keys", { method: "PUT", body: { provider: "duffel", key: "x" } }));
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ error: "unauthorized" });

    const badJson = await putKey(req("/api/keys", { method: "PUT", body: "{nope", token: alice.token }));
    expect(await badJson.json()).toEqual({ error: "invalid_body" });
    const badProvider = await putKey(req("/api/keys", { method: "PUT", body: { provider: "united", key: "x" }, token: alice.token }));
    expect(badProvider.status).toBe(400);
    expect(await badProvider.json()).toEqual({ error: "invalid_body" });

    const empty = await putKey(req("/api/keys", { method: "PUT", body: { provider: "seats_aero", key: "   " }, token: alice.token }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "key_empty" });
    const long = await putKey(req("/api/keys", { method: "PUT", body: { provider: "ignav", key: "k".repeat(600) }, token: alice.token }));
    expect(await long.json()).toEqual({ error: "key_too_long" });
    expect(db.select().from(userKeys).all()).toHaveLength(0);
  });

  it("returns 500 internal (no value echoed) when MASTER_KEY is missing", async () => {
    const alice = seedUser("alice");
    delete process.env.MASTER_KEY;
    resetMasterKeyCache();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await putKey(req("/api/keys", { method: "PUT", body: { provider: "duffel", key: PLAINTEXT }, token: alice.token }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(PLAINTEXT);
  });

  it("never echoes the plaintext key in any response", async () => {
    const alice = seedUser("alice");
    stubFetch(500, "boom");
    const responses = [
      await putKey(req("/api/keys", { method: "PUT", body: { provider: "seats_aero", key: PLAINTEXT }, token: alice.token })),
      await putKey(req("/api/keys", { method: "PUT", body: { provider: "seats_aero", key: PLAINTEXT } })),
    ];
    stubFetch(200);
    responses.push(await putKey(req("/api/keys", { method: "PUT", body: { provider: "seats_aero", key: PLAINTEXT }, token: alice.token })));
    responses.push(await listKeysRoute(req("/api/keys", { token: alice.token })));
    for (const res of responses) {
      const text = await res.text();
      expect(text).not.toContain(PLAINTEXT);
      expect(text).not.toContain(PLAINTEXT.slice(0, 12));
    }
  });
});

describe("GET /api/keys", () => {
  it("lists masked keys only, per user", async () => {
    const alice = seedUser("alice");
    const bob = seedUser("bob");
    stubFetch(200);
    await putKey(req("/api/keys", { method: "PUT", body: { provider: "seats_aero", key: PLAINTEXT }, token: alice.token }));
    await putKey(req("/api/keys", { method: "PUT", body: { provider: "ignav", key: "fake-ignav-key-value" }, token: alice.token }));

    const res = await listKeysRoute(req("/api/keys", { token: alice.token }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: Record<string, unknown>[] };
    expect(body.keys.map((k) => k.provider)).toEqual(["ignav", "seats_aero"]);
    for (const k of body.keys) expect(Object.keys(k).sort()).toEqual(["createdAt", "last4", "masked", "provider"]);
    expect(JSON.stringify(body)).not.toContain(PLAINTEXT);

    const bobRes = await listKeysRoute(req("/api/keys", { token: bob.token }));
    expect(((await bobRes.json()) as { keys: unknown[] }).keys).toEqual([]);

    const anon = await listKeysRoute(req("/api/keys"));
    expect(anon.status).toBe(401);
  });
});

describe("DELETE /api/keys/[provider]", () => {
  it("removes the key (204), is idempotent, rejects unknown providers and anonymous callers", async () => {
    const alice = seedUser("alice");
    await putKey(req("/api/keys", { method: "PUT", body: { provider: "duffel", key: "duffel_live_ABCD" }, token: alice.token }));
    expect(db.select().from(userKeys).all()).toHaveLength(1);

    const res = await deleteKey(req("/api/keys/duffel", { method: "DELETE", token: alice.token }), params("duffel"));
    expect(res.status).toBe(204);
    expect(db.select().from(userKeys).all()).toHaveLength(0);

    const again = await deleteKey(req("/api/keys/duffel", { method: "DELETE", token: alice.token }), params("duffel"));
    expect(again.status).toBe(204);

    const bad = await deleteKey(req("/api/keys/united", { method: "DELETE", token: alice.token }), params("united"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_provider" });

    const anon = await deleteKey(req("/api/keys/duffel", { method: "DELETE" }), params("duffel"));
    expect(anon.status).toBe(401);
  });

  it("only deletes the caller's own key", async () => {
    const alice = seedUser("alice");
    const bob = seedUser("bob");
    await putKey(req("/api/keys", { method: "PUT", body: { provider: "duffel", key: "duffel_live_ABCD" }, token: alice.token }));
    const res = await deleteKey(req("/api/keys/duffel", { method: "DELETE", token: bob.token }), params("duffel"));
    expect(res.status).toBe(204);
    expect(getDecryptedKey(db, alice.id, "duffel", getMasterKey())).toBe("duffel_live_ABCD");
  });
});

describe("PUT /api/settings", () => {
  it("saves locale (and sets the ag_locale cookie), timezone and quiet hours", async () => {
    const alice = seedUser("alice");
    const res = await putSettings(
      req("/api/settings", {
        method: "PUT",
        body: { locale: "zh", timezone: "Asia/Shanghai", quietHoursStart: "23:00", quietHoursEnd: "07:30" },
        token: alice.token,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: { locale: "zh", timezone: "Asia/Shanghai", quietHoursStart: "23:00", quietHoursEnd: "07:30" },
    });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/ag_locale=zh/);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).not.toMatch(/HttpOnly/i);

    const row = db.select().from(users).get()!;
    expect(row).toMatchObject({ locale: "zh", timezone: "Asia/Shanghai", quietHoursStart: "23:00", quietHoursEnd: "07:30" });

    // Clearing quiet hours with nulls; no locale in the patch → no locale cookie.
    const clear = await putSettings(
      req("/api/settings", { method: "PUT", body: { quietHoursStart: null, quietHoursEnd: null }, token: alice.token }),
    );
    expect(clear.status).toBe(200);
    expect(clear.headers.get("set-cookie")).toBeNull();
    expect(db.select().from(users).get()!).toMatchObject({ quietHoursStart: null, quietHoursEnd: null, locale: "zh" });
  });

  it("rejects garbage time zones, malformed HH:MM, half-set quiet hours, unknown locales and bad bodies", async () => {
    const alice = seedUser("alice");
    const tz = await putSettings(req("/api/settings", { method: "PUT", body: { timezone: "Mars/Olympus_Mons" }, token: alice.token }));
    expect(tz.status).toBe(400);
    expect(await tz.json()).toEqual({ error: "invalid_timezone" });

    for (const bad of ["25:00", "7:30", "23:60", "night", ""]) {
      const r = await putSettings(
        req("/api/settings", { method: "PUT", body: { quietHoursStart: bad, quietHoursEnd: "07:00" }, token: alice.token }),
      );
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "invalid_quiet_hours" });
    }

    const half = await putSettings(req("/api/settings", { method: "PUT", body: { quietHoursStart: "22:00" }, token: alice.token }));
    expect(await half.json()).toEqual({ error: "invalid_quiet_hours" });

    const loc = await putSettings(req("/api/settings", { method: "PUT", body: { locale: "fr" }, token: alice.token }));
    expect(await loc.json()).toEqual({ error: "invalid_locale" });

    const shape = await putSettings(req("/api/settings", { method: "PUT", body: { passwordHash: "x" }, token: alice.token }));
    expect(await shape.json()).toEqual({ error: "invalid_body" });
    const notJson = await putSettings(req("/api/settings", { method: "PUT", body: "nope", token: alice.token }));
    expect(await notJson.json()).toEqual({ error: "invalid_body" });

    const anon = await putSettings(req("/api/settings", { method: "PUT", body: { locale: "en" } }));
    expect(anon.status).toBe(401);

    expect(db.select().from(users).get()!).toMatchObject({ locale: "en", timezone: "UTC", quietHoursStart: null });
  });
});

describe("POST /api/auth/logout-all", () => {
  it("revokes every session of the caller, clears the cookie and leaves other users alone", async () => {
    const alice = seedUser("alice");
    const bob = seedUser("bob");
    const aliceSecond = createSession(db, alice.id).token;

    const res = await logoutAll(req("/api/auth/logout-all", { method: "POST", token: alice.token }));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;`));

    expect((await listKeysRoute(req("/api/keys", { token: alice.token }))).status).toBe(401);
    expect((await listKeysRoute(req("/api/keys", { token: aliceSecond }))).status).toBe(401);
    expect((await listKeysRoute(req("/api/keys", { token: bob.token }))).status).toBe(200);

    const anon = await logoutAll(req("/api/auth/logout-all", { method: "POST" }));
    expect(anon.status).toBe(401);
  });
});

describe("getTodayUsage", () => {
  it("reads today's row for the user and provider only, with the soft limit and reset time", async () => {
    seedUser("alice");
    seedUser("bob");
    const now = new Date("2026-09-06T15:00:00.000Z");
    db.insert(apiUsage)
      .values([
        { userId: "alice", provider: "seats_aero", day: "2026-09-06", calls: 42 },
        { userId: "alice", provider: "seats_aero", day: "2026-09-05", calls: 900 },
        { userId: "alice", provider: "duffel", day: "2026-09-06", calls: 7 },
        { userId: "bob", provider: "seats_aero", day: "2026-09-06", calls: 3 },
      ])
      .run();
    expect(getTodayUsage(db, "alice", { now, env: {} })).toEqual({
      used: 42,
      limit: 950,
      hardLimit: 1000,
      day: "2026-09-06",
      resetAt: "2026-09-07T00:00:00.000Z",
    });
    expect(getTodayUsage(db, "bob", { now }).used).toBe(3);
    expect(getTodayUsage(db, "nobody", { now }).used).toBe(0);
    expect(getTodayUsage(db, "alice", { now, env: { SEATS_AERO_DAILY_SOFT_LIMIT: "500" } }).limit).toBe(500);
  });
});
