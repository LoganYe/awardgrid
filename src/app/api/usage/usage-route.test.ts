/**
 * Route-handler tests for GET /api/usage against an in-memory SQLite (openTestDb) via the
 * getServerDb() mock. No network, no keys: the usage tables are seeded directly.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { openTestDb, type Db } from "@/lib/db/client";
import { apiUsage, askUsage, users } from "@/lib/db/schema";
import { getUsageSummary } from "@/lib/server/usage";

let db: Db;
vi.mock("@/lib/server/db", () => ({ getServerDb: () => db }));

const { GET } = await import("./route");

function seedUser(id: string): { id: string; token: string } {
  db.insert(users).values({ id, username: id, passwordHash: "x", createdAt: "2026-09-06T00:00:00.000Z" }).run();
  return { id, token: createSession(db, id).token };
}

function get(token?: string): NextRequest {
  return new NextRequest("http://localhost/api/usage", {
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
}

const today = () => new Date().toISOString().slice(0, 10);

function seedCalls(userId: string, calls: number, day = today()): void {
  db.insert(apiUsage).values({ userId, provider: "seats_aero", day, calls }).run();
}

beforeEach(() => {
  db = openTestDb();
  delete process.env.SEATS_AERO_DAILY_SOFT_LIMIT;
  delete process.env.ASK_DAILY_COST_CAP_USD;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/usage", () => {
  it("401 without a session, no-store", async () => {
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const stale = await GET(get("not-a-session"));
    expect(stale.status).toBe(401);
  });

  it("answers zeros for a user with no rows today", async () => {
    const alice = seedUser("alice");
    const res = await GET(get(alice.token));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      seats_aero: {
        used: 0,
        soft_limit: 950,
        limit: 1000,
        reset_at: expect.stringMatching(/T00:00:00\.000Z$/),
        state: "ok",
      },
      ask: { spent_usd: 0, cap_usd: 2, remaining_usd: 2, reset_at: expect.stringMatching(/T00:00:00\.000Z$/) },
      computed_at: expect.any(String),
    });
    // The reset is strictly after "now" and within 24 h.
    const reset = new Date(body.seats_aero.reset_at).getTime();
    const computed = new Date(body.computed_at).getTime();
    expect(reset).toBeGreaterThan(computed);
    expect(reset - computed).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(body.ask.reset_at).toBe(body.seats_aero.reset_at);
  });

  it("reads today's seats.aero calls and ask spend for the calling user only", async () => {
    const alice = seedUser("alice");
    const bob = seedUser("bob");
    seedCalls(alice.id, 312);
    seedCalls(bob.id, 900);
    seedCalls(alice.id, 999, "2026-01-01"); // another day: ignored
    db.insert(askUsage).values({ userId: alice.id, day: today(), costMicroUsd: 420_000, requests: 3 }).run();

    const body = await (await GET(get(alice.token))).json();
    expect(body.seats_aero).toMatchObject({ used: 312, soft_limit: 950, limit: 1000, state: "ok" });
    expect(body.ask).toMatchObject({ spent_usd: 0.42, cap_usd: 2, remaining_usd: 1.58 });

    const other = await (await GET(get(bob.token))).json();
    expect(other.seats_aero).toMatchObject({ used: 900, state: "warn" });
    expect(other.ask).toMatchObject({ spent_usd: 0, remaining_usd: 2 });
  });

  it("thresholds: ok < 800, warn 800–949, exceeded ≥ 950", async () => {
    const cases: Array<[number, string]> = [
      [799, "ok"],
      [800, "warn"],
      [949, "warn"],
      [950, "exceeded"],
      [1000, "exceeded"],
    ];
    for (const [calls, state] of cases) {
      db = openTestDb();
      const u = seedUser("alice");
      seedCalls(u.id, calls);
      const body = await (await GET(get(u.token))).json();
      expect(body.seats_aero.state, `${calls} calls`).toBe(state);
      expect(body.seats_aero.used).toBe(calls);
    }
  });

  it("follows the env soft limit and ask cap", async () => {
    vi.stubEnv("SEATS_AERO_DAILY_SOFT_LIMIT", "500");
    vi.stubEnv("ASK_DAILY_COST_CAP_USD", "1");
    const alice = seedUser("alice");
    seedCalls(alice.id, 500);
    db.insert(askUsage).values({ userId: alice.id, day: today(), costMicroUsd: 1_000_000, requests: 1 }).run();
    const body = await (await GET(get(alice.token))).json();
    expect(body.seats_aero).toMatchObject({ used: 500, soft_limit: 500, limit: 1000, state: "exceeded" });
    expect(body.ask).toMatchObject({ spent_usd: 1, cap_usd: 1, remaining_usd: 0 });
  });

  it("getUsageSummary pins the day to the injected clock", () => {
    const alice = seedUser("alice");
    seedCalls(alice.id, 850, "2026-10-01");
    const at = new Date("2026-10-01T15:30:00.000Z");
    const summary = getUsageSummary(db, alice.id, { now: at, env: {} });
    expect(summary.seats_aero).toEqual({
      used: 850,
      soft_limit: 950,
      limit: 1000,
      reset_at: "2026-10-02T00:00:00.000Z",
      state: "warn",
    });
    expect(summary.ask.reset_at).toBe("2026-10-02T00:00:00.000Z");
    expect(summary.computed_at).toBe("2026-10-01T15:30:00.000Z");
    // Reading never writes.
    expect(db.select().from(askUsage).all()).toHaveLength(0);
    expect(db.select().from(apiUsage).all()).toHaveLength(1);
  });
});
