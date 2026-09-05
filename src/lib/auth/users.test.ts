import { describe, expect, it, vi } from "vitest";
import { AuthError, SettingsValidationError } from "@/lib/auth/errors";
import { createInvite, listUnusedInvites } from "@/lib/auth/invites";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  DUMMY_PASSWORD_HASH,
  authenticate,
  getUserById,
  getUserByUsername,
  isValidHHMM,
  isValidTimeZone,
  listUsers,
  normalizeUsername,
  registerWithInvite,
  updateUserSettings,
} from "@/lib/auth/users";
import { encryptSecret } from "@/lib/crypto/aes";
import { openTestDb } from "@/lib/db/client";
import { userKeys } from "@/lib/db/schema";

const T0 = new Date("2026-09-06T10:00:00Z");
const PASSWORD = "correct horse battery staple";

async function seed(db = openTestDb()) {
  const { code } = createInvite(db, { createdBy: "admin", intendedFor: "alice" }, { now: T0 });
  const user = await registerWithInvite(db, { inviteCode: code, username: "Alice", password: PASSWORD }, { now: T0 });
  return { db, user };
}

async function code(db: ReturnType<typeof openTestDb>) {
  return createInvite(db, { createdBy: "admin" }, { now: T0 }).code;
}

describe("registerWithInvite", () => {
  it("creates a user with a lower-cased username, a uuid id and no hash in the result", async () => {
    const { db, user } = await seed();
    expect(user.username).toBe("alice");
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.createdAt).toBe(T0.toISOString());
    expect(user.timezone).toBe("UTC");
    expect(user.locale).toBe("en");
    expect("passwordHash" in user).toBe(false);
    expect(JSON.stringify(user)).not.toContain("argon2");
    expect(listUnusedInvites(db)).toHaveLength(0);
    expect(getUserById(db, user.id)).toEqual(user);
    expect(getUserByUsername(db, " ALICE ")).toEqual(user);
    expect(getUserById(db, "nope")).toBeNull();
  });

  it("validates usernames and passwords before consuming the invite", async () => {
    const db = openTestDb();
    const c = await code(db);
    for (const bad of ["ab", "a".repeat(33), "Bad Name", "émile", "alice!", ""]) {
      await expect(registerWithInvite(db, { inviteCode: c, username: bad, password: PASSWORD })).rejects.toMatchObject({
        code: "invalid_username",
      });
    }
    await expect(registerWithInvite(db, { inviteCode: c, username: "bob", password: "short" })).rejects.toMatchObject({
      code: "weak_password",
    });
    expect(listUnusedInvites(db)).toHaveLength(1);
    expect(normalizeUsername("  Bob.Smith-1_ ")).toBe("bob.smith-1_");
    expect(normalizeUsername("no")).toBeNull();
  });

  it("rejects a bad invite and a taken username without burning anything", async () => {
    const { db } = await seed();
    await expect(registerWithInvite(db, { inviteCode: "ZZZZZZZZZZZZ", username: "bob", password: PASSWORD })).rejects.toMatchObject({
      code: "invalid_invite",
    });
    const c = await code(db);
    await expect(registerWithInvite(db, { inviteCode: c, username: "ALICE", password: PASSWORD })).rejects.toMatchObject({
      code: "username_taken",
    });
    // The transaction rolled back: the invite is still redeemable.
    expect(listUnusedInvites(db).map((i) => i.code)).toEqual([c]);
    const bob = await registerWithInvite(db, { inviteCode: c, username: "bob", password: PASSWORD }, { now: new Date(T0.getTime() + 1) });
    expect(bob.username).toBe("bob");
    expect(listUsers(db).map((u) => u.username)).toEqual(["alice", "bob"]);
  });
});

