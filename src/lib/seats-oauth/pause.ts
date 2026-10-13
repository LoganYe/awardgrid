/**
 * The owner's switch for Login with Seats.aero on the web app. Unset (or any value but those in OFF_VALUES) changes
 * nothing; `SEATS_OAUTH_WEB=off` in the server's environment pauses it:
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
 *     the worker starts and on each of its ticks.
 *   - **Browsers forget too.** Every signed-in page tells the browser to remove what it kept from seats.aero for the
 *     account, as Disconnect does (src/components/shell/seats-paused-purge.tsx).
 *
 * Turning it back on (removing the line, restarting) brings Connect back; each account connects again. Pasted keys for
 * other providers (Duffel, Ignav) and the CLI's own SEATS_AERO_API_KEY do not use this sign-in and are left alone.
 * Nothing here logs but counts.
 */
import { seatsConnections, seatsOauthStates } from "@/lib/db/schema";
import type { DbConn } from "@/lib/auth/clock";
import { type PurgeReport, purgeAllSeatsData } from "./retention";

/** The variable that holds the switch. */
export const SEATS_OAUTH_WEB_ENV = "SEATS_OAUTH_WEB";
/** Values that pause Login with Seats.aero on the web app (compared trimmed and lower-cased). */
export const OFF_VALUES: ReadonlySet<string> = new Set(["off", "0", "false", "no", "paused"]);

/** Whether Login with Seats.aero is paused on this server. */
export function seatsOAuthPaused(env: Record<string, string | undefined> = process.env): boolean {
  const value = env[SEATS_OAUTH_WEB_ENV]?.trim().toLowerCase();
  return value !== undefined && OFF_VALUES.has(value);
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
