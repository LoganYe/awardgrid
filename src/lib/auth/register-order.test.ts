/**
 * Registration must reject an unusable invite BEFORE it spends argon2 time.
 *
 * POST /api/auth/register is unauthenticated, and argon2id here is 64 MiB / timeCost 3: hashing
 * first would let anyone with no invite code at all pin a libuv threadpool slot and 64 MiB per
 * request, indefinitely. The order is asserted by mocking `hashPassword` and checking it was
 * never reached — a timing assertion would only be a slower way to say the same thing, and a
 * flakier one.
 */
import { describe, expect, it, vi } from "vitest";
import { createInvite, listUnusedInvites } from "@/lib/auth/invites";
import { openTestDb } from "@/lib/db/client";

const { hashSpy } = vi.hoisted(() => ({ hashSpy: vi.fn(async (password: string) => `argon2id-stand-in:${password}`) }));

vi.mock("@/lib/auth/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/password")>();
  return { ...actual, hashPassword: hashSpy };
});

const { registerWithInvite } = await import("@/lib/auth/users");

const T0 = new Date("2026-09-06T10:00:00Z");
const PASSWORD = "correct horse battery staple";

describe("registerWithInvite: work order", () => {
  it("never hashes a password for an invite that cannot be redeemed", async () => {
    const db = openTestDb();
    const { code } = createInvite(db, { createdBy: "admin" }, { now: T0 });
    hashSpy.mockClear();

    for (const bad of ["ZZZZZZZZZZZZ", "nope", "' OR 1=1 --", ""]) {
      await expect(registerWithInvite(db, { inviteCode: bad, username: "bob", password: PASSWORD })).rejects.toMatchObject({
        code: "invalid_invite",
      });
    }
    expect(hashSpy).not.toHaveBeenCalled();
    expect(listUnusedInvites(db).map((i) => i.code)).toEqual([code]);
  });

  it("still hashes once for a code that can be redeemed", async () => {
    const db = openTestDb();
    const { code } = createInvite(db, { createdBy: "admin" }, { now: T0 });
    hashSpy.mockClear();

    await expect(registerWithInvite(db, { inviteCode: code, username: "bob", password: PASSWORD }, { now: T0 })).resolves.toMatchObject({
      username: "bob",
    });
    expect(hashSpy).toHaveBeenCalledTimes(1);
    expect(listUnusedInvites(db)).toHaveLength(0);

    // A code consumed by that registration is no longer worth hashing for.
    hashSpy.mockClear();
    await expect(registerWithInvite(db, { inviteCode: code, username: "carol", password: PASSWORD })).rejects.toMatchObject({
      code: "invalid_invite",
    });
    expect(hashSpy).not.toHaveBeenCalled();
  });

  it("checks the username and the password shape before the invite, so neither leaks a valid code", async () => {
    const db = openTestDb();
    const { code } = createInvite(db, { createdBy: "admin" }, { now: T0 });
    hashSpy.mockClear();

    await expect(registerWithInvite(db, { inviteCode: "ZZZZZZZZZZZZ", username: "B O B", password: PASSWORD })).rejects.toMatchObject({
      code: "invalid_username",
    });
    await expect(registerWithInvite(db, { inviteCode: "ZZZZZZZZZZZZ", username: "bob", password: "short" })).rejects.toMatchObject({
      code: "weak_password",
    });
    expect(hashSpy).not.toHaveBeenCalled();
    expect(listUnusedInvites(db).map((i) => i.code)).toEqual([code]);
  });
});
