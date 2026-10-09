/**
 * GET /api/seats/oauth/callback?code=…&state=… (or ?error=…&state=…) → 303 /settings?seats=<outcome>#seats
 *
 * Where the token service (sites/auth, WEB_CALLBACK) sends the browser after seats.aero's consent page, for a state
 * this app made. `finishConnect` checks the state against the signed-in account, exchanges the code through the token
 * service and stores the tokens encrypted; the browser only ever learns the outcome's name (src/lib/seats-oauth/
 * connect.ts CONNECT_OUTCOMES). Without a session the code cannot be tied to an account and is dropped: the person
 * signs in and connects again.
 *
 * The redirect is relative (it stays on whatever host served this request), the answer is never cached, and no
 * referrer leaves this URL, which carries the code.
 */
import type { NextRequest } from "next/server";
import { getServerDb } from "@/lib/server/db";
import { finishConnect } from "@/lib/seats-oauth";
import { userFromRequest } from "../../../keys/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export async function GET(request: NextRequest): Promise<Response> {
  const db = getServerDb();
  const user = userFromRequest(request, db);
  if (!user) return seeOther("/login");
  let outcome: string;
  try {
    outcome = await finishConnect(db, user.id, request.nextUrl.searchParams);
  } catch (err) {
    console.error("[api/seats/oauth/callback] failed:", err instanceof Error ? err.name : "error");
    outcome = "failed";
  }
  return seeOther(`/settings?seats=${outcome}#seats`);
}
