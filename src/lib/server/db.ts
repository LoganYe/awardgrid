/**
 * Single indirection between route handlers / server components and the process-wide
 * SQLite handle, so tests can `vi.mock("@/lib/server/db")` and hand out an openTestDb().
 * Only used inside the Next.js app; the CLI/worker call getDb() directly.
 *
 * The first call also starts this process's short-term caching sweep: seats.aero results older than 24 hours are
 * deleted at once and every SWEEP_INTERVAL_MS after (src/lib/seats-oauth/retention.ts). The timer is unref'd, so it
 * never keeps a process alive on its own. While Login with Seats.aero is paused (SEATS_OAUTH_WEB=off,
 * src/lib/seats-oauth/pause.ts) each sweep first deletes every account's sign-in tokens and every seats.aero result,
 * whatever its age; src/instrumentation.ts makes the first call when the server starts then, so the purge does not wait
 * for a request. The first purge in the process is always logged, with its counts even when they are all 0, so the log
 * shows the switch took effect; later ones only when they removed something. (Next.js loads this module once for
 * src/instrumentation.ts and again for the app, so whether that line was written is kept on globalThis.) A purge that
 * fails (the database busy past its timeout, say) is tried again the next time the database is asked for, not 10
 * minutes later.
 */
import { getDb, type Db } from "@/lib/db/client";
import { type PausePurgeReport, checkpointAfterPurge, purgeForPause, purgedAnything, seatsOAuthPaused } from "@/lib/seats-oauth/pause";
import { SWEEP_INTERVAL_MS, sweepSeatsData } from "@/lib/seats-oauth/retention";

export type { Db };

let sweeping = false;
/** Whether this copy of the module has run the pause's purge to the end once. */
let pausePurged = false;

/** Set once the process has logged a pause purge's line: one for every copy of this module. */
export const PAUSE_PURGE_LOGGED = Symbol.for("awardgrid.seats-oauth.pause-purge-logged");
const processWide = globalThis as typeof globalThis & { [PAUSE_PURGE_LOGGED]?: boolean };

/** The pause's purge, when the sign-in is paused; a line of counts. Never throws: a failure is logged by name. */
function purgeIfPaused(db: Db): void {
  if (!seatsOAuthPaused()) return;
  let purged: PausePurgeReport;
  try {
    purged = purgeForPause(db);
  } catch (err) {
    // Name only; the next getServerDb() tries again.
    console.error("[seats-oauth] paused: purge failed:", err instanceof Error ? err.name : "error");
    return;
  }
  const removed = purgedAnything(purged);
  if (removed || !processWide[PAUSE_PURGE_LOGGED]) console.info(`[seats-oauth] paused: purged ${JSON.stringify(purged)}`);
  processWide[PAUSE_PURGE_LOGGED] = true;
  pausePurged = true;
  if (!removed) return;
  try {
    checkpointAfterPurge(db);
  } catch (err) {
    console.error("[seats-oauth] paused: checkpoint failed:", err instanceof Error ? err.name : "error");
  }
}

function sweep(db: Db): void {
  purgeIfPaused(db);
  try {
    sweepSeatsData(db);
  } catch (err) {
    // Name only; the next sweep tries again.
    console.error("[retention] sweep failed:", err instanceof Error ? err.name : "error");
  }
}

/** Start the sweep once per process, for `db`; while paused, also retry a purge that has not succeeded yet. */
export function startRetentionSweep(db: Db, intervalMs: number = SWEEP_INTERVAL_MS): void {
  if (sweeping) {
    if (!pausePurged) purgeIfPaused(db);
    return;
  }
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
