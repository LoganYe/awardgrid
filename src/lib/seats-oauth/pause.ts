/**
 * The owner's switch for Login with Seats.aero on the web app. Unset (or empty, or one of ON_VALUES) changes nothing;
 * `SEATS_OAUTH_WEB=off` in the server's environment pauses it. Any other value pauses it too: the variable is only ever
 * set to pause, so a spelling this file does not know ("pause", "disabled") is read as off rather than ignored, and the
 * server says so in its log (src/instrumentation.ts). While paused:
 *
 *   - **Connecting stops.** POST /api/seats/connect answers 503 `paused` and records no sign-in; a sign-in coming back
 *     through GET /api/seats/oauth/callback is never exchanged and lands on Settings, which says connecting is paused
 *     (`finishConnect` answers "paused" too).
 *   - **No seats.aero call is made with a sign-in token.** `seatsAuthorization` (./access.ts) throws SeatsPausedError, a
 *     SeatsNotConnectedError, before reading a token or asking the token service for a new one, so search, Get Trips,
 *     "Run now", the worker's standing queries and Ask all stop where an account without a connection stops (409
 *     `no_key`, with `paused: true`). The worker skips its ticks altogether (src/cli/worker-main.ts).
 *   - **Nothing from seats.aero is kept.** `purgeForPause` deletes every account's tokens and sign-ins under way, and
 *     every seats.aero result the server holds (./retention.ts purgeAllSeatsData). It runs when the web server starts
 *     (src/instrumentation.ts), whenever it opens the database and on every sweep after (src/lib/server/db.ts), and when
 *     the worker starts and on each of its ticks. The database zeroes what it deletes (secure_delete,
 *     src/lib/db/client.ts) and `checkpointAfterPurge` empties the write-ahead log after a purge that removed anything,
 *     so the old copies leave the files on disk too.
 *   - **Browsers forget too.** Every signed-in page tells the browser to remove what it kept from seats.aero for the
 *     account, as Disconnect does (src/components/shell/seats-paused-purge.tsx).
 *
 * Turning it back on (removing the line, restarting) brings Connect back; each account connects again. Pasted keys for
 * other providers (Duffel, Ignav) and the CLI's own SEATS_AERO_API_KEY do not use this sign-in and are left alone.
 * Nothing here logs but counts.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { seatsConnections, seatsOauthStates } from "@/lib/db/schema";
import type { DbConn } from "@/lib/auth/clock";
import { type PurgeReport, purgeAllSeatsData } from "./retention";

/** The variable that holds the switch. */
export const SEATS_OAUTH_WEB_ENV = "SEATS_OAUTH_WEB";
/** Values that leave Login with Seats.aero on (compared trimmed and lower-cased); unset leaves it on too. */
export const ON_VALUES: ReadonlySet<string> = new Set(["", "on", "1", "true", "yes"]);
/** Values that pause it (compared trimmed and lower-cased). Any value in neither set pauses it as well. */
export const OFF_VALUES: ReadonlySet<string> = new Set(["off", "0", "false", "no", "paused"]);

/** How the switch reads: "unknown" is a value in neither set, which pauses. */
export type SeatsOAuthWebSetting = "on" | "off" | "unknown";

export function seatsOAuthWebSetting(env: Record<string, string | undefined> = process.env): SeatsOAuthWebSetting {
  const value = env[SEATS_OAUTH_WEB_ENV]?.trim().toLowerCase();
  if (value === undefined || ON_VALUES.has(value)) return "on";
  return OFF_VALUES.has(value) ? "off" : "unknown";
}

/** Whether Login with Seats.aero is paused on this server. */
export function seatsOAuthPaused(env: Record<string, string | undefined> = process.env): boolean {
  return seatsOAuthWebSetting(env) !== "on";
}

export interface PausePurgeReport extends PurgeReport {
  /** Accounts whose sign-in tokens were deleted. */
  connections: number;
  /** Sign-ins under way that were forgotten. */
  states: number;
}

/** Every account's tokens and sign-ins under way, and every seats.aero result the server holds. One transaction. */
export function purgeForPause(db: DbConn, now: Date = new Date()): PausePurgeReport {
  return db.transaction((tx) => {
    const connections = tx.delete(seatsConnections).run().changes;
    const states = tx.delete(seatsOauthStates).run().changes;
    return { connections, states, ...purgeAllSeatsData(tx, now) };
  });
}

/** Whether a purge removed anything (what is worth a log line). */
export function purgedAnything(report: PausePurgeReport): boolean {
  return report.connections + report.states + report.rows + report.coverage + report.routes + report.runs > 0;
}

/**
 * After a purge that removed anything: copy the write-ahead log back into the database file and truncate it, so the
 * deleted rows' earlier copies in the log leave the disk too (the file's own pages are zeroed on delete: secure_delete,
 * src/lib/db/client.ts). Best effort: a reader in another process still on an older snapshot keeps part of the log
 * until the next checkpoint, and SQLite's own checkpoints overwrite it as it is reused.
 */
export function checkpointAfterPurge(db: Db): void {
  db.all(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
}
