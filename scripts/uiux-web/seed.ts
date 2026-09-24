/**
 * Seeds the UI/UX Web surface's throwaway database (plan 04 T18). TEST-ONLY.
 *
 * One account per Web scenario, named after it, each with the fake key that tells the fixture's seats.aero which
 * scenario to answer (./mock-seatsaero.ts). `no-seats-key` has none; `quota-low` starts at the soft limit. Refuses
 * the runtime database, as scripts/seed-e2e.ts does.
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { parseMasterKey } from "@/lib/crypto/aes";
import { DEFAULT_DB_PATH, openDb } from "@/lib/db/client";
import { E2E_MASTER_KEY_HEX, seedE2eDb } from "../seed-e2e";
import type { E2eUserSpec } from "../../e2e/users";
import { UIUX_WEB_PASSWORD, WEB_SCENARIOS, webKeyFor } from "./accounts";


export async function main(): Promise<number> {
  const dbPath = process.env.DATABASE_PATH;
  if (!dbPath) {
    process.stderr.write("uiux-web seed: set DATABASE_PATH (a throwaway SQLite path)\n");
    return 2;
  }
  if (resolve(dbPath) === resolve(DEFAULT_DB_PATH)) {
    process.stderr.write("uiux-web seed: refusing to seed the runtime database\n");
    return 2;
  }
  for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${dbPath}${suffix}`, { force: true });
  const db = openDb({ path: dbPath });
  const now = process.env.UIUX_WEB_NOW ? new Date(process.env.UIUX_WEB_NOW) : new Date();
  const users = WEB_SCENARIOS.map((id) => ({
    username: id,
    seatsAeroKey: id === "no-seats-key" ? null : webKeyFor(id),
    quotaCalls: id === "quota-low" ? 950 : 0,
  })) as unknown as E2eUserSpec[];
  const seeded = await seedE2eDb(db, { users, password: UIUX_WEB_PASSWORD, masterKey: parseMasterKey(process.env.MASTER_KEY ?? E2E_MASTER_KEY_HEX), now: () => now });
  process.stdout.write(`uiux-web seed: ${seeded.length} accounts in ${dbPath}\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`uiux-web seed: ${err instanceof Error ? err.message : "unexpected error"}\n`);
    process.exitCode = 1;
  });
