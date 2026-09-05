/**
 * GET /api/trips/[id]?cabin=J&include_filtered=true
 *   → 200 { availability_id, trips, fees_cents, currency, booking_url, booking_links, api_calls_used, quota }
 *   | 401 | 409 no_key | 429 quota | 502 seatsaero
 * Costs exactly one seats.aero call on the calling user's key (cell expand only, kickoff §4.3).
 */
import { NextResponse, type NextRequest } from "next/server";
import { Cabin } from "@/lib/query/schema";
import { getServerDb } from "@/lib/server/db";
import { getTripsForUser, gridError, gridErrorResponse, userFromRequest } from "@/lib/server/find";

export const runtime = "nodejs";

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return gridError(401, "unauthorized");
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return gridError(400, "invalid_body");
  const cabinRaw = request.nextUrl.searchParams.get("cabin");
  const cabin = cabinRaw === null ? undefined : Cabin.safeParse(cabinRaw);
  if (cabin && !cabin.success) return gridError(400, "invalid_body");
  const includeFiltered = request.nextUrl.searchParams.get("include_filtered") === "true";
  try {
    const result = await getTripsForUser(db, user, id, {
      ...(cabin ? { cabin: cabin.data } : {}),
      include_filtered: includeFiltered,
    });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return gridErrorResponse(err);
  }
}
