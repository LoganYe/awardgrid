import { afterEach, describe, expect, it } from "vitest";
import { createInvite } from "@/lib/auth/invites";
import { registerWithInvite } from "@/lib/auth/users";
import { MasterKeyError } from "@/lib/crypto/aes";
import { openTestDb } from "@/lib/db/client";
import { userKeys } from "@/lib/db/schema";
import {
  KeyError,
  NoKeyError,
  getDecryptedKey,
  getMasterKey,
  hasKey,
  listKeys,
  removeKey,
  requireKey,
  resetMasterKeyCache,
  setKey,
} from "@/lib/keys";

const T0 = new Date("2026-09-06T10:00:00Z");
const MASTER = Buffer.from("0f".repeat(32), "hex");
const OTHER_MASTER = Buffer.from("aa".repeat(32), "hex");
const PLAINTEXT = "pro_live_SECRET_do_not_leak_9876";

async function seed() {
  const db = openTestDb();
  const a = createInvite(db, { createdBy: "admin" }, { now: T0 });
  const b = createInvite(db, { createdBy: "admin" }, { now: T0 });
  const alice = await registerWithInvite(db, { inviteCode: a.code, username: "alice", password: "password-alice" }, { now: T0 });
  const bob = await registerWithInvite(db, { inviteCode: b.code, username: "bob", password: "password-bob00" }, { now: T0 });
  return { db, alice, bob };
}

describe("key store (the optional Duffel and Ignav keys; seats.aero is never a key here)", () => {
  it("knows no seats.aero provider", async () => {
    const { db, alice } = await seed();
    expect(() => setKey(db, alice.id, "seats_aero" as never, PLAINTEXT, { masterKey: MASTER, now: T0 })).toThrow(KeyError);
    expect(db.select().from(userKeys).all()).toHaveLength(0);
  });

  it("round-trips a key: masked listing, decrypted plaintext only via getDecryptedKey", async () => {
    const { db, alice } = await seed();
    const summary = setKey(db, alice.id, "ignav", `  ${PLAINTEXT}\n`, { masterKey: MASTER, now: T0 });
    expect(summary).toEqual({ provider: "ignav", last4: "9876", masked: "••••9876", createdAt: T0.toISOString() });

    const listed = listKeys(db, alice.id);
    expect(listed).toEqual([summary]);
    const json = JSON.stringify(listed);
    expect(json).not.toContain(PLAINTEXT);
    expect(json).not.toContain("SECRET");
    expect(json).toContain("••••9876");

    // Nothing in the row is the plaintext either.
    const row = db.select().from(userKeys).all()[0]!;
    expect(JSON.stringify(row)).not.toContain(PLAINTEXT);
    expect(Buffer.from(row.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(row.tag, "base64")).toHaveLength(16);

    expect(getDecryptedKey(db, alice.id, "ignav", MASTER)).toBe(PLAINTEXT);
    expect(requireKey(db, alice.id, "ignav", MASTER)).toBe(PLAINTEXT);
    expect(hasKey(db, alice.id, "ignav")).toBe(true);
    expect(hasKey(db, alice.id, "duffel")).toBe(false);
    // The wrong master key cannot decrypt (GCM tag check).
    expect(() => getDecryptedKey(db, alice.id, "ignav", OTHER_MASTER)).toThrow();
  });

  it("upserts (replace) and keeps providers and users independent", async () => {
    const { db, alice, bob } = await seed();
    setKey(db, alice.id, "ignav", "alice-key-AAAA", { masterKey: MASTER, now: T0 });
    setKey(db, bob.id, "ignav", "bob-key-BBBB", { masterKey: MASTER, now: T0 });
    setKey(db, alice.id, "duffel", "duffel-key-DDDD", { masterKey: MASTER, now: T0 });
    const later = new Date("2026-09-07T00:00:00Z");
    setKey(db, alice.id, "ignav", "alice-key-CCCC", { masterKey: MASTER, now: later });

    expect(listKeys(db, alice.id)).toEqual([
      { provider: "duffel", last4: "DDDD", masked: "••••DDDD", createdAt: T0.toISOString() },
      { provider: "ignav", last4: "CCCC", masked: "••••CCCC", createdAt: later.toISOString() },
    ]);
    expect(listKeys(db, bob.id)).toEqual([{ provider: "ignav", last4: "BBBB", masked: "••••BBBB", createdAt: T0.toISOString() }]);
    expect(getDecryptedKey(db, alice.id, "ignav", MASTER)).toBe("alice-key-CCCC");
    expect(getDecryptedKey(db, bob.id, "ignav", MASTER)).toBe("bob-key-BBBB");
    expect(db.select().from(userKeys).all()).toHaveLength(3);
  });

  it("rejects empty, whitespace, too-long keys and unknown providers", async () => {
    const { db, alice } = await seed();
    const o = { masterKey: MASTER, now: T0 };
    expect(() => setKey(db, alice.id, "ignav", "", o)).toThrow(KeyError);
    expect(() => setKey(db, alice.id, "ignav", "   \t\n", o)).toThrow(/required/);
    expect(() => setKey(db, alice.id, "ignav", "k".repeat(513), o)).toThrow(/too long/);
    expect(() => setKey(db, alice.id, "ignav", "k".repeat(512), o)).not.toThrow();
    expect(() => setKey(db, alice.id, "stripe" as never, "x", o)).toThrow(KeyError);
    try {
      setKey(db, alice.id, "ignav", "", o);
    } catch (err) {
      expect((err as KeyError).code).toBe("empty");
    }
  });

  it("removeKey deletes and requireKey throws NoKeyError afterwards", async () => {
    const { db, alice } = await seed();
    setKey(db, alice.id, "ignav", PLAINTEXT, { masterKey: MASTER, now: T0 });
    expect(removeKey(db, alice.id, "ignav")).toBe(true);
    expect(removeKey(db, alice.id, "ignav")).toBe(false);
    expect(listKeys(db, alice.id)).toEqual([]);
    expect(getDecryptedKey(db, alice.id, "ignav", MASTER)).toBeNull();

    const err = (() => {
      try {
        requireKey(db, alice.id, "ignav", MASTER);
        return null;
      } catch (e) {
        return e as NoKeyError;
      }
    })();
    expect(err).toBeInstanceOf(NoKeyError);
    expect(err?.code).toBe("no_key");
    expect(err?.provider).toBe("ignav");
    expect(err?.message).toMatch(/Ignav/);
    expect(err?.message).not.toContain(alice.id);
  });
});

describe("getMasterKey", () => {
  const saved = process.env.MASTER_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.MASTER_KEY;
    else process.env.MASTER_KEY = saved;
    resetMasterKeyCache();
  });

  it("parses MASTER_KEY once and never echoes it in errors", () => {
    resetMasterKeyCache();
    process.env.MASTER_KEY = "deadbeef";
    let msg = "";
    try {
      getMasterKey();
    } catch (e) {
      expect(e).toBeInstanceOf(MasterKeyError);
      msg = (e as Error).message;
    }
    expect(msg).not.toContain("deadbeef");

    process.env.MASTER_KEY = "ab".repeat(32);
    const k1 = getMasterKey();
    expect(k1).toHaveLength(32);
    process.env.MASTER_KEY = "cd".repeat(32);
    expect(getMasterKey()).toBe(k1); // memoized
    resetMasterKeyCache();
    expect(getMasterKey().equals(Buffer.from("cd".repeat(32), "hex"))).toBe(true);
  });
});
