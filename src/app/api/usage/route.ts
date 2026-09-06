/**
 * GET /api/usage → 200 UsageSummary | 401 { error: "unauthorized" }
 *
 * Today's (UTC) usage for the signed-in user, for the top-bar quota indicator (Phase 6 §4.7):
 *
 *   {
 *     seats_aero: { used, soft_limit: 950, limit: 1000, reset_at, state: "ok" | "warn" | "exceeded" },
 *     ask:        { spent_usd, cap_usd, remaining_usd, reset_at },
 *     computed_at
 *   }
 *
 * `state` is "warn" from 800 calls (80 % of the hard limit) and "exceeded" from the soft limit.
 * Read-only over the existing `api_usage` and `ask_usage` tables; nothing is charged. Additive
 * endpoint (Phase 6 §0.2), no-store.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServerDb } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { getUsageSummary, type UsageSummary } from "@/lib/server/usage";
import { userFromRequest } from "../keys/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { UsageSummary as UsageResponse };

const NO_STORE = { headers: { "cache-control": "no-store" } } as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(request, db);
  if (!user) return jsonError(401, "unauthorized", NO_STORE);
  const body: UsageSummary = getUsageSummary(db, user.id);
  return NextResponse.json(body, NO_STORE);
}
