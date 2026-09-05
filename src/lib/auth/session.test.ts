import { describe, expect, it } from "vitest";
import { createInvite } from "@/lib/auth/invites";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  cookieOptions,
  cookieSecureFromEnv,
  createSession,
  getSessionUser,
  hashSessionToken,
  isSessionTokenShape,
  purgeExpiredSessions,
  revokeAllSessions,
  revokeSession,
} from "@/lib/auth/session";
import { registerWithInvite } from "@/lib/auth/users";
import { openTestDb } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";

const T0 = new Date("2026-09-06T10:00:00Z");

async function seed() {
  const db = openTestDb();
  const { code } = createInvite(db, { createdBy: "admin" }, { now: T0 });
  const user = await registerWithInvite(db, { inviteCode: code, username: "alice", password: "hunter2hunter2" }, { now: T0 });
  return { db, user };
}

describe("sessions", () => {
  it("constants", () => {
    expect(SESSION_COOKIE).toBe("ag_session");
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("creates a session whose stored id is the sha256 of the token, never the token", async () => {
    const { db, user } = await seed();
    const { token, expiresAt } = createSession(db, user.id, { now: T0 });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isSessionTokenShape(token)).toBe(true);
    expect(expiresAt.getTime()).toBe(T0.getTime() + SESSION_TTL_MS);

    const rows = db.select().from(sessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(hashSessionToken(token));
    expect(rows[0]?.id).not.toBe(token);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]?.expiresAt).toBe(expiresAt.toISOString());
  });

  it("resolves the user until expiry, then deletes the row", async () => {
    const { db, user } = await seed();
    const { token } = createSession(db, user.id, { now: T0 });
    const got = getSessionUser(db, token, { now: T0 });
    expect(got).toEqual(user);
    expect(got && "passwordHash" in got).toBe(false);

    const almost = new Date(T0.getTime() + SESSION_TTL_MS - 1);
    expect(getSessionUser(db, token, { now: () => almost })).not.toBeNull();

    const expired = new Date(T0.getTime() + SESSION_TTL_MS);
    expect(getSessionUser(db, token, { now: expired })).toBeNull();
    expect(db.select().from(sessions).all()).toHaveLength(0);
    // Still null afterwards (row gone).
    expect(getSessionUser(db, token, { now: T0 })).toBeNull();
  });

  it("ignores unknown, malformed and empty tokens", async () => {
    const { db, user } = await seed();
    createSession(db, user.id, { now: T0 });
    expect(getSessionUser(db, "", { now: T0 })).toBeNull();
    expect(getSessionUser(db, undefined, { now: T0 })).toBeNull();
    expect(getSessionUser(db, "x".repeat(43), { now: T0 })).toBeNull();
    expect(getSessionUser(db, "not a token", { now: T0 })).toBeNull();
    expect(revokeSession(db, "not a token")).toBe(false);
  });

  it("revokes one session or all of a user's sessions", async () => {
    const { db, user } = await seed();
    const a = createSession(db, user.id, { now: T0 });
    const b = createSession(db, user.id, { now: T0 });
    const c = createSession(db, user.id, { now: T0 });
    expect(a.token).not.toBe(b.token);

    expect(revokeSession(db, a.token)).toBe(true);
    expect(revokeSession(db, a.token)).toBe(false);
    expect(getSessionUser(db, a.token, { now: T0 })).toBeNull();
    expect(getSessionUser(db, b.token, { now: T0 })).not.toBeNull();

    expect(revokeAllSessions(db, user.id)).toBe(2);
    expect(getSessionUser(db, b.token, { now: T0 })).toBeNull();
    expect(getSessionUser(db, c.token, { now: T0 })).toBeNull();
    expect(revokeAllSessions(db, user.id)).toBe(0);
  });

  it("purges expired rows", async () => {
    const { db, user } = await seed();
    createSession(db, user.id, { now: T0 });
    createSession(db, user.id, { now: new Date(T0.getTime() + 1000) });
    expect(purgeExpiredSessions(db, { now: T0 })).toBe(0);
    expect(purgeExpiredSessions(db, { now: new Date(T0.getTime() + SESSION_TTL_MS + 500) })).toBe(1);
    expect(purgeExpiredSessions(db, { now: new Date(T0.getTime() + SESSION_TTL_MS + 5000) })).toBe(1);
  });

  it("cookie options are httpOnly, lax, path=/ with the given expiry and secure flag", () => {
    const exp = new Date("2026-10-06T10:00:00Z");
    expect(cookieOptions(exp, { secure: true })).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure: true, expires: exp });
    expect(cookieOptions(exp, { secure: false }).secure).toBe(false);
    expect(cookieSecureFromEnv({ NODE_ENV: "production" })).toBe(true);
    expect(cookieSecureFromEnv({ NODE_ENV: "development" })).toBe(false);
    expect(cookieSecureFromEnv({ NODE_ENV: "production", COOKIE_SECURE: "false" })).toBe(false);
    expect(cookieSecureFromEnv({ COOKIE_SECURE: "1" })).toBe(true);
  });
});
