/**
 * GET /api/ask/usage → 200 { spentUsd, capUsd, remainingUsd, resetAt } | 401 unauthorized
 * Today's (UTC) ask-lane spend for the calling user against the $2/day cap (kickoff §12).
 * Read-only: reserveAsk() is check-only (spent vs cap over the `ask_usage` table); nothing is
 * charged here.
 */
import { NextResponse, type NextRequest } from "next/server";
import { reserveAsk } from "@/lib/ask";
import { getServerDb } from "@/lib/server/db";
import { userFromRequest } from "@/lib/server/find";
import { usageResponse } from "../wire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "cache-control": "no-store" } } as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, ...NO_STORE });
  try {
    const usage = await reserveAsk(db, user.id);
    return NextResponse.json(usageResponse(usage), NO_STORE);
  } catch (err) {
    console.error(`[ask] usage failed: ${err instanceof Error ? err.name : "unknown"}`);
    return NextResponse.json({ error: "internal" }, { status: 500, ...NO_STORE });
  }
}
