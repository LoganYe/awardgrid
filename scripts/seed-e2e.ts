/**
 * `pnpm exec tsx scripts/seed-e2e.ts --db <path> [--fresh]` — the Playwright suite's database.
 *
 * Creates the e2e users, each with a FAKE seats.aero key whose value selects a scenario on the
 * DEMO=1 mock server (scripts/mock-seatsaero.ts); the app itself is never touched:
 *
 *   demo     demo-key-normal    full dataset; one saved standing query + one recorded run
 *   linked   demo-key-normal    Telegram already linked (fake chat id) + quiet hours set
 *   nokey    (no key)           the "add your key" empty state
 *   empty    demo-key-empty     /search answers with no rows
 *   slow     demo-key-slow      every mock response delayed (loading states)
 *   partial  demo-key-partial   one program not fetched
 *   quota    demo-key-normal    api_usage row for today at the soft limit (950) → quota state
 *
 * Every user's password is E2E_PASSWORD. Idempotent: re-running keeps existing users and
 * re-upserts keys, the quota row and the saved query. `--fresh` deletes the SQLite file (and its
 * -wal/-shm siblings) first. Refuses the default runtime database path so it can never seed a
 * real deployment. Prints usernames only — never a key, never a hash.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createInvite } from "@/lib/auth/invites";
import { getUserByUsername, registerWithInvite, type User } from "@/lib/auth/users";
import { parseMasterKey } from "@/lib/crypto/aes";
import { DEFAULT_DB_PATH, openDb, type Db } from "@/lib/db/client";
import { apiUsage, queryRuns, savedQueries, users } from "@/lib/db/schema";
import { SEATS_AERO_PROVIDER } from "@/lib/db/stores/quota";
import { removeKey, setKey } from "@/lib/keys";
import type { QueryObject } from "@/lib/query/schema";
import { cellsHash } from "@/lib/scheduler/diff";
import type { CellSnapshot } from "@/lib/scheduler/types";
import { utcDayKey } from "@/lib/seatsaero/quota";
import { createSavedQuery, listSavedQueries } from "@/lib/server/queries";
import { E2E_PASSWORD, E2E_SAVED_QUERY_NAME, E2E_USERS, type E2eUserSpec } from "../e2e/users";

export { E2E_PASSWORD, E2E_QUOTA_CALLS, E2E_SAVED_QUERY_NAME, E2E_USERS, type E2eUsername, type E2eUserSpec } from "../e2e/users";
/** Same trivial test-only master key playwright.config.ts hands to the app (64 hex chars). */
export const E2E_MASTER_KEY_HEX = "e".repeat(64);

/** The canonical Phase 6 query (HKG/PVG+SHA/NRT+HND/ICN → SEA, 30 days from `today`, J and F). */
export function canonicalQuery(today: Date): QueryObject {
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 29 * 86_400_000).toISOString().slice(0, 10);
  return {
    origins: ["HKG", "PVG", "SHA", "NRT", "HND", "ICN"],
    destinations: ["SEA"],
    date_from: from,
    date_to: to,
    cabins: ["J", "F"],
    direct_only: false,
    include_filtered: false,
    sort_by: "miles_asc",
    raw_text: "HKG, SHA, TYO, SEL to SEA, next 30 days, business and first",
    language: "en",
  };
}

export interface SeedE2eOptions {
  masterKey: Buffer;
  now?: () => Date;
  users?: readonly E2eUserSpec[];
  password?: string;
}

export interface SeededE2eUser {
  user: User;
  created: boolean;
  hasKey: boolean;
}

/**
 * Seed a day's usage — and the NEXT day's with it.
 *
 * The quota is keyed by UTC day, so a suite that starts at 23:58 and reaches the quota tests at
 * 00:05 asks about a day the seed never wrote: the "quota" user's 950 calls belong to yesterday,
 * today reads 0, and every quota state silently becomes a normal grid. That is what happened to
 * CI run 34068335365 — grid-quota failed in axe, before, grid and screenshots, in every project,
 * for no reason but the clock. Writing tomorrow too costs one row per user and makes the seed
 * correct on both sides of midnight.
 */
