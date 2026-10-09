/**
 * Single indirection between route handlers / server components and the process-wide
 * SQLite handle, so tests can `vi.mock("@/lib/server/db")` and hand out an openTestDb().
 * Only used inside the Next.js app; the CLI/worker call getDb() directly.
 *
 * The first call also starts this process's short-term caching sweep: seats.aero results older than 24 hours are
 * deleted at once and every SWEEP_INTERVAL_MS after (src/lib/seats-oauth/retention.ts). The timer is unref'd, so it
 * never keeps a process alive on its own.
 */
import { getDb, type Db } from "@/lib/db/client";
import { SWEEP_INTERVAL_MS, sweepSeatsData } from "@/lib/seats-oauth/retention";

export type { Db };

let sweeping = false;

function sweep(db: Db): void {
  try {
    sweepSeatsData(db);
  } catch (err) {
    // Name only; the next sweep tries again.
    console.error("[retention] sweep failed:", err instanceof Error ? err.name : "error");
  }
}

/** Start the sweep once per process, for `db`. */
export function startRetentionSweep(db: Db, intervalMs: number = SWEEP_INTERVAL_MS): void {
  if (sweeping) return;
  sweeping = true;
  sweep(db);
  const timer = setInterval(() => sweep(db), intervalMs);
  timer.unref?.();
}

export function getServerDb(): Db {
  const db = getDb();
  startRetentionSweep(db);
  return db;
}
