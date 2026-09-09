/**
 * POST /api/export { query, orientation? } → text/csv attachment (UTF-8 BOM so Excel opens
 * Chinese program names). Same pipeline as /api/find (cache → zero calls within the TTL).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { toCsv } from "@awardgrid/core/grid/csv";
import { QueryObject } from "@awardgrid/core/query/schema";
import { getServerDb } from "@/lib/server/db";
import { exportFilename, findGridForUser, gridError, gridErrorResponse, userFromRequest } from "@/lib/server/find";
import { readJson } from "@/lib/server/http";

export const runtime = "nodejs";

const Body = z.object({
  query: QueryObject,
  orientation: z.enum(["dates", "routes"]).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return gridError(401, "unauthorized");
  try {
    const body = await readJson(request, Body);
    const { grid } = await findGridForUser(db, user, body.query, { orientation: body.orientation ?? "dates" });
    const csv = toCsv(grid, { bom: true });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${exportFilename(body.query)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return gridErrorResponse(err);
  }
}
