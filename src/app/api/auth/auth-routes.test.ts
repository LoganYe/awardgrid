/**
 * Route-handler tests for /api/auth/* against an in-memory SQLite (openTestDb) injected through
 * the getServerDb() indirection. No network, no env keys.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInvite, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { openTestDb, type Db } from "@/lib/db/client";
import { clearAuthLimiters, registerLimiter, TRUST_PROXY_ENV } from "@/lib/server/rate-limit";

let db: Db;
vi.mock("@/lib/server/db", () => ({ getServerDb: () => db }));

// Count argon2 verifications so tests can prove refused/invalid attempts never reach it.
const verifyCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/auth/password", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/password")>();
  return {
    ...mod,
    verifyPassword: async (password: string, hash: string) => {
      verifyCalls.n += 1;
      return mod.verifyPassword(password, hash);
    },
  };
});

// Import after the mock is registered.
const { POST: register } = await import("./register/route");
const { POST: login } = await import("./login/route");
const { POST: logout } = await import("./logout/route");
const { GET: me } = await import("./me/route");

const PASSWORD = "correct horse battery";

function post(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers });
}

/** Parse the session token out of a Set-Cookie header. */
function sessionCookie(res: Response): { token: string; raw: string } | null {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  const m = raw.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return m ? { token: m[1] ?? "", raw } : null;
}

async function registerUser(username = "alice"): Promise<{ token: string; id: string }> {
  const { code } = createInvite(db, { createdBy: "admin", intendedFor: username });
  const res = await register(post("/api/auth/register", { inviteCode: code, username, password: PASSWORD }));
  expect(res.status).toBe(201);
  const body = (await res.json()) as { user: { id: string; username: string } };
  const cookie = sessionCookie(res);
  expect(cookie).not.toBeNull();
  return { token: cookie!.token, id: body.user.id };
}

beforeEach(() => {
  db = openTestDb();
  clearAuthLimiters();
  verifyCalls.n = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env[TRUST_PROXY_ENV];
});

