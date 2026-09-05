/**
 * POST /api/parse { text, today? } → 200 { query, provenance, warnings, used_llm }
 *                                  | 422 { error: "parse", missing: [...], message }
 * Parsing never touches seats.aero; the LLM is used only when ANTHROPIC_API_KEY is set.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ISODate } from "@/lib/query/schema";
import { getServerDb } from "@/lib/server/db";
import { gridError, gridErrorResponse, parseForUser, userFromRequest, utcToday } from "@/lib/server/find";
import { readJson } from "@/lib/server/http";

export const runtime = "nodejs";

const Body = z.object({
  text: z.string().min(1).max(2000),
  today: ISODate.optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return gridError(401, "unauthorized");
  try {
    const body = await readJson(request, Body);
    const result = await parseForUser(body.text, { today: body.today ?? utcToday() });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return gridErrorResponse(err);
  }
}
