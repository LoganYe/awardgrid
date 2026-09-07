/**
 * GET /api/trips/[id]?cabin=J&include_filtered=true&min_cabin_pct=70
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
  // Same scope as the grid that opened the drawer. Absent = the API's own default of 100;
  // anything outside the documented 0-100 integer range is a bad request, not a silent clamp.
  //
  // The RAW STRING is validated before Number() touches it, the way `cabin` is validated above.
  // Number() is far too generous to be a guard: `?min_cabin_pct=` (present but empty) and a bare
  // `?min_cabin_pct` both give "" -> 0, the MOST permissive value, for a caller who named no
  // value at all; "0x10" -> 16, "1e1" -> 10, " " -> 0 and "70.0" -> 70 all pass the range check
  // too. Each of those is the inconsistency this parameter exists to prevent: a drawer flight
  // list computed in a scope the grid never asked for.
  const pctRaw = request.nextUrl.searchParams.get("min_cabin_pct");
  if (pctRaw !== null && !/^\d{1,3}$/.test(pctRaw)) return gridError(400, "invalid_body");
  const minCabinPct = pctRaw === null ? 100 : Number(pctRaw);
  if (minCabinPct > 100) return gridError(400, "invalid_body");
  try {
    const result = await getTripsForUser(db, user, id, {
      ...(cabin ? { cabin: cabin.data } : {}),
      include_filtered: includeFiltered,
      min_cabin_pct: minCabinPct,
    });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return gridErrorResponse(err);
  }
}