describe("authenticate", () => {
  it("returns the user for the right password, case-insensitively on username", async () => {
    const { db, user } = await seed();
    const got = await authenticate(db, { username: "  ALICE ", password: PASSWORD });
    expect(got).toEqual(user);
    expect("passwordHash" in got).toBe(false);
  });

  it("fails identically for a wrong password and an unknown user, verifying in both paths", async () => {
    const { db } = await seed();
    const verify = vi.fn(verifyPassword);

    const wrong = await authenticate(db, { username: "alice", password: "not it" }, { verify }).catch((e: unknown) => e);
    const unknown = await authenticate(db, { username: "nobody", password: PASSWORD }, { verify }).catch((e: unknown) => e);

    expect(wrong).toBeInstanceOf(AuthError);
    expect(unknown).toBeInstanceOf(AuthError);
    expect((wrong as AuthError).code).toBe("invalid_credentials");
    expect((unknown as AuthError).code).toBe("invalid_credentials");
    expect((wrong as AuthError).message).toBe((unknown as AuthError).message);
    expect((unknown as AuthError).message).not.toContain("nobody");

    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls[0]?.[1]).toMatch(/^\$argon2id\$/);
    expect(verify.mock.calls[0]?.[1]).not.toBe(DUMMY_PASSWORD_HASH);
    expect(verify.mock.calls[1]?.[1]).toBe(DUMMY_PASSWORD_HASH);
  });

  it("never accepts the dummy hash's password for an unknown user", async () => {
    const db = openTestDb();
    const verify = vi.fn(async () => true); // hostile verifier: still must fail for an unknown user
    await expect(authenticate(db, { username: "ghost", password: "x" }, { verify })).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("uses a dummy hash produced with the real parameters", async () => {
    expect(DUMMY_PASSWORD_HASH.startsWith("$argon2id$v=19$m=65536,t=3,p=1$")).toBe(true);
    expect(await verifyPassword("anything", DUMMY_PASSWORD_HASH)).toBe(false);
    const real = await hashPassword(PASSWORD);
    expect(real.startsWith("$argon2id$v=19$m=65536,t=3,p=1$")).toBe(true);
  });
});

describe("listUsers", () => {
  it("reports hasSeatsKey without exposing any key material", async () => {
    const { db, user } = await seed();
    const c = await code(db);
    const bob = await registerWithInvite(db, { inviteCode: c, username: "bob", password: PASSWORD }, { now: T0 });
    const blob = encryptSecret("pro_secret_key_1234", Buffer.alloc(32, 7));
    db.insert(userKeys)
      .values({ userId: bob.id, provider: "seats_aero", ...blob, last4: "1234", createdAt: T0.toISOString() })
      .run();
    db.insert(userKeys)
      .values({ userId: user.id, provider: "duffel", ...blob, last4: "1234", createdAt: T0.toISOString() })
      .run();
    const rows = listUsers(db);
    expect(rows).toEqual([
      { id: user.id, username: "alice", createdAt: T0.toISOString(), hasSeatsKey: false },
      { id: bob.id, username: "bob", createdAt: T0.toISOString(), hasSeatsKey: true },
    ]);
    expect(JSON.stringify(rows)).not.toContain("pro_secret");
    expect(JSON.stringify(rows)).not.toContain(blob.ciphertext);
  });
});

describe("updateUserSettings", () => {
  it("validates HH:MM and IANA zones", () => {
    expect(isValidHHMM("00:00")).toBe(true);
    expect(isValidHHMM("23:59")).toBe(true);
    expect(isValidHHMM("24:00")).toBe(false);
    expect(isValidHHMM("9:00")).toBe(false);
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("applies a valid patch and rejects invalid fields field-by-field", async () => {
    const { db, user } = await seed();
    const updated = updateUserSettings(db, user.id, {
      locale: "zh",
      timezone: "Asia/Shanghai",
      quietHoursStart: "22:00",
      quietHoursEnd: "07:30",
    });
    expect(updated).toMatchObject({ locale: "zh", timezone: "Asia/Shanghai", quietHoursStart: "22:00", quietHoursEnd: "07:30" });
    expect("passwordHash" in updated).toBe(false);

    const cleared = updateUserSettings(db, user.id, { quietHoursStart: null, quietHoursEnd: null });
    expect(cleared.quietHoursStart).toBeNull();
    expect(cleared.quietHoursEnd).toBeNull();

    expect(() => updateUserSettings(db, user.id, { locale: "fr" })).toThrow(SettingsValidationError);
    expect(() => updateUserSettings(db, user.id, { timezone: "Nowhere/Land" })).toThrow(/time zone/);
    expect(() => updateUserSettings(db, user.id, { quietHoursStart: "25:00" })).toThrow(/HH:MM/);
    expect(() => updateUserSettings(db, user.id, { quietHoursEnd: "7pm" })).toThrow(SettingsValidationError);
    // Nothing partial was written.
    expect(getUserById(db, user.id)).toMatchObject({ locale: "zh", timezone: "Asia/Shanghai" });
    // An empty patch is a no-op that still returns the user.
    expect(updateUserSettings(db, user.id, {})).toEqual(getUserById(db, user.id));
  });
});