describe("POST /api/auth/register", () => {
  it("creates the user, sets an httpOnly session cookie and returns only id+username", async () => {
    const { code } = createInvite(db, { createdBy: "admin" });
    const res = await register(post("/api/auth/register", { inviteCode: code, username: "Alice", password: PASSWORD }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(Object.keys(body.user).sort()).toEqual(["id", "username"]);
    expect(body.user.username).toBe("alice");

    const cookie = sessionCookie(res);
    expect(cookie).not.toBeNull();
    expect(cookie!.raw).toMatch(/HttpOnly/i);
    expect(cookie!.raw).toMatch(/Path=\//i);
    expect(cookie!.raw).toMatch(/SameSite=lax/i);
    expect(cookie!.token.length).toBeGreaterThan(20);
    // The token is only in the cookie, never in the body.
    expect(JSON.stringify(body)).not.toContain(cookie!.token);
    expect(getSessionUser(db, cookie!.token)?.username).toBe("alice");
  });

  it("rejects a bad invite, a weak password, a bad username and a taken username with codes", async () => {
    const bad = await register(post("/api/auth/register", { inviteCode: "nope", username: "bob", password: PASSWORD }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_invite" });

    const { code } = createInvite(db, { createdBy: "admin" });
    const weak = await register(post("/api/auth/register", { inviteCode: code, username: "bob", password: "short" }));
    expect(weak.status).toBe(400);
    expect(await weak.json()).toEqual({ error: "weak_password" });

    const badName = await register(post("/api/auth/register", { inviteCode: code, username: "B O B", password: PASSWORD }));
    expect(await badName.json()).toEqual({ error: "invalid_username" });

    await registerUser("bob");
    const { code: code2 } = createInvite(db, { createdBy: "admin" });
    const taken = await register(post("/api/auth/register", { inviteCode: code2, username: "bob", password: PASSWORD }));
    expect(taken.status).toBe(400);
    expect(await taken.json()).toEqual({ error: "username_taken" });
    // No cookie on failures.
    expect(taken.headers.get("set-cookie")).toBeNull();
  });

  it("returns invalid_body for malformed JSON or missing fields", async () => {
    const res1 = await register(post("/api/auth/register", "{not json"));
    expect(res1.status).toBe(400);
    expect(await res1.json()).toEqual({ error: "invalid_body" });
    const res2 = await register(post("/api/auth/register", { username: "x" }));
    expect(await res2.json()).toEqual({ error: "invalid_body" });
  });

  it("throttles unauthenticated attempts with 429 and Retry-After", async () => {
    // The route hashes with argon2id (64 MiB), so an unauthenticated flood is a CPU and memory
    // DoS. The per-IP layer is the visible one here; the process-wide layer sits above it.
    for (let i = 0; i < registerLimiter.limit; i++) {
      const res = await register(post("/api/auth/register", { inviteCode: "ZZZZZZZZZZZZ", username: "bob", password: PASSWORD }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_invite" });
    }
    const { code } = createInvite(db, { createdBy: "admin" });
    const blocked = await register(post("/api/auth/register", { inviteCode: code, username: "bob", password: PASSWORD }));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.headers.get("set-cookie")).toBeNull();
  });

  it("never echoes the password or invite code in responses or logs", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { code } = createInvite(db, { createdBy: "admin" });
    const res = await register(post("/api/auth/register", { inviteCode: code, username: "!!", password: PASSWORD }));
    const text = await res.text();
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(code);
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(PASSWORD);
      expect(JSON.stringify(call)).not.toContain(code);
    }
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with the right password and sets a cookie", async () => {
    await registerUser("alice");
    const res = await login(post("/api/auth/login", { username: "ALICE", password: PASSWORD }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(Object.keys(body.user).sort()).toEqual(["id", "username"]);
    const cookie = sessionCookie(res);
    expect(cookie).not.toBeNull();
    expect(getSessionUser(db, cookie!.token)?.username).toBe("alice");
  });

  it("returns 401 invalid_credentials for a wrong password and for an unknown user", async () => {
    await registerUser("alice");
    const wrong = await login(post("/api/auth/login", { username: "alice", password: "wrong password" }));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "invalid_credentials" });
    expect(wrong.headers.get("set-cookie")).toBeNull();

    const unknown = await login(post("/api/auth/login", { username: "nobody", password: PASSWORD }));
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ error: "invalid_credentials" });
  });

  it("rate limits after 10 attempts per username+IP and isolates other IPs (behind a declared proxy)", async () => {
    process.env[TRUST_PROXY_ENV] = "1";
    await registerUser("alice");
    const ip = { "x-forwarded-for": "10.0.0.7" };
    for (let i = 0; i < 10; i++) {
      const r = await login(post("/api/auth/login", { username: "alice", password: "wrong" }, ip));
      expect(r.status).toBe(401);
    }
    const blocked = await login(post("/api/auth/login", { username: "alice", password: PASSWORD }, ip));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    // A different IP for the same user is not blocked, nor another user from the blocked IP.
    const otherIp = await login(post("/api/auth/login", { username: "alice", password: PASSWORD }, { "x-forwarded-for": "10.0.0.8" }));
    expect(otherIp.status).toBe(200);
    const otherUser = await login(post("/api/auth/login", { username: "carol", password: PASSWORD }, ip));
    expect(otherUser.status).toBe(401);
  });

  it("without a declared proxy, rotating x-forwarded-for does not unlock more attempts", async () => {
    await registerUser("alice");
    let blocked = 0;
    for (let i = 0; i < 30; i++) {
      const r = await login(post("/api/auth/login", { username: "alice", password: "wrong" }, { "x-forwarded-for": `10.0.0.${i}` }));
      if (r.status === 429) blocked += 1;
      else expect(r.status).toBe(401);
    }
    expect(blocked).toBe(20); // 10 real attempts, then every spoofed "new client" is refused
    const correct = await login(post("/api/auth/login", { username: "alice", password: PASSWORD }, { "cf-connecting-ip": "9.9.9.9" }));
    expect(correct.status).toBe(429);
  });

  it("behind a declared proxy the username-only layer still caps rotating IPs at 20 attempts", async () => {
    process.env[TRUST_PROXY_ENV] = "1";
    await registerUser("alice");
    verifyCalls.n = 0;
    let ok401 = 0;
    for (let i = 0; i < 40; i++) {
      const r = await login(post("/api/auth/login", { username: "alice", password: "wrong" }, { "x-forwarded-for": `10.1.${i}.1` }));
      if (r.status === 401) ok401 += 1;
      else expect(r.status).toBe(429);
    }
    expect(ok401).toBe(20);
    expect((await login(post("/api/auth/login", { username: "alice", password: PASSWORD }, { "x-forwarded-for": "10.9.9.9" }))).status).toBe(429);
    // Refused attempts never reach argon2.
    expect(verifyCalls.n).toBe(20);
  });

  it("caps the username length and skips argon2 for names that cannot exist", async () => {
    const tooLong = await login(post("/api/auth/login", { username: "a".repeat(10_000), password: PASSWORD }));
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: "invalid_body" });
    const badFormat = await login(post("/api/auth/login", { username: "B O B", password: PASSWORD }));
    expect(badFormat.status).toBe(401);
    expect(await badFormat.json()).toEqual({ error: "invalid_credentials" });
    const hugePassword = await login(post("/api/auth/login", { username: "alice", password: "p".repeat(5000) }));
    expect(hugePassword.status).toBe(400);
    expect(verifyCalls.n).toBe(0);
  });

  it("rejects a body without a JSON content type (cross-site form post)", async () => {
    await registerUser("alice");
    const res = await login(
      new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ username: "alice", password: PASSWORD, x: "" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("a successful login resets the counter", async () => {
    await registerUser("alice");
    for (let i = 0; i < 9; i++) {
      await login(post("/api/auth/login", { username: "alice", password: "wrong" }));
    }
    expect((await login(post("/api/auth/login", { username: "alice", password: PASSWORD }))).status).toBe(200);
    for (let i = 0; i < 9; i++) {
      await login(post("/api/auth/login", { username: "alice", password: "wrong" }));
    }
    expect((await login(post("/api/auth/login", { username: "alice", password: PASSWORD }))).status).toBe(200);
  });

  it("returns invalid_body on garbage", async () => {
    const res = await login(post("/api/auth/login", { username: 1 }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/auth/me", () => {
  it("returns the public user with hasSeatsKey=false and no hash", async () => {
    const { token, id } = await registerUser("alice");
    const res = await me(get("/api/auth/me", { cookie: `${SESSION_COOKIE}=${token}` }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(body.user).toEqual({ id, username: "alice", locale: "en", timezone: "UTC", theme: "system", seatsConnected: false });
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|argon2/);
  });

  it("reports seatsConnected=true once seats.aero is connected (never a token)", async () => {
    const { token, id } = await registerUser("alice");
    const { connectForTests } = await import("@/lib/seats-oauth/testing");
    const connection = connectForTests(db, id, { masterKey: Buffer.alloc(32, 3) });
    const res = await me(get("/api/auth/me", { cookie: `${SESSION_COOKIE}=${token}` }));
    const body = (await res.json()) as { user: { seatsConnected: boolean } };
    expect(body.user.seatsConnected).toBe(true);
    expect(JSON.stringify(body)).not.toContain(connection.access);
    expect(JSON.stringify(body)).not.toContain("seats:o");
  });

  it("returns 401 without a cookie, with a garbage token, and after logout", async () => {
    expect((await me(get("/api/auth/me"))).status).toBe(401);
    expect((await me(get("/api/auth/me", { cookie: `${SESSION_COOKIE}=garbage` }))).status).toBe(401);
    const { token } = await registerUser("alice");
    const out = await logout(post("/api/auth/logout", "", { cookie: `${SESSION_COOKIE}=${token}` }));
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect((await me(get("/api/auth/me", { cookie: `${SESSION_COOKIE}=${token}` }))).status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("is idempotent without a cookie", async () => {
    const res = await logout(post("/api/auth/logout", ""));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });
});
