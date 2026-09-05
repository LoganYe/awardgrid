/**
 * `pnpm exec tsx scripts/seed-dev.ts [--db <path>]` — local development seed (kickoff §9 Phase 2).
 *
 * Creates two users, alice and bob (password "password123"), each with a DIFFERENT fake
 * seats.aero key encrypted under MASTER_KEY, so the per-user cache / quota isolation can be
 * exercised in `next dev` and in test/integration/two-users.test.ts (which reuses `seedDevDb`).
 *
 * The keys are obviously fake and never reach seats.aero: any request made with them fails with
 * 401 on the real API. They are also the strings scripts/check-no-secrets-in-bundle.sh greps
 * the production bundle for.
 *
 * Refuses to run when NODE_ENV=production. Idempotent: re-running keeps existing users and
 * re-encrypts (replaces) their keys. Prints only usernames and the last 4 characters of each key.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getUserByUsername, registerWithInvite, type User } from "@/lib/auth/users";
import { createInvite } from "@/lib/auth/invites";
import { parseMasterKey } from "@/lib/crypto/aes";
import { openDb, resolveDbPath, type Db } from "@/lib/db/client";
import { setKey, type KeySummary } from "@/lib/keys";

export const DEV_PASSWORD = "password123";

/**
 * Fixed, non-secret master key for local development ONLY (64 hex chars). Used when MASTER_KEY
 * is unset so `seed → next dev` works out of the box; the script tells you to export it.
 */
export const DEV_MASTER_KEY_HEX = "d".repeat(64); // deliberately trivial: dev-only, protects fake keys

export interface DevUserSpec {
  username: string;
  /** Fake seats.aero Pro key — deliberately distinct per user. */
  seatsAeroKey: string;
}

export const DEV_USERS: readonly DevUserSpec[] = [
  { username: "alice", seatsAeroKey: "pro_dev_alice_FAKE_SEATS_KEY_a1c3" },
  { username: "bob", seatsAeroKey: "pro_dev_bob_FAKE_SEATS_KEY_b0b7" },
];

export interface SeedDevOptions {
  masterKey: Buffer;
  now?: () => Date;
  users?: readonly DevUserSpec[];
  password?: string;
}

export interface SeededUser {
  user: User;
  key: KeySummary;
  created: boolean;
}

/** Register (or reuse) each dev user and upsert their encrypted seats.aero key. */
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
    const key = setKey(db, user.id, "seats_aero", spec.seatsAeroKey, { masterKey: opts.masterKey, now });
    out.push({ user, key, created });
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
      `  ${s.created ? "created" : "existing"} user ${s.user.username}  password "${DEV_PASSWORD}"  seats.aero key ${s.key.masked}\n`,
    );
  }
  if (usingDevMaster) {
    process.stdout.write(
      `seed-dev: MASTER_KEY was not set, so the keys were encrypted with the fixed DEV master key.\n` +
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
