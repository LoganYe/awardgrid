/**
 * POST /api/seats/connect {} → 200 { url } | 400 invalid_body | 401 unauthorized | 503 { error: "not_configured" }
 *
 * Starts Login with Seats.aero for the signed-in account: records a fresh state for it (src/lib/seats-oauth/state.ts)
 * and answers seats.aero's consent URL, which the settings page opens. The person comes back through the token
 * service's callback to GET /api/seats/oauth/callback. A JSON body (empty) is required, as for every state-changing
 * handler here: with the Origin guard (src/proxy.ts) it keeps another site from starting a sign-in for this account.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServerDb } from "@/lib/server/db";
import { hasJsonContentType, jsonError } from "@/lib/server/http";
import { beginConnect, consentUrl, seatsOAuthConfigFromEnv } from "@/lib/seats-oauth";
import { userFromRequest } from "../../keys/session";

export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" } as const;

export interface SeatsConnectResponse {
  url: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(request, db);
  if (!user) return jsonError(401, "unauthorized");
  if (!hasJsonContentType(request)) return jsonError(400, "invalid_body");
  const config = seatsOAuthConfigFromEnv();
  if (!config) return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  const state = beginConnect(db, user.id);
  const body: SeatsConnectResponse = { url: consentUrl(config, state) };
  return NextResponse.json(body, { headers: NO_STORE });
}
