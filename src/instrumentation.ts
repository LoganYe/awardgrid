/**
 * Next.js instrumentation: `register` runs once when the server starts, before it answers a request.
 *
 * While Login with Seats.aero is paused on this server (SEATS_OAUTH_WEB=off, src/lib/seats-oauth/pause.ts) it opens the
 * database at once, so the pause's purge (every account's sign-in tokens and every seats.aero result) runs at startup
 * instead of on the first request, and its line of counts (`[seats-oauth] paused: purged {…}`, src/lib/server/db.ts)
 * is in the log as soon as the server is up. A value the switch does not know pauses too, with a warning first. With the
 * switch on it does nothing: the database opens on the first request, as before. Only the Node.js server has the
 * database; the imports stay inside the runtime check so no other bundle carries them.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { SEATS_OAUTH_WEB_ENV, seatsOAuthWebSetting } = await import("@/lib/seats-oauth/pause");
    const setting = seatsOAuthWebSetting();
    if (setting === "on") return;
    if (setting === "unknown") {
      // Not the value itself: the log keeps to names and counts.
      console.warn(`[seats-oauth] ${SEATS_OAUTH_WEB_ENV} is neither on nor off; Login with Seats.aero is paused`);
    }
    try {
      const { getServerDb } = await import("@/lib/server/db");
      getServerDb();
    } catch (err) {
      // Name only; the first request opens the database and purges again. (A purge that fails once the database is
      // open is logged and retried by src/lib/server/db.ts itself.)
      console.error("[seats-oauth] paused: startup purge failed:", err instanceof Error ? err.name : "error");
    }
  }
}
