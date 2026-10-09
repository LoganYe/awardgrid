/**
 * `pnpm admin` internals (kickoff §5, §9 "admin CLI"). Pure functions over a Db so they can be
 * unit-tested; src/cli/admin.ts only parses argv and wires stdout/stderr.
 *
 * Output rules: an invite prints ONLY its code plus a one-line hint; nothing here ever prints
 * a password hash, a key, a ciphertext or a session token.
 */
import { parseArgs } from "node:util";
import type { ClockOptions, DbConn as Db } from "@/lib/auth/clock";
import { createInvite, listUnusedInvites } from "@/lib/auth/invites";
import { revokeAllSessions } from "@/lib/auth/session";
import { getUserByUsername, listUsers } from "@/lib/auth/users";

export const ADMIN_CREATED_BY = "admin";

export type AdminCommand =
  | { kind: "invite"; intendedFor: string }
  | { kind: "users" }
  | { kind: "invites" }
  | { kind: "revoke-sessions"; username: string }
  | { kind: "help" };

export const USAGE = [
  "usage: pnpm admin <command>",
  "",
  "  invite --for <name>            mint one invite code (prints the code only)",
  "  users                          list users: username, created, seats.aero connected",
  "  invites                        list unused invite codes",
  "  revoke-sessions --user <name>  sign a user out everywhere",
].join("\n");

export class AdminUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminUsageError";
  }
}

/** Parse `process.argv.slice(2)`. Throws AdminUsageError with a human message on bad input. */
export function parseAdminArgs(argv: readonly string[]): AdminCommand {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") return { kind: "help" };
  let parsed: ReturnType<typeof parseArgs<{ options: { for: { type: "string" }; user: { type: "string" } } }>>;
  try {
    parsed = parseArgs({
      args: [...rest],
      options: { for: { type: "string" }, user: { type: "string" } },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    throw new AdminUsageError(err instanceof Error ? err.message : "invalid arguments");
  }
  switch (command) {
    case "invite": {
      const intendedFor = parsed.values.for?.trim();
      if (!intendedFor) throw new AdminUsageError("invite requires --for <name>");
      return { kind: "invite", intendedFor };
    }
    case "users":
      return { kind: "users" };
    case "invites":
      return { kind: "invites" };
    case "revoke-sessions": {
      const username = parsed.values.user?.trim();
      if (!username) throw new AdminUsageError("revoke-sessions requires --user <name>");
      return { kind: "revoke-sessions", username };
    }
    default:
      throw new AdminUsageError(`unknown command "${command}"`);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface InviteOutput {
  code: string;
  /** Exactly what the CLI prints: the code on line 1, the usage hint on line 2. */
  lines: [string, string];
}

export function adminInvite(db: Db, intendedFor: string, opts: ClockOptions = {}): InviteOutput {
  const { code } = createInvite(db, { createdBy: ADMIN_CREATED_BY, intendedFor }, opts);
  return { code, lines: [code, `Give this code to ${intendedFor}; it is redeemed once at /register.`] };
}

export interface UsersTableRow {
  username: string;
  created: string; // YYYY-MM-DD
  seatsConnected: "yes" | "no";
}

export function adminUsers(db: Db): UsersTableRow[] {
  return listUsers(db).map((u) => ({
    username: u.username,
    created: u.createdAt.slice(0, 10),
    seatsConnected: u.seatsConnected ? "yes" : "no",
  }));
}

export interface InvitesTableRow {
  code: string;
  for: string;
  created: string;
}

export function adminInvites(db: Db): InvitesTableRow[] {
  return listUnusedInvites(db).map((i) => ({ code: i.code, for: i.intendedFor ?? "-", created: i.createdAt.slice(0, 10) }));
}

export interface RevokeOutput {
  found: boolean;
  revoked: number;
}

export function adminRevokeSessions(db: Db, username: string): RevokeOutput {
  const user = getUserByUsername(db, username);
  if (!user) return { found: false, revoked: 0 };
  return { found: true, revoked: revokeAllSessions(db, user.id) };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Fixed-width text table: header row, dashes, rows. Empty input renders the header plus "(none)". */
export function formatTable(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: readonly string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  const out = [line(headers), widths.map((w) => "-".repeat(w)).join("  ")];
  if (rows.length === 0) out.push("(none)");
  for (const r of rows) out.push(line(r));
  return out.join("\n");
}

export function renderUsers(rows: readonly UsersTableRow[]): string {
  return formatTable(
    ["username", "created", "seats.aero connected"],
    rows.map((r) => [r.username, r.created, r.seatsConnected]),
  );
}

export function renderInvites(rows: readonly InvitesTableRow[]): string {
  return formatTable(
    ["code", "for", "created"],
    rows.map((r) => [r.code, r.for, r.created]),
  );
}

export interface AdminIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

/** Run one parsed command against `db`, writing to `io`. Returns the process exit code. */
export function runAdminCommand(db: Db, cmd: AdminCommand, io: AdminIo, opts: ClockOptions = {}): number {
  switch (cmd.kind) {
    case "help":
      io.out(USAGE);
      return 0;
    case "invite": {
      const r = adminInvite(db, cmd.intendedFor, opts);
      io.out(r.lines[0]);
      io.out(r.lines[1]);
      return 0;
    }
    case "users":
      io.out(renderUsers(adminUsers(db)));
      return 0;
    case "invites":
      io.out(renderInvites(adminInvites(db)));
      return 0;
    case "revoke-sessions": {
      const r = adminRevokeSessions(db, cmd.username);
      if (!r.found) {
        io.err("no such user");
        return 1;
      }
      io.out(`revoked ${r.revoked} session${r.revoked === 1 ? "" : "s"}`);
      return 0;
    }
  }
}