function upsertQuota(db: Db, userId: string, calls: number, day: string): void {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  for (const d of [day, next.toISOString().slice(0, 10)]) {
    db.insert(apiUsage)
      .values({ userId, provider: SEATS_AERO_PROVIDER, day: d, calls })
      .onConflictDoUpdate({ target: [apiUsage.userId, apiUsage.provider, apiUsage.day], set: { calls } })
      .run();
  }
}

/** One diff cell as `query_runs.cells_json` stores it: key + miles + fees + seats + freshness. */
function snapshotCell(key: string, miles: number, feesCents: number, seats: number, seenAgoMs: number, now: Date): CellSnapshot {
  return { key, miles, fees_cents: feesCents, seats_left: seats, computed_last_seen: new Date(now.getTime() - seenAgoMs).toISOString() };
}

/** `program|origin|dest|date|cabin`, the five-part key src/lib/scheduler/diff.ts writes. */
function cellKeyOf(program: string, origin: string, date: string, cabin: string): string {
  return [program, origin, "SEA", date, cabin].join("|");
}

const HOUR = 60 * 60_000;

/**
 * Three recorded runs for the demo user's standing query, so /queries has something real to
 * expand (Phase 6 §4): a skipped run six hours ago ("skipped: daily limit"), a baseline four
 * hours ago, and the last run two hours ago whose diff against the baseline is exactly
 * "+3 new, −1 dropped" — one cell gone, three cells that were not there before, across four
 * programs and a freshness spread from 20 minutes to a day — PLUS one cell that survived at a
 * lower price, so the third bucket the scheduler notifies on (price drops, src/lib/scheduler/
 * diff.ts) has something to render in the expanded row.
 */
function ensureSavedQuery(db: Db, userId: string, now: Date): void {
  const existing = listSavedQueries(db, userId).find((q) => q.name === E2E_SAVED_QUERY_NAME);
  const query = canonicalQuery(now);
  const saved = existing ?? createSavedQuery(db, userId, { name: E2E_SAVED_QUERY_NAME, query }, { now: () => now });
  if (existing?.last_run) return;
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

  const kept = cellKeyOf("alaska", "HKG", day(3), "J");
  const dropped = cellKeyOf("american", "PVG", day(5), "J");
  const baseline: CellSnapshot[] = [
    snapshotCell(kept, 60_000, 560, 2, 45 * 60_000, now),
    snapshotCell(dropped, 57_500, 3110, 4, 26 * HOUR, now),
  ];
  const current: CellSnapshot[] = [
    // Same cell, 15 % cheaper — past the query's 10 % drop threshold, so it is a price drop and
    // neither a new nor a dropped cell.
    snapshotCell(kept, 51_000, 560, 2, 45 * 60_000, now),
    snapshotCell(cellKeyOf("aeroplan", "NRT", day(4), "F"), 80_000, 11_230, 1, 3 * HOUR, now),
    snapshotCell(cellKeyOf("united", "ICN", day(7), "J"), 75_000, 560, 9, 20 * 60_000, now),
    snapshotCell(cellKeyOf("alaska", "HND", day(9), "F"), 90_000, 4980, 1, 5 * HOUR, now),
  ];

  // `callsUsed` is what `query_runs.calls_used` records: 0 for the run the daily limit refused
  // before a single request went out, and the real page count for the two that fetched.
  const runs = [
    { agoMs: 6 * HOUR, cells: [] as CellSnapshot[], newCells: 0, droppedCells: 0, skippedReason: "quota" as string | null, callsUsed: 0 as number | null },
    { agoMs: 4 * HOUR, cells: baseline, newCells: 2, droppedCells: 0, skippedReason: null, callsUsed: 27 },
    { agoMs: 2 * HOUR, cells: current, newCells: 3, droppedCells: 1, skippedReason: null, callsUsed: 24 },
  ];
  let lastRunAt = "";
  for (const run of runs) {
    lastRunAt = new Date(now.getTime() - run.agoMs).toISOString();
    db.insert(queryRuns)
      .values({
        id: randomUUID(),
        savedQueryId: saved.id,
        ranAt: lastRunAt,
        cellsHash: cellsHash(run.cells),
        cellsJson: JSON.stringify(run.cells),
        newCells: run.newCells,
        droppedCells: run.droppedCells,
        notified: false,
        skippedReason: run.skippedReason,
        callsUsed: run.callsUsed,
      })
      .run();
  }
  db.update(savedQueries).set({ lastRunAt }).where(eq(savedQueries.id, saved.id)).run();
}

