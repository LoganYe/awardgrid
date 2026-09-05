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
  recordValidationCall,
  removeKey,
  requireKey,
  resetMasterKeyCache,
  setKey,
  validateSeatsAeroKey,
} from "@/lib/keys";
import { InMemoryQuotaStore } from "@/lib/seatsaero/quota";
import { fakeFetch, jsonResponse, loadFixture, textResponse } from "../../../test/fixtures/seatsaero/helpers";

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

describe("key store", () => {
  it("round-trips a key: masked listing, decrypted plaintext only via getDecryptedKey", async () => {
    const { db, alice } = await seed();
    const summary = setKey(db, alice.id, "seats_aero", `  ${PLAINTEXT}\n`, { masterKey: MASTER, now: T0 });
    expect(summary).toEqual({ provider: "seats_aero", last4: "9876", masked: "••••9876", createdAt: T0.toISOString() });

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

    expect(getDecryptedKey(db, alice.id, "seats_aero", MASTER)).toBe(PLAINTEXT);
    expect(requireKey(db, alice.id, "seats_aero", MASTER)).toBe(PLAINTEXT);
    expect(hasKey(db, alice.id, "seats_aero")).toBe(true);
    expect(hasKey(db, alice.id, "duffel")).toBe(false);
    // The wrong master key cannot decrypt (GCM tag check).
    expect(() => getDecryptedKey(db, alice.id, "seats_aero", OTHER_MASTER)).toThrow();
  });

  it("upserts (replace) and keeps providers and users independent", async () => {
    const { db, alice, bob } = await seed();
    setKey(db, alice.id, "seats_aero", "alice-key-AAAA", { masterKey: MASTER, now: T0 });
    setKey(db, bob.id, "seats_aero", "bob-key-BBBB", { masterKey: MASTER, now: T0 });
    setKey(db, alice.id, "duffel", "duffel-key-DDDD", { masterKey: MASTER, now: T0 });
    const later = new Date("2026-09-07T00:00:00Z");
    setKey(db, alice.id, "seats_aero", "alice-key-CCCC", { masterKey: MASTER, now: later });

    expect(listKeys(db, alice.id)).toEqual([
      { provider: "duffel", last4: "DDDD", masked: "••••DDDD", createdAt: T0.toISOString() },
      { provider: "seats_aero", last4: "CCCC", masked: "••••CCCC", createdAt: later.toISOString() },
    ]);
    expect(listKeys(db, bob.id)).toEqual([{ provider: "seats_aero", last4: "BBBB", masked: "••••BBBB", createdAt: T0.toISOString() }]);
    expect(getDecryptedKey(db, alice.id, "seats_aero", MASTER)).toBe("alice-key-CCCC");
    expect(getDecryptedKey(db, bob.id, "seats_aero", MASTER)).toBe("bob-key-BBBB");
    expect(db.select().from(userKeys).all()).toHaveLength(3);
  });

  it("rejects empty, whitespace, too-long keys and unknown providers", async () => {
    const { db, alice } = await seed();
    const o = { masterKey: MASTER, now: T0 };
    expect(() => setKey(db, alice.id, "seats_aero", "", o)).toThrow(KeyError);
    expect(() => setKey(db, alice.id, "seats_aero", "   \t\n", o)).toThrow(/required/);
    expect(() => setKey(db, alice.id, "seats_aero", "k".repeat(513), o)).toThrow(/too long/);
    expect(() => setKey(db, alice.id, "seats_aero", "k".repeat(512), o)).not.toThrow();
    expect(() => setKey(db, alice.id, "stripe" as never, "x", o)).toThrow(KeyError);
    try {
      setKey(db, alice.id, "seats_aero", "", o);
    } catch (err) {
      expect((err as KeyError).code).toBe("empty");
    }
  });

  it("removeKey deletes and requireKey throws NoKeyError afterwards", async () => {
    const { db, alice } = await seed();
    setKey(db, alice.id, "seats_aero", PLAINTEXT, { masterKey: MASTER, now: T0 });
    expect(removeKey(db, alice.id, "seats_aero")).toBe(true);
    expect(removeKey(db, alice.id, "seats_aero")).toBe(false);
    expect(listKeys(db, alice.id)).toEqual([]);
    expect(getDecryptedKey(db, alice.id, "seats_aero", MASTER)).toBeNull();

    const err = (() => {
      try {
        requireKey(db, alice.id, "seats_aero", MASTER);
        return null;
      } catch (e) {
        return e as NoKeyError;
      }
    })();
    expect(err).toBeInstanceOf(NoKeyError);
    expect(err?.code).toBe("no_key");
    expect(err?.provider).toBe("seats_aero");
    expect(err?.message).toMatch(/seats\.aero/);
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

describe("validateSeatsAeroKey", () => {
  const search = loadFixture("search.json");

  it("makes exactly one minimal cached-search call with the key in Partner-Authorization", async () => {
    const fetch = fakeFetch(() => jsonResponse(search));
    const result = await validateSeatsAeroKey(` ${PLAINTEXT} `, { fetch, now: T0 });
    expect(result).toEqual({ ok: true });
    expect(fetch.calls).toHaveLength(1);
    const req = fetch.calls[0]!;
    expect(req.headers["partner-authorization"]).toBe(PLAINTEXT);
    expect(req.url.pathname).toBe("/partnerapi/search");
    expect(req.url.searchParams.get("origin_airport")).toBe("SEA");
    expect(req.url.searchParams.get("destination_airport")).toBe("NRT");
    expect(req.url.searchParams.get("start_date")).toBe("2026-09-06");
    expect(req.url.searchParams.get("end_date")).toBe("2026-09-06");
    expect(req.url.searchParams.get("take")).toBe("10");
    expect(req.url.pathname + req.url.search).not.toContain(PLAINTEXT);
  });

  it("treats 401 and 403 as invalid, other HTTP failures as unknown, a 200 with an odd body as ok", async () => {
    expect(await validateSeatsAeroKey(PLAINTEXT, { fetch: fakeFetch(() => textResponse("nope", 401)), now: T0 })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await validateSeatsAeroKey(PLAINTEXT, { fetch: fakeFetch(() => textResponse("forbidden", 403)), now: T0 })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await validateSeatsAeroKey(PLAINTEXT, { fetch: fakeFetch(() => textResponse("boom", 500)), now: T0 })).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(await validateSeatsAeroKey(PLAINTEXT, { fetch: fakeFetch(() => jsonResponse({ weird: true })), now: T0 })).toEqual({
      ok: true,
    });
  });

  it("reports network failures and rejects blank input without calling out", async () => {
    const fetch = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await validateSeatsAeroKey(PLAINTEXT, { fetch, now: T0 })).toEqual({ ok: false, reason: "network", timed_out: false });
    const untouched = fakeFetch(() => jsonResponse(search));
    expect(await validateSeatsAeroKey("   ", { fetch: untouched, now: T0 })).toEqual({ ok: false, reason: "invalid" });
    expect(untouched.calls).toHaveLength(0);
  });

  it("recordValidationCall charges exactly one call to the given day", async () => {
    const store = new InMemoryQuotaStore();
    expect(await recordValidationCall(store, "u1", "2026-09-06")).toBe(1);
    expect(await recordValidationCall(store, "u1", "2026-09-06")).toBe(2);
    expect(await store.get("u1", "2026-09-06")).toBe(2);
    expect(await store.get("u2", "2026-09-06")).toBe(0);
  });
});
