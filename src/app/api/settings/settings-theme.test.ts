/**
 * Route tests for the additive `theme` field (Phase 6.1): PUT /api/settings validates and
 * persists it, GET /api/auth/me reports it. In-memory SQLite via the getServerDb() mock.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, SESSION_COOKIE, updateUserSettings } from "@/lib/auth";
import { openTestDb, type Db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

let db: Db;
vi.mock("@/lib/server/db", () => ({ getServerDb: () => db }));

const { PUT: putSettings } = await import("./route");
const { GET: me } = await import("../auth/me/route");

function seedUser(id: string): { id: string; token: string } {
  db.insert(users).values({ id, username: id, passwordHash: "x", createdAt: "2026-09-06T00:00:00.000Z" }).run();
  return { id, token: createSession(db, id).token };
}

function put(body: unknown, token?: string): NextRequest {
  return new NextRequest("http://localhost/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json", ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function getMe(token: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/me", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
}

beforeEach(() => {
  db = openTestDb();
});

describe("PUT /api/settings theme", () => {
  it("defaults to system and persists each valid value; /api/auth/me reflects it", async () => {
    const alice = seedUser("alice");
    const before = (await (await me(getMe(alice.token))).json()) as { user: { theme: string } };
    expect(before.user.theme).toBe("system");

    for (const theme of ["dark", "light", "system"] as const) {
      const res = await putSettings(put({ theme }, alice.token));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { settings: Record<string, unknown> };
      expect(body.settings).toMatchObject({ theme, locale: "en", timezone: "UTC" });
      expect(db.select({ theme: users.theme }).from(users).get()).toEqual({ theme });
      const after = (await (await me(getMe(alice.token))).json()) as { user: { theme: string } };
      expect(after.user.theme).toBe(theme);
    }
    // No cookie is written for a theme-only change (the toggle owns ag_theme on the device).
    const res = await putSettings(put({ theme: "dark" }, alice.token));
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("combines with the other settings in one PUT and leaves theme alone when omitted", async () => {
    const alice = seedUser("alice");
    const res = await putSettings(put({ theme: "light", locale: "zh", timezone: "Asia/Shanghai" }, alice.token));
    expect(await res.json()).toEqual({
      settings: { locale: "zh", timezone: "Asia/Shanghai", quietHoursStart: null, quietHoursEnd: null, theme: "light" },
    });
    const again = await putSettings(put({ timezone: "UTC" }, alice.token));
    expect(((await again.json()) as { settings: { theme: string } }).settings.theme).toBe("light");
    expect(db.select().from(users).get()).toMatchObject({ theme: "light", locale: "zh", timezone: "UTC" });
  });

  it("rejects unknown themes with invalid_theme and stores nothing", async () => {
    const alice = seedUser("alice");
    for (const bad of ["auto", "Dark", "", 1, null, true]) {
      const res = await putSettings(put({ theme: bad }, alice.token));
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_theme" });
    }
    expect(db.select({ theme: users.theme }).from(users).get()).toEqual({ theme: "system" });
    // A bad theme next to a bad locale: the locale code wins (first field checked), still 400.
    const both = await putSettings(put({ theme: "auto", locale: "fr" }, alice.token));
    expect(both.status).toBe(400);
    // Anonymous: 401 before any validation.
    expect((await putSettings(put({ theme: "dark" }))).status).toBe(401);
  });

  it("updateUserSettings validates theme itself for untyped callers", () => {
    const alice = seedUser("alice");
    expect(updateUserSettings(db, alice.id, { theme: "dark" }).theme).toBe("dark");
    expect(() => updateUserSettings(db, alice.id, { theme: "blue" as unknown as "dark" })).toThrow(RangeError);
    expect(db.select({ theme: users.theme }).from(users).get()).toEqual({ theme: "dark" });
  });
});
