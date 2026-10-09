import { describe, expect, it } from "vitest";
import {
  AdminUsageError,
  USAGE,
  adminInvite,
  adminInvites,
  adminRevokeSessions,
  adminUsers,
  formatTable,
  parseAdminArgs,
  renderUsers,
  runAdminCommand,
} from "@/cli/admin-lib";
import { consumeInvite, listInvites } from "@/lib/auth/invites";
import { createSession, getSessionUser } from "@/lib/auth/session";
import { registerWithInvite } from "@/lib/auth/users";
import { openTestDb } from "@/lib/db/client";
import { connectForTests } from "@/lib/seats-oauth/testing";

const T0 = new Date("2026-09-06T10:00:00Z");

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
}

describe("parseAdminArgs", () => {
  it("parses every subcommand", () => {
    expect(parseAdminArgs([])).toEqual({ kind: "help" });
    expect(parseAdminArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseAdminArgs(["invite", "--for", "alice"])).toEqual({ kind: "invite", intendedFor: "alice" });
    expect(parseAdminArgs(["users"])).toEqual({ kind: "users" });
    expect(parseAdminArgs(["invites"])).toEqual({ kind: "invites" });
    expect(parseAdminArgs(["revoke-sessions", "--user", "bob"])).toEqual({ kind: "revoke-sessions", username: "bob" });
  });

  it("rejects missing flags, stray args and unknown commands", () => {
    expect(() => parseAdminArgs(["invite"])).toThrow(AdminUsageError);
    expect(() => parseAdminArgs(["invite", "--for", ""])).toThrow(/--for/);
    expect(() => parseAdminArgs(["revoke-sessions"])).toThrow(/--user/);
    expect(() => parseAdminArgs(["users", "extra"])).toThrow(AdminUsageError);
    expect(() => parseAdminArgs(["frobnicate"])).toThrow(/unknown command/);
    expect(() => parseAdminArgs(["invite", "--bogus", "x"])).toThrow(AdminUsageError);
  });
});

describe("admin commands", () => {
  it("invite prints only the code and a hint, and the code is redeemable", async () => {
    const db = openTestDb();
    const r = adminInvite(db, "alice", { now: T0 });
    expect(r.lines[0]).toBe(r.code);
    expect(r.code).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(r.lines[1]).toContain("alice");
    expect(listInvites(db)[0]).toMatchObject({ code: r.code, createdBy: "admin", intendedFor: "alice" });

    const { out, err, io: sink } = io();
    expect(runAdminCommand(db, { kind: "invite", intendedFor: "bob" }, sink, { now: T0 })).toBe(0);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(err).toEqual([]);
    await expect(registerWithInvite(db, { inviteCode: out[0]!, username: "bob", password: "password-bob00" })).resolves.toMatchObject({
      username: "bob",
    });
  });

  it("users lists username/created/seats.aero connected and never any secret", async () => {
    const db = openTestDb();
    const a = adminInvite(db, "alice", { now: T0 });
    const b = adminInvite(db, "bob", { now: T0 });
    const alice = await registerWithInvite(db, { inviteCode: a.code, username: "alice", password: "password-alice" }, { now: T0 });
    await registerWithInvite(db, { inviteCode: b.code, username: "bob", password: "password-bob00" }, { now: T0 });
    connectForTests(db, alice.id, { masterKey: Buffer.alloc(32, 1), access: "seats:ota:pro_key_ZZZZ" });

    expect(adminUsers(db)).toEqual([
      { username: "alice", created: "2026-09-06", seatsConnected: "yes" },
      { username: "bob", created: "2026-09-06", seatsConnected: "no" },
    ]);
    const { out, io: sink } = io();
    runAdminCommand(db, { kind: "users" }, sink);
    const text = out.join("\n");
    expect(text).toContain("username");
    expect(text).toContain("seats.aero connected");
    expect(text).toMatch(/alice\s+2026-09-06\s+yes/);
    expect(text).toMatch(/bob\s+2026-09-06\s+no/);
    expect(text).not.toContain("argon2");
    expect(text).not.toContain("pro_key");
    expect(text).not.toContain("seats:ota:");
    expect(text).not.toContain(alice.id);
  });

  it("invites lists only unused codes", () => {
    const db = openTestDb();
    const a = adminInvite(db, "alice", { now: T0 });
    const b = adminInvite(db, "", { now: T0 });
    consumeInvite(db, a.code, "someone", { now: T0 });
    expect(adminInvites(db)).toEqual([{ code: b.code, for: "-", created: "2026-09-06" }]);
    const { out, io: sink } = io();
    runAdminCommand(db, { kind: "invites" }, sink);
    expect(out.join("\n")).toContain(b.code);
    expect(out.join("\n")).not.toContain(a.code);
  });

  it("revoke-sessions signs the user out everywhere; unknown user exits 1", async () => {
    const db = openTestDb();
    const a = adminInvite(db, "alice", { now: T0 });
    const alice = await registerWithInvite(db, { inviteCode: a.code, username: "alice", password: "password-alice" }, { now: T0 });
    const s1 = createSession(db, alice.id, { now: T0 });
    const s2 = createSession(db, alice.id, { now: T0 });

    expect(adminRevokeSessions(db, "ghost")).toEqual({ found: false, revoked: 0 });
    const bad = io();
    expect(runAdminCommand(db, { kind: "revoke-sessions", username: "ghost" }, bad.io)).toBe(1);
    expect(bad.err).toEqual(["no such user"]);

    const good = io();
    expect(runAdminCommand(db, { kind: "revoke-sessions", username: "ALICE" }, good.io)).toBe(0);
    expect(good.out).toEqual(["revoked 2 sessions"]);
    expect(getSessionUser(db, s1.token, { now: T0 })).toBeNull();
    expect(getSessionUser(db, s2.token, { now: T0 })).toBeNull();
    expect(good.out.join("\n")).not.toContain(s1.token);
  });

  it("help prints usage", () => {
    const { out, io: sink } = io();
    expect(runAdminCommand(openTestDb(), { kind: "help" }, sink)).toBe(0);
    expect(out).toEqual([USAGE]);
  });
});

describe("formatTable", () => {
  it("pads columns and renders (none) for empty input", () => {
    expect(formatTable(["a", "bbb"], [["xx", "y"]])).toBe("a   bbb\n--  ---\nxx  y");
    expect(renderUsers([])).toBe("username  created  seats.aero connected\n--------  -------  --------------------\n(none)");
  });
});
