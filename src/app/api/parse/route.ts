/**
 * POST /api/parse { text, today?, use_llm? } → 200 { query, provenance, warnings, used_llm }
 *                                            | 422 { error: "parse", missing: [...], message, llm_offer? }
 * Parsing never touches seats.aero. The language model reads the text only when this request asks (`use_llm`,
 * the person's explicit choice) and ANTHROPIC_API_KEY is set; otherwise an incomplete text is a 422 that, when the
 * server could ask the model, says so (`llm_offer`), so the UI can offer it as its own action (UI/UX v1 T20).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ISODate } from "@awardgrid/core/query/schema";
import { getServerDb } from "@/lib/server/db";
import { gridError, gridErrorResponse, llmAvailable, ParseError, parseForUser, userFromRequest, utcToday } from "@/lib/server/find";
import { readJson } from "@/lib/server/http";

export const runtime = "nodejs";

const Body = z.object({
  text: z.string().min(1).max(2000),
  today: ISODate.optional(),
  use_llm: z.boolean().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return gridError(401, "unauthorized");
  let useLlm = false;
  try {
    const body = await readJson(request, Body);
    useLlm = body.use_llm === true;
    const result = await parseForUser(body.text, { today: body.today ?? utcToday(), allowLlm: useLlm });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ParseError && !useLlm && llmAvailable()) {
      return gridError(422, "parse", { missing: err.missing, message: err.message.slice(0, 500), ...(err.notice ? { notice: err.notice } : {}), llm_offer: true });
    }
    return gridErrorResponse(err);
  }
}