/** Register (or reuse) every e2e user and bring keys, quota rows and saved queries to the spec. */
export async function seedE2eDb(db: Db, opts: SeedE2eOptions): Promise<SeededE2eUser[]> {
  const now = opts.now ?? (() => new Date());
  const specs = opts.users ?? E2E_USERS;
  const password = opts.password ?? E2E_PASSWORD;
  const day = utcDayKey(now());
  const out: SeededE2eUser[] = [];
  for (const spec of specs) {
    let user = getUserByUsername(db, spec.username);
    let created = false;
    if (!user) {
      const { code } = createInvite(db, { createdBy: "seed-e2e", intendedFor: spec.username }, { now });
      user = await registerWithInvite(db, { inviteCode: code, username: spec.username, password }, { now });
      created = true;
    }
    if (spec.seatsAeroKey) setKey(db, user.id, "seats_aero", spec.seatsAeroKey, { masterKey: opts.masterKey, now });
    else removeKey(db, user.id, "seats_aero");
    // Telegram link state and quiet hours (Settings §5.2 states). The chat id is fake and the
    // app runs with no bot token, so nothing can be sent to it.
    db.update(users)
      .set({
        telegramChatId: spec.telegramChatId ?? null,
        quietHoursStart: spec.quietHours?.start ?? null,
        quietHoursEnd: spec.quietHours?.end ?? null,
        ...(spec.quietHours ? { timezone: spec.quietHours.timezone } : {}),
      })
      .where(eq(users.id, user.id))
      .run();
    upsertQuota(db, user.id, spec.quotaCalls ?? 0, day);
    if (spec.savedQuery) ensureSavedQuery(db, user.id, now());
    out.push({ user, created, hasKey: spec.seatsAeroKey !== null });
  }
  return out;
}

function parseArgs(argv: readonly string[]): { db?: string; fresh: boolean } {
  const out: { db?: string; fresh: boolean } = { fresh: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") {
      const v = argv[i + 1];
      if (!v) throw new Error("--db requires a path");
      out.db = v;
      i++;
    } else if (a?.startsWith("--db=")) {
      out.db = a.slice("--db=".length);
    } else if (a === "--fresh") {
      out.fresh = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return out;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const dbPath = args.db ?? process.env.E2E_DB_PATH;
  if (!dbPath) {
    process.stderr.write("seed-e2e: pass --db <path> (or set E2E_DB_PATH); refusing to guess\n");
    return 2;
  }
  if (resolve(dbPath) === resolve(DEFAULT_DB_PATH)) {
    process.stderr.write("seed-e2e: refusing to seed the runtime database; use a throwaway path\n");
    return 2;
  }
  if (args.fresh) for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${dbPath}${suffix}`, { force: true });
  const masterKey = parseMasterKey(process.env.MASTER_KEY ?? E2E_MASTER_KEY_HEX);
  const db = openDb({ path: dbPath });
  const seeded = await seedE2eDb(db, { masterKey });
  process.stdout.write(`seed-e2e: database ${dbPath}${args.fresh ? " (fresh)" : ""}\n`);
  for (const s of seeded) {
    process.stdout.write(`  ${s.created ? "created" : "existing"} user ${s.user.username}  ${s.hasKey ? "seats.aero key on file" : "no key"}\n`);
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
      process.stderr.write(`seed-e2e: ${err instanceof Error ? err.message : "unexpected error"}\n`);
      process.exitCode = 1;
    });
}
