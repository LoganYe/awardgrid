import { describe, expect, it } from "vitest";
import { AuthError } from "@/lib/auth/errors";
import {
  INVITE_ALPHABET,
  consumeInvite,
  createInvite,
  generateInviteCode,
  isInviteCodeShape,
  listInvites,
  listUnusedInvites,
} from "@/lib/auth/invites";
import { openTestDb } from "@/lib/db/client";

const T0 = new Date("2026-09-06T10:00:00Z");

describe("invite codes", () => {
  it("generates 12-char URL-safe codes that differ", () => {
    const a = generateInviteCode();
    const b = generateInviteCode();
    expect(a).toHaveLength(12);
    expect([...a].every((c) => INVITE_ALPHABET.includes(c))).toBe(true);
    expect(a).not.toBe(b);
    expect(isInviteCodeShape(a)).toBe(true);
    expect(isInviteCodeShape("short")).toBe(false);
    expect(isInviteCodeShape("has spaces!!")).toBe(false);
  });

  it("creates, lists, consumes once and rejects a second use", () => {
    const db = openTestDb();
    const { code } = createInvite(db, { createdBy: "admin", intendedFor: "alice" }, { now: T0 });
    expect(code).toMatch(/^[A-Za-z0-9_-]{12}$/);

    const all = listInvites(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ code, createdBy: "admin", intendedFor: "alice", usedBy: null, usedAt: null });
    expect(all[0]?.createdAt).toBe(T0.toISOString());
    expect(listUnusedInvites(db).map((i) => i.code)).toEqual([code]);

    const used = new Date("2026-09-07T00:00:00Z");
    expect(() => consumeInvite(db, code, "user-1", { now: used })).not.toThrow();
    expect(listInvites(db)[0]).toMatchObject({ usedBy: "user-1", usedAt: used.toISOString() });
    expect(listUnusedInvites(db)).toHaveLength(0);

    // Double use is rejected atomically and does not change the original consumer.
    expect(() => consumeInvite(db, code, "user-2", { now: used })).toThrow(AuthError);
    try {
      consumeInvite(db, code, "user-2", { now: used });
    } catch (err) {
      expect((err as AuthError).code).toBe("invalid_invite");
    }
    expect(listInvites(db)[0]?.usedBy).toBe("user-1");
  });

  it("rejects unknown and malformed codes without touching the table", () => {
    const db = openTestDb();
    createInvite(db, { createdBy: "admin" }, { now: T0 });
    expect(() => consumeInvite(db, "ZZZZZZZZZZZZ", "u", { now: T0 })).toThrow(/invalid or has already been used/);
    expect(() => consumeInvite(db, "' OR 1=1 --", "u", { now: T0 })).toThrow(AuthError);
    expect(listUnusedInvites(db)).toHaveLength(1);
  });

  it("trims the intendedFor hint and stores null when blank", () => {
    const db = openTestDb();
    createInvite(db, { createdBy: "admin", intendedFor: "   " }, { now: T0 });
    expect(listInvites(db)[0]?.intendedFor).toBeNull();
  });
});
