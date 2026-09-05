/**
 * Route-handler tests for /api/telegram/link and /api/telegram/status (openTestDb via the
 * getServerDb() mock). No network: getMe is served by a stubbed fetch; the bot token used
 * here is a throwaway string that must never appear in a response.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { openTestDb, type Db } from "@/lib/db/client";
import { telegramLinkTokens, users } from "@/lib/db/schema";
import { resetBotUsernameCache } from "@/lib/server/queries";

let db: Db;
vi.mock("@/lib/server/db", () => ({ getServerDb: () => db }));

const { POST: linkRoute, DELETE: unlinkRoute } = await import("./link/route");
const { GET: statusRoute } = await import("./status/route");

const FAKE_TOKEN = "123456:FAKE-bot-token-never-logged";

function seedUser(id: string, chatId: string | null = null): { id: string; token: string } {
  db.insert(users).values({ id, username: id, passwordHash: "x", createdAt: "2026-09-06T00:00:00.000Z", telegramChatId: chatId }).run();
  const { token } = createSession(db, id);
  return { id, token };
}

function req(path: string, init: { method?: string; token?: string } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (init.token) headers.cookie = `${SESSION_COOKIE}=${init.token}`;
  return new NextRequest(`http://localhost${path}`, { method: init.method ?? "GET", headers });
}

function stubGetMe(username: string | null, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      const body = status === 200 ? { ok: true, result: { id: 987654321012, is_bot: true, first_name: "awardgrid", ...(username ? { username } : {}) } } : { ok: false, description: "Unauthorized", error_code: 401 };
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

beforeEach(() => {
  db = openTestDb();
  resetBotUsernameCache();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_USERNAME;
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("network access is not allowed in tests");
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_USERNAME;
  resetBotUsernameCache();
});

describe("auth", () => {
  it("401 without a session", async () => {
    expect((await linkRoute(req("/api/telegram/link", { method: "POST" }))).status).toBe(401);
    expect((await unlinkRoute(req("/api/telegram/link", { method: "DELETE" }))).status).toBe(401);
    expect((await statusRoute(req("/api/telegram/status"))).status).toBe(401);
  });
});

describe("mock mode (no TELEGRAM_BOT_TOKEN)", () => {
  it("status reports mock and POST link returns deepLink null without minting a token", async () => {
    const alice = seedUser("alice");
    const status = await statusRoute(req("/api/telegram/status", { token: alice.token }));
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ linked: false, mock: true });

    const link = await linkRoute(req("/api/telegram/link", { method: "POST", token: alice.token }));
    expect(link.status).toBe(200);
    expect(await link.json()).toEqual({ deepLink: null, mock: true });
    expect(db.select().from(telegramLinkTokens).all()).toHaveLength(0);
  });
});

describe("POST /api/telegram/link (real token)", () => {
  it("uses TELEGRAM_BOT_USERNAME without calling getMe and mints a ≤64-char base64url payload", async () => {
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    process.env.TELEGRAM_BOT_USERNAME = "@awardgrid_bot";
    const alice = seedUser("alice");
    const fetchMock = vi.fn(async () => {
      throw new Error("must not call getMe");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await linkRoute(req("/api/telegram/link", { method: "POST", token: alice.token }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deepLink: string; mock: boolean; expiresAt: string };
    expect(body.mock).toBe(false);
    expect(body.deepLink).toMatch(/^https:\/\/t\.me\/awardgrid_bot\?start=[A-Za-z0-9_-]{1,64}$/);
    expect(body.deepLink).not.toContain(FAKE_TOKEN);
    expect(fetchMock).not.toHaveBeenCalled();

    const payload = new URL(body.deepLink).searchParams.get("start")!;
    const rows = db.select().from(telegramLinkTokens).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ token: payload, userId: alice.id, usedAt: null });
    expect(Date.parse(rows[0]!.expiresAt) - Date.parse(rows[0]!.createdAt)).toBe(15 * 60_000);
    expect(body.expiresAt).toBe(rows[0]!.expiresAt);
  });

  it("falls back to getMe once (cached) and a fresh link replaces the previous unused token", async () => {
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    const alice = seedUser("alice");
    const calls = stubGetMe("grid_alerts_bot");

    const first = (await (await linkRoute(req("/api/telegram/link", { method: "POST", token: alice.token }))).json()) as { deepLink: string };
    const second = (await (await linkRoute(req("/api/telegram/link", { method: "POST", token: alice.token }))).json()) as { deepLink: string };
    expect(first.deepLink.startsWith("https://t.me/grid_alerts_bot?start=")).toBe(true);
    expect(second.deepLink).not.toBe(first.deepLink);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/getMe");

    const rows = db.select().from(telegramLinkTokens).where(eq(telegramLinkTokens.userId, alice.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token).toBe(new URL(second.deepLink).searchParams.get("start"));
  });

  it("answers 503 telegram_unavailable when getMe fails, without leaking the token", async () => {
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    const alice = seedUser("alice");
    stubGetMe(null, 401);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await linkRoute(req("/api/telegram/link", { method: "POST", token: alice.token }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "telegram_unavailable" });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(FAKE_TOKEN);
    expect(db.select().from(telegramLinkTokens).all()).toHaveLength(0);
  });
});

describe("status + unlink", () => {
  it("reports linked for a user with a chat id, and DELETE clears chat id + tokens (idempotent)", async () => {
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    process.env.TELEGRAM_BOT_USERNAME = "awardgrid_bot";
    const alice = seedUser("alice", "9007199254740993"); // > 2^53: must survive as text
    const bob = seedUser("bob");

    expect(await (await statusRoute(req("/api/telegram/status", { token: alice.token }))).json()).toEqual({ linked: true, mock: false });
    expect(await (await statusRoute(req("/api/telegram/status", { token: bob.token }))).json()).toEqual({ linked: false, mock: false });

    await linkRoute(req("/api/telegram/link", { method: "POST", token: alice.token }));
    await linkRoute(req("/api/telegram/link", { method: "POST", token: bob.token }));
    expect(db.select().from(telegramLinkTokens).all()).toHaveLength(2);

    const del = await unlinkRoute(req("/api/telegram/link", { method: "DELETE", token: alice.token }));
    expect(del.status).toBe(204);
    expect(await (await statusRoute(req("/api/telegram/status", { token: alice.token }))).json()).toEqual({ linked: false, mock: false });
    expect(db.select().from(users).where(eq(users.id, alice.id)).get()!.telegramChatId).toBeNull();
    // Bob's pending token is untouched.
    const remaining = db.select().from(telegramLinkTokens).all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.userId).toBe(bob.id);

    expect((await unlinkRoute(req("/api/telegram/link", { method: "DELETE", token: alice.token }))).status).toBe(204);
  });
});
