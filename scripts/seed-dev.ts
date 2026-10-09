/**
 * `pnpm exec tsx scripts/seed-dev.ts [--db <path>]` — local development seed (kickoff §9 Phase 2).
 *
 * Creates two users, alice and bob (password "password123"), each with a DIFFERENT fake
 * seats.aero connection (Login with Seats.aero tokens, encrypted under MASTER_KEY as real ones
 * are), so the per-user cache / quota isolation can be exercised in `next dev` against the mock
 * (`pnpm mock:seats`, which accepts these seeded tokens) and in test/integration/two-users.test.ts
 * (which reuses `seedDevDb`).
 *
 * The tokens are obviously fake and never reach seats.aero: any request made with them fails with
 * 401 on the real API. They are also the strings scripts/check-no-secrets-in-bundle.sh greps
 * the production bundle for. They last 30 days, so `next dev` never asks the token service.
 *
 * Refuses to run when NODE_ENV=production. Idempotent: re-running keeps existing users and
 * replaces their connections. Prints only usernames.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getUserByUsername, registerWithInvite, type User } from "@/lib/auth/users";
import { createInvite } from "@/lib/auth/invites";
import { parseMasterKey } from "@/lib/crypto/aes";
import { openDb, resolveDbPath, type Db } from "@/lib/db/client";
import { saveConnection } from "@/lib/seats-oauth/store";

export const DEV_PASSWORD = "password123";

/**
 * Fixed, non-secret master key for local development ONLY (64 hex chars). Used when MASTER_KEY
 * is unset so `seed → next dev` works out of the box; the script tells you to export it.
 */
export const DEV_MASTER_KEY_HEX = "d".repeat(64); // deliberately trivial: dev-only, protects fake keys

export interface DevUserSpec {
  username: string;
  /** Fake seats.aero access token ("seats:ota:seeded-…", which the mock accepts) — deliberately distinct per user. */
  seatsAccess: string;
  /** Fake refresh token to go with it. */
  seatsRefresh: string;
}

export const DEV_USERS: readonly DevUserSpec[] = [
  { username: "alice", seatsAccess: "seats:ota:seeded-dev-alice-FAKE-SEATS-TOKEN-a1c3", seatsRefresh: "seats:otr:seeded-dev-alice-FAKE-a1c3" },
  { username: "bob", seatsAccess: "seats:ota:seeded-dev-bob-FAKE-SEATS-TOKEN-b0b7", seatsRefresh: "seats:otr:seeded-dev-bob-FAKE-b0b7" },
];

/** How long a seeded access token lives: 30 days. */
export const DEV_TOKEN_TTL_S = 30 * 24 * 60 * 60;

export interface SeedDevOptions {
  masterKey: Buffer;
  now?: () => Date;
  users?: readonly DevUserSpec[];
  password?: string;
}

export interface SeededUser {
  user: User;
  created: boolean;
}

/** Register (or reuse) each dev user and save their encrypted fake seats.aero connection. */
export async function seedDevDb(db: Db, opts: SeedDevOptions): Promise<SeededUser[]> {
  const now = opts.now ?? (() => new Date());
  const specs = opts.users ?? DEV_USERS;
  const password = opts.password ?? DEV_PASSWORD;
  const out: SeededUser[] = [];
  for (const spec of specs) {
    let user = getUserByUsername(db, spec.username);
    let created = false;
    if (!user) {
      const { code } = createInvite(db, { createdBy: "seed-dev", intendedFor: spec.username }, { now });
      user = await registerWithInvite(db, { inviteCode: code, username: spec.username, password }, { now });
      created = true;
    }
    saveConnection(db, user.id, { access: spec.seatsAccess, refresh: spec.seatsRefresh, expiresIn: DEV_TOKEN_TTL_S }, { masterKey: opts.masterKey, now });
    out.push({ user, created });
  }
  return out;
}

function parseArgs(argv: readonly string[]): { db?: string } {
  const out: { db?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") {
      const v = argv[i + 1];
      if (!v) throw new Error("--db requires a path");
      out.db = v;
      i++;
    } else if (a?.startsWith("--db=")) {
      out.db = a.slice("--db=".length);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return out;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (process.env.NODE_ENV === "production") {
    process.stderr.write("seed-dev: refusing to seed fake users with NODE_ENV=production\n");
    return 2;
  }
  const args = parseArgs(argv);
  const dbPath = resolveDbPath(args.db);
  const usingDevMaster = !process.env.MASTER_KEY;
  const masterKey = parseMasterKey(process.env.MASTER_KEY ?? DEV_MASTER_KEY_HEX);

  const db = openDb({ path: dbPath });
  const seeded = await seedDevDb(db, { masterKey });

  process.stdout.write(`seed-dev: database ${dbPath}\n`);
  for (const s of seeded) {
    process.stdout.write(
      `  ${s.created ? "created" : "existing"} user ${s.user.username}  password "${DEV_PASSWORD}"  seats.aero connected (fake tokens)\n`,
    );
  }
  if (usingDevMaster) {
    process.stdout.write(
      `seed-dev: MASTER_KEY was not set, so the tokens were encrypted with the fixed DEV master key.\n` +
        `  Run the app with the same key or it cannot decrypt them:\n` +
        `  export MASTER_KEY=${DEV_MASTER_KEY_HEX}\n`,
    );
  }
  return 0;
}

const isEntry = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`seed-dev: ${err instanceof Error ? err.message : "unexpected error"}\n`);
      process.exitCode = 1;
    });
}
