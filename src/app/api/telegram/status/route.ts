/** GET /api/telegram/status → 200 { linked: boolean, mock: boolean } | 401 */
import { NextResponse, type NextRequest } from "next/server";
import { getServerDb } from "@/lib/server/db";
import { userFromRequest } from "@/lib/server/find";
import { telegramConfigured, telegramLinked, type TelegramStatus } from "@/lib/server/queries";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  const body: TelegramStatus = { linked: telegramLinked(db, user.id), mock: !telegramConfigured() };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
