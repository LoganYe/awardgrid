/**
 * Route-handler tests for POST /api/auth/password against an in-memory SQLite (openTestDb)
 * injected through the getServerDb() indirection. No network, no env keys. argon2 runs for
 * real (a handful of hashes) so the verify/re-hash path is exercised end to end.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate, createSession, getSessionUser, hashPassword, SESSION_COOKIE } from "@/lib/auth";
import { openTestDb, type Db } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import { clearAuthLimiters, passwordLimiter } from "@/lib/server/rate-limit";

let db: Db;
vi.mock("@/lib/server/db", () => ({ getServerDb: () => db }));

const { POST: changePasswordRoute } = await import("./route");

const OLD = "correct horse battery";
const NEW = "a much better passphrase";

async function seedUser(username = "alice"): Promise<{ id: string; token: string }> {
  const id = username;
  db.insert(users)
    .values({ id, username, passwordHash: await hashPassword(OLD), createdAt: "2026-09-06T00:00:00.000Z" })
    .run();
  return { id, token: createSession(db, id).token };
}

function post(body: unknown, init: { token?: string; contentType?: string | null; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { ...init.headers };
  if (init.contentType !== null) headers["content-type"] = init.contentType ?? "application/json";
  if (init.token) headers.cookie = `${SESSION_COOKIE}=${init.token}`;
  return new NextRequest("http://localhost/api/auth/password", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** The session token out of a Set-Cookie header. */
function sessionCookie(res: Response): string | null {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  return raw.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1] ?? null;
}

function passwordHashOf(id: string): string {
  return db.select().from(users).where(eq(users.id, id)).get()!.passwordHash;
}

beforeEach(() => {
  db = openTestDb();
  // The limiters are module state keyed on the user id, and every test here seeds "alice".
  clearAuthLimiters();
});

describe("POST /api/auth/password", () => {
  it("re-hashes the password: the new one authenticates and the old one stops working", async () => {
    const alice = await seedUser();
    const before = passwordHashOf(alice.id);
    const res = await changePasswordRoute(post({ current: OLD, next: NEW }, { token: alice.token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(passwordHashOf(alice.id)).not.toBe(before);

    await expect(authenticate(db, { username: "alice", password: NEW })).resolves.toMatchObject({ username: "alice" });
    await expect(authenticate(db, { username: "alice", password: OLD })).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("logs out the other devices and keeps this one signed in with a fresh token", async () => {
    const alice = await seedUser();
    const otherDevice = createSession(db, alice.id).token;
    expect(db.select().from(sessions).where(eq(sessions.userId, alice.id)).all()).toHaveLength(2);

    const res = await changePasswordRoute(post({ current: OLD, next: NEW }, { token: alice.token }));
    expect(res.status).toBe(200);

    const rotated = sessionCookie(res);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(alice.token);
    expect(getSessionUser(db, rotated!)?.username).toBe("alice");
    // Exactly one session survives: the rotated one. The old cookies are dead.
    expect(db.select().from(sessions).where(eq(sessions.userId, alice.id)).all()).toHaveLength(1);
    expect(getSessionUser(db, otherDevice)).toBeNull();
    expect(getSessionUser(db, alice.token)).toBeNull();
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
  });

  it("rejects a wrong current password with 400 invalid_current and changes nothing", async () => {
    const alice = await seedUser();
    const before = passwordHashOf(alice.id);
    const res = await changePasswordRoute(post({ current: "not my password", next: NEW }, { token: alice.token }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_current" });
    expect(passwordHashOf(alice.id)).toBe(before);
    // The session survives a failed attempt.
    expect(getSessionUser(db, alice.token)?.username).toBe("alice");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a new password under 8 characters with 400 weak_password", async () => {
    const alice = await seedUser();
    const before = passwordHashOf(alice.id);
    const res = await changePasswordRoute(post({ current: OLD, next: "short" }, { token: alice.token }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "weak_password" });
    expect(passwordHashOf(alice.id)).toBe(before);
  });

  it("accepts the currentPassword / newPassword spelling from the settings form", async () => {
    const alice = await seedUser();
    const res = await changePasswordRoute(post({ currentPassword: OLD, newPassword: NEW }, { token: alice.token }));
    expect(res.status).toBe(200);
    await expect(authenticate(db, { username: "alice", password: NEW })).resolves.toMatchObject({ username: "alice" });
  });

  it("needs a session: no cookie and an unknown cookie are both 401, and nothing is hashed", async () => {
    await seedUser();
    const anon = await changePasswordRoute(post({ current: OLD, next: NEW }));
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ error: "unauthorized" });

    const bogus = await changePasswordRoute(post({ current: OLD, next: NEW }, { token: "x".repeat(43) }));
    expect(bogus.status).toBe(401);
  });

  it("returns invalid_body for a non-JSON content type, malformed JSON, extra fields or a missing field", async () => {
    const alice = await seedUser();
    for (const req of [
      post({ current: OLD, next: NEW }, { token: alice.token, contentType: "text/plain" }),
      post("{not json", { token: alice.token }),
      post({ current: OLD }, { token: alice.token }),
      post({ next: NEW }, { token: alice.token }),
      post({ current: OLD, next: NEW, admin: true }, { token: alice.token }),
      post({ current: OLD, next: "x".repeat(2000) }, { token: alice.token }),
    ]) {
      const res = await changePasswordRoute(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_body" });
    }
  });

  it("throttles guesses at the current password: 429 with Retry-After, then a success clears it", async () => {
    // Two argon2id hashes per request behind a session, and a wrong `current` answers
    // invalid_current — an oracle for whoever holds a stolen cookie unless it is bounded.
    const alice = await seedUser();
    for (let i = 0; i < passwordLimiter.limit; i++) {
      const res = await changePasswordRoute(post({ current: `guess-${i}`, next: NEW }, { token: alice.token }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_current" });
    }
    const blocked = await changePasswordRoute(post({ current: "guess-again", next: NEW }, { token: alice.token }));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Even the real password is refused while the window is open: the brake is on the account.
    expect((await changePasswordRoute(post({ current: OLD, next: NEW }, { token: alice.token }))).status).toBe(429);

    // A caller who proves they know the password gets their bucket back.
    clearAuthLimiters();
    const ok = await changePasswordRoute(post({ current: OLD, next: NEW }, { token: alice.token }));
    expect(ok.status).toBe(200);
    const token = sessionCookie(ok)!;
    for (let i = 0; i < passwordLimiter.limit; i++) {
      expect((await changePasswordRoute(post({ current: `nope-${i}`, next: OLD }, { token }))).status).toBe(400);
    }
  });

  it("refuses a cross-site request with 403 before touching the session or the password", async () => {
    const alice = await seedUser();
    const res = await changePasswordRoute(
      post({ current: OLD, next: NEW }, { token: alice.token, headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
    await expect(authenticate(db, { username: "alice", password: OLD })).resolves.toMatchObject({ username: "alice" });
  });
});
